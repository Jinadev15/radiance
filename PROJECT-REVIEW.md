# Radiance Attendance System — Problems, Fixes and Upgrades

Written after reading the full codebase (backend, ml-service, scanner, frontend).

**Read this first:** the system is well built. Liveness detection, duplicate-face
blocking, geofencing, role scoping, soft deletes, atomic employee IDs, rate
limiting, timing-attack protection on login — this is better than most projects
of this kind. The problems below are not "bad code". They are the gap between
"works on my laptop" and "runs a payroll for a facility company".

The most important finding: **there is a timezone bug that makes almost every
time in the system wrong by 5 hours 30 minutes.** Fix that before anything else.

---

## How the system is put together

Five pieces:

| Piece | Folder | Host | Job |
|---|---|---|---|
| Dashboard | `frontend/` | Vercel | HR/Admin/Supervisor web app |
| Scanner kiosk | `scanner/` | Vercel | Public page employees scan at |
| Backend API | `backend/` | Render | All logic, database access |
| Face engine | `ml-service/` | Render | OpenCV YuNet detect + SFace match |
| Database | MongoDB Atlas | Atlas M0 | Employees, attendance, users |

The scan flow: kiosk grabs 2 camera frames → backend extracts a 128-number
face embedding → compares against every registered employee → checks liveness
→ checks geofence → writes an `AttendanceLog`.

---

# PART A — Bugs that will produce wrong payroll

These are not theoretical. Each one will happen in the first week.

---

## A1. Everything runs in UTC, but your staff work in IST 🔴 CRITICAL

**The single most important item in this document.**

Render's servers run on UTC. India is UTC+5:30. The code assumes server time is
local time. It isn't.

**Where it breaks:**

`backend/utils/shiftStatus.js` uses `d.setHours(h, m)`, which sets the hour in
*server* time. So a "09:00" shift becomes 09:00 **UTC** = 14:30 IST.

Walk through a real morning. Day shift 09:00–17:00, 10 minute grace:
- Worker arrives 09:05 IST — that instant is 03:35 UTC
- Code compares 03:35 against a cutoff of 09:10 UTC
- 03:35 is earlier → marked **VALID**

Now a worker who strolls in at 2:00 PM IST (5 hours late):
- 14:00 IST = 08:30 UTC, still before the 09:10 UTC cutoff → marked **VALID**

**Nobody gets marked late until 2:40 PM.** The entire late-detection feature is
silently dead.

Night shift 21:00–06:00 is worse. A worker does the full shift, clocks out at
06:00 IST. The code computes the expected end as 06:00 UTC (= 11:30 IST) and
concludes they left early. **Every night-shift worker who works their whole
shift gets flagged `EARLY_DEPARTURE`.**

Then the date. `new Date().toISOString().split('T')[0]` is always the **UTC**
date. It appears in `backend/routes/scanner.js`, `backend/routes/attendance.js`
(`/today`), `backend/routes/stats.js`, `backend/utils/dailyDigest.js`,
`backend/routes/myAttendance.js`. Any clock-in between 00:00 and 05:29 IST gets
filed under **yesterday's date**. Early-morning cleaning shifts — completely
normal in facility management — land on the wrong day.

Then the times people actually read. `toLocaleTimeString()` in
`backend/routes/scanner.js`, `clockout.js` and the CSV export in
`attendance.js` all render in server locale — UTC. A worker clocking in at
09:05 IST sees **"Clock-in successful at 03:35"**. The CSV that HR uses to pay
people shows 03:35. **Every time on the payroll sheet is 5h30m wrong.**

And the daily digest cron `'30 10 * * *'` fires at 10:30 UTC = **4:00 PM IST**,
not the 10:30 AM the comment claims.

**Fix — do this properly, not with a +5:30 hack:**

1. Add `TZ=Asia/Kolkata` as an environment variable on the Render backend
   service. Node reads this and `setHours` / `toLocaleTimeString` immediately
   behave as IST. This alone fixes most of it.
2. Do not rely on that alone. Add `backend/utils/tz.js`:
   ```js
   const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
   // 'YYYY-MM-DD' in the business timezone, whatever the server's clock says
   function businessDate(d = new Date()) {
     return new Intl.DateTimeFormat('en-CA', {
       timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
     }).format(d);
   }
   function businessTime(d) {
     return new Intl.DateTimeFormat('en-IN', {
       timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
     }).format(new Date(d));
   }
   module.exports = { TZ, businessDate, businessTime };
   ```
3. Replace **every** `new Date().toISOString().split('T')[0]` with
   `businessDate()`. Replace every `toLocaleTimeString()` shown to a user or
   written to CSV with `businessTime()`.
4. Rewrite `parseTimeOnDate` in `shiftStatus.js` and `autoClockOut.js` to build
   the cutoff in IST rather than server-local. Simplest correct approach:
   compute the IST calendar date and wall-clock minutes for the instant, then
   compare minutes-since-midnight against the shift's minutes-since-midnight —
   no `Date` arithmetic across timezones at all.
5. Change the digest cron to `'0 5 * * *'` UTC (10:30 AM IST), or keep
   `'30 10 * * *'` **and** set `TZ`, then verify which one actually fires.
6. Store the timezone on the `WorkLocation` model (`timezone: { type: String,
   default: 'Asia/Kolkata' }`). Costs nothing now, and saves a rewrite if
   Radiance ever runs a site in another zone.

**Test it before you believe it:** set your laptop's clock to UTC, run the
backend, clock in, and confirm the date, the displayed time and the LATE flag
are all correct in IST.

---

## A2. Clocking out and back in the same day returns "Internal server error" 🔴 CRITICAL

`backend/models/AttendanceLog.js` has a unique index on
`{ employee: 1, date: 1 }` — one row per person per day.

`backend/routes/scanner.js` looks for an **open** log (`clockOutTime` doesn't
exist) in the last 20 hours. If you already clocked out, there is no open log,
so it builds a brand new `AttendanceLog` with today's date → MongoDB rejects it
with duplicate-key error 11000 → the catch block returns a generic 500.

**Who this hits:**
- Anyone who taps "Clock Out" by mistake instead of "Clock In". They are now
  locked out for the rest of the day, and the message tells them nothing.
- Anyone clocking out for lunch and back in after.
- Anyone doing a second shift or overtime block on the same day.
- Security guards doing split duty — normal in this industry.

**Fix — allow multiple sessions per day. This is a schema change, do it now
before there's real data to migrate.**

1. Drop the unique index on `{employee, date}`. Replace with a non-unique
   compound index for query speed:
   ```js
   attendanceLogSchema.index({ employee: 1, date: 1 });
   attendanceLogSchema.index({ employee: 1, clockInTime: -1 });
   ```
2. Add a `sessionNumber` field (1, 2, 3…) so a day's rows are ordered and
   readable.
3. Treat "hours worked today" as the **sum** of that day's sessions everywhere:
   the dashboard, the CSV export, the billing rollup.
4. Add a guard against accidental double-taps: if the last session for this
   employee closed **less than 2 minutes ago**, don't open a new one — return
   "You just clocked out at 09:05. Tap again in a moment if you meant to clock
   back in."
5. Fix `PUT /api/v1/attendance/manual` too — it does `findOne({employee, date})`
   and assumes one row. It needs to target a specific session id.

---

## A3. Offline scans get recorded at the wrong time 🔴 CRITICAL

`scanner/src/utils/offlineQueue.js` queues the request body when the network
drops. The body is `{ images, latitude, longitude }` — **there is no timestamp
in it.**

When connectivity returns, the backend does `const now = new Date()` and
records *that* moment.

Site Wi-Fi drops 8:45 AM, comes back 1:00 PM. Forty workers scanned in at 9:00.
Every one of them is recorded as clocking in at **1:00 PM** — and once A1 is
fixed and late detection actually works, every one of them is marked LATE.

Worse, they'll all sync within the same minute and hit the 30-requests-per-
minute rate limiter, so some get dropped entirely.

**Fix:**

1. Stamp the client's time when queuing: add `capturedAt: new Date().toISOString()`
   to the queued body.
2. Accept `capturedAt` in `clock-in`/`clock-out`. Use it as the clock time
   instead of `new Date()`, but **validate it**: reject anything in the future,
   or older than ~24 hours, and clamp to a sane range. Never trust a client
   clock outright — a kiosk tablet with a wrong date would otherwise write
   garbage.
3. Mark those rows: `markedBy: 'OFFLINE_SYNC'`, plus a note. HR should be able
   to see which records came from a queued scan and spot-check them.
4. Space out the replay — 1 request every 2 seconds, not a burst.
5. Raise the rate limit (see A9) so a sync burst can't be throttled.

---

## A4. The offline queue breaks the kiosk after about a dozen scans 🔴 CRITICAL

Each queued scan holds two base64 JPEG frames — roughly 400 KB. `localStorage`
caps out around 5 MB. So after **~12 offline scans** `writeQueue` throws
`QuotaExceededError`. Nothing catches it. `enqueue` is called from inside the
`catch` in `api.js`, so the error propagates as a hard failure — the kiosk
starts refusing scans, and the employee sees a raw error.

At a 50-person site with a 4-hour outage, the kiosk dies after person 12 and
the other 38 have no attendance record at all.

**Fix:**

1. Move the queue to **IndexedDB** (hundreds of MB, designed for blobs). Use
   `idb-keyval` — one small dependency, a few lines of change.
2. Shrink what you store: 640×480 at JPEG quality 0.6 is plenty for face
   matching and cuts each scan to ~60 KB.
3. Wrap `writeQueue` in try/catch regardless. If it still fails, tell the
   employee plainly: "Cannot save your scan — please tell your supervisor."
   Never a silent loss and never a raw error.
4. Show the pending count on the kiosk screen: "3 scans waiting to sync." The
   supervisor needs to know the site is offline.

---

## A5. Everyone who registers at the kiosk escapes the geofence 🔴 CRITICAL

`scanner/src/components/RegistrationForm.jsx` collects name, phone, Aadhaar,
DOB and consent. **It does not collect a work site.**

So `POST /api/v1/register` saves `workLocation: null`. And in
`backend/routes/scanner.js`, the geofence check is wrapped in
`if (matchedEmployee.workLocation)`.

**No site assigned means no location check at all.** Every self-registered
employee can clock in from home, from a bus, from anywhere — the flagship
anti-fraud feature is inert for exactly the people who registered themselves.

Same story for `shiftTemplate: null` → `computeClockInStatus` returns `VALID`
immediately → **they can never be marked late either.**

Nothing in the system tells HR these people need assigning. The employees page
shows an "Unassigned" badge, but nobody is prompted to act on it.

**Fix:**

1. **Add a site picker to the kiosk registration form.** Fetch active sites
   from `GET /api/v1/locations` and require one. A kiosk lives at a site — it
   should default to that site.
2. Better: bind the kiosk to its site. Give each site's kiosk its own URL
   (`?site=<id>`) or a stored device token, so the site is implied and can't be
   picked wrong. This also gives you per-site kiosk control later.
3. **Fail closed, not open.** In `scanner.js` and `clockout.js`, an employee
   with no `workLocation` should be **rejected** — "Your profile isn't assigned
   to a site yet. Please ask HR." Right now missing config silently disables a
   security control, which is the wrong default.
4. Add a dashboard banner: "4 employees need a site and shift assigned" with a
   link. Make the gap visible.
5. Make `PUT /api/v1/employees/:id` reject clearing `workLocation` to null for
   an active employee.

---

## A6. An employee who leaves can never come back, and a face can never be re-enrolled 🔴 CRITICAL

Two linked dead ends.

`DELETE /api/v1/employees/:id` is a soft delete — `isActive: false`. Good.

But `backend/routes/register.js` checks
`Employee.findOne({ $or: [{ phone }, { nationalId }] })` **without filtering on
`isActive`**. The deactivated record still owns that phone and Aadhaar. Re-
registration is refused: "An employee with this phone or Aadhaar number already
exists." The unique indexes on `phone` and `nationalId` enforce it at the
database level too.

Separately: `PUT /api/v1/employees/:id` has an `allowedFields` whitelist that
does not include `faceEmbedding`. **There is no way to update anyone's face.**
If recognition degrades — beard, weight change, an injury, a bad original
capture — the only route is deactivate and re-register, which the paragraph
above blocks. The employee is permanently unable to clock in.

Note `duplicateFaceCheck.js` filters `isActive: true`, so the *face* is free
again while the phone number is not. Inconsistent.

**Fix:**

1. Add `POST /api/v1/employees/:id/reenroll-face` (admin/HR only). Takes 2
   frames, runs liveness, runs duplicate check with
   `excludeEmployeeId: <this id>` (the parameter already exists in
   `duplicateFaceCheck.js` and is currently never used), then overwrites the
   embedding. Add a "Re-scan face" button on the employees page.
2. Add a "Rehire" flow: find the inactive record by phone/Aadhaar and reactivate
   it, keeping their history. Don't create a duplicate person.
3. Scope the registration duplicate check to `isActive: true`, and if an
   **inactive** match is found, return a specific response the kiosk can act
   on: "This person was registered before. Ask HR to reactivate their profile."
4. Store 3–5 embeddings per employee instead of one, and match against the best
   of them. Different angles and lighting make recognition markedly more
   reliable, and it makes one bad capture non-fatal.

---

## A7. The face matcher can pick the wrong person 🟠 HIGH

`ml-service/main.py` `/recognize-face` takes the highest cosine score above
`0.363` and calls it a match. Two problems.

**No margin check.** If the best match scores 0.40 and the second best scores
0.39, that's a coin flip — and the code returns the winner with no hesitation.
Siblings, cousins, or just similar-looking people will cross over. Someone's
hours get credited to someone else, and neither of them can explain it.

**The threshold is a 1:1 number used for 1:N.** 0.363 is OpenCV's published
threshold for "are these two photos the same person". You are asking a
different question — "which of 300 people is this" — and the chance of a false
match grows with every employee you add. At 300 employees you are running 300
comparisons per scan and accepting the max. Safe for a demo of 10 people.
Not safe for a payroll of 300.

**Fix:**

1. Add a margin requirement. Reject when the top two are too close:
   ```python
   MIN_MARGIN = float(os.getenv("MIN_MATCH_MARGIN", "0.06"))
   # ... track best_score and second_score in the loop ...
   matched = best_score >= COSINE_MATCH_THRESHOLD and (best_score - second_score) >= MIN_MARGIN
   ```
   Return `margin` in the response so you can tune it against real data.
2. Raise the threshold for identification — start at `0.45` via the existing
   `COSINE_THRESHOLD` env var and tune. A rejected scan costs one retry; a
   false match costs a wrong paycheque and your credibility.
3. When a match is rejected for a low margin, say something useful: "Couldn't
   confirm your identity clearly — try again facing the camera, or use Report
   an Issue."
4. Store `confidence` and `margin` on every `AttendanceLog` (confidence already
   is) and add a dashboard view of the lowest-confidence matches of the week.
   That's your early-warning system for accuracy drift.
5. Optional but valuable: an **employee ID + face** mode. The worker enters
   their 3-digit ID, then scans. That turns 1:N identification into 1:1
   verification, which is dramatically more accurate. Keep pure face scan as
   the fast path and this as the fallback when a scan fails twice.

---

## A8. The ML service re-downloads 38 MB of models on every cold start 🟠 HIGH

`ml-service/main.py` downloads YuNet and SFace from GitHub at import time if
they're missing. Render's free tier has an **ephemeral filesystem** — the disk
is wiped when the service spins down. So every cold start re-downloads both
models before the service can answer anything.

Two consequences: cold starts are far slower than the 30 seconds
`mlServiceCall.js` plans for, and **if GitHub is unreachable or rate-limits
you, the service fails to boot at all.** Not degraded — dead, and the exception
is raised at module level so uvicorn never starts.

**Fix:**

1. Commit the two `.onnx` files. They're gitignored today. 38 MB in git is
   unpleasant but it is far better than a hard external dependency on every
   boot. Use Git LFS if you'd rather.
2. Or bake them in at build time — put the download in Render's build command
   rather than at runtime, so it happens once per deploy on the build disk.
3. Either way, don't let a missing model kill the process. Catch it, serve
   `/health` with `"status": "degraded", "reason": "models unavailable"`, and
   let the backend surface a clear message instead of a timeout.
4. Add a real readiness probe: `/health` should confirm the models actually
   **loaded**, not just that Python is running.

---

## A9. The rate limiter will lock out a whole shift change 🟠 HIGH

`backend/server.js`: `scannerLimiter` allows **30 requests per minute per IP**.

Every worker at a site shares one Wi-Fi connection, so they all present the
**same public IP**. A shift change with 60 people arriving in a few minutes
blows straight past 30/minute, and workers 31 onward get "Too many requests.
Please wait before trying again." At the exact moment attendance matters most.

An offline-queue sync burst (A3) does the same thing.

**Fix:**

1. Raise `scannerLimiter` to something a real site can hit — 200/minute — and
   size it against your largest site's headcount, not a guess.
2. Rate-limit on identity, not IP, wherever you can. Face scans are anonymous
   until matched, so IP is all you have up front — but you can add a
   per-employee cooldown *after* the match (e.g. reject a second clock-in
   attempt within 60 seconds), which is the abuse you actually care about.
3. Keep `registerLimiter` tight (10/min). Registration is the expensive,
   abusable one and it isn't bursty.
4. Return a `Retry-After` header and show a countdown on the kiosk rather than
   a dead end.

---

## A10. MongoDB Atlas M0 has no backups 🟠 HIGH

The free tier has **no automated backups**. This database holds attendance
records that determine what people get paid. A bad script, a dropped
collection, or a compromised connection string means the payroll history is
gone with no recovery.

**Fix:**

1. Short term, free: a scheduled `mongodump` — a GitHub Actions cron on a
   schedule, writing an encrypted archive to a private bucket or repo. Daily,
   keep 30 days.
2. Proper: Atlas M10 or above for continuous backups. Put this in the
   commercials — it's part of what running a payroll system honestly costs.
3. Test a **restore**. An untested backup is a rumour.
4. Never let the backup dump sit anywhere public. It contains Aadhaar numbers.

---

## A11. There is no way to change a password 🟠 HIGH

`backend/routes/auth.js` has login, logout, me, create-user, deactivate-user.
No change-password. No reset. No forgot-password.

So the only way to rotate a password is for an admin to create a new account
and deactivate the old one. And if the **admin's** own password leaks, there is
no recovery path inside the app at all — you'd be editing the database by hand.

This is why the `radiance27` credentials you emailed can't currently be
rotated from the UI.

**Fix:**

1. `POST /api/auth/change-password` — requires current password, minimum 10
   characters, invalidates other sessions if you can.
2. `POST /api/auth/users/:id/reset-password` — admin sets a temporary password.
3. Add a `mustChangePassword` flag on `User`, default true for admin-created
   accounts. Force the change on first login. This is what makes handing out
   credentials safe.
4. Raise the minimum from 6 to 10 characters and reject the obvious ones.
5. Add basic lockout: 5 failed attempts on one account → 15 minute cooldown.
   The current limiter is per-IP, so it doesn't stop a distributed attempt on
   one known email.

---

## A12. Approving a regularization request doesn't fix the attendance 🟡 MEDIUM

`PUT /api/v1/regularization/:id` sets the status to APPROVED and stops there.
The actual attendance correction is a **separate** call to
`PUT /api/v1/attendance/manual`.

So HR approves "I forgot to scan out on Tuesday", feels finished, and Tuesday
is still wrong. The employee is still short their hours. They'll notice on
payday, not before.

**Fix:** on approval, apply the correction in the same transaction using the
`requestedClockIn`/`requestedClockOut` values already on the request. Show HR
exactly what will change before they confirm. If the correction fails, don't
mark it approved.

---

## A13. You can't tell which admin changed an attendance record 🟡 MEDIUM

`PUT /api/v1/attendance/manual` writes `Manually corrected by ${req.user.role}`
— the **role**, not the person. Every admin looks identical in the record.

When a worker disputes their hours and the record says "manually corrected by
admin", you cannot say who did it or when it happened, beyond the date. For a
system that decides pay, that's not good enough.

**Fix:**

1. Add an `AuditLog` model: `{ actor, actorName, action, targetModel, targetId,
   before, after, at, ip }`.
2. Log every attendance edit, employee deactivation, user creation/deletion,
   site change and regularization decision.
3. Add an "Activity" page for admins. Read-only, never deletable.
4. Put `markedBy: 'MANUAL'` edits in a distinct colour on the attendance table
   so an auditor can see at a glance which rows a human touched.

---

## A14. Absent, leave, weekly off and holidays are all the same thing 🟡 MEDIUM

`backend/routes/stats.js`: `absent = totalEmployees - presentToday`.

There is no leave model, no weekly off, no holiday calendar. So:
- Sunday shows your entire workforce as absent
- Approved leave looks identical to absconding
- Diwali looks like a company-wide walkout
- The daily digest emails HR a list of everyone who is legitimately off

HR will ask about this in the first ten minutes of the demo, because leave is
most of what HR actually does.

**Fix:**

1. `LeaveRequest` model: employee, type (casual/sick/unpaid/comp-off), from, to,
   reason, status, approver. Apply from the kiosk (face-authenticated, same as
   Report an Issue), approve on the dashboard.
2. `Holiday` model: date, name, and which sites it applies to (facility clients
   often differ).
3. `weeklyOff` on the employee or shift template — which days they're not
   expected.
4. Rework the stats: `expected = active − on_leave − weekly_off − holiday`, then
   `absent = expected − present`. Show all five numbers, not two.
5. Exclude leave and offs from the digest and from "absent".

---

## A15. No overtime, no half-day, no break deduction 🟡 MEDIUM

`totalHours` is raw clock-out minus clock-in. For payroll that isn't enough:
- Hours beyond the shift length are overtime, usually at a different rate
- An unpaid lunch break should come off the total
- Short days are often paid as half-days, not raw hours
- Night shifts sometimes carry a shift allowance

**Fix:** add to `ShiftTemplate`: `breakMinutes`, `overtimeAfterMinutes`,
`halfDayThresholdMinutes`. Compute and store `regularHours`, `overtimeHours`,
`isHalfDay` on each log at clock-out. Put them in the CSV as separate columns —
that is the sheet payroll actually needs, and it turns your export from "raw
data" into "ready to pay".

---

## A16. Smaller correctness items 🟡 MEDIUM

- **`parseFloat(latitude || 0)`** in `scanner.js` and `clockout.js`: a missing
  coordinate is stored as `0, 0` — a point in the Atlantic Ocean. Store `null`.
  Also, `latitude` of `0` is falsy and becomes `0` anyway, which is harmless
  here but the pattern is a trap. `geofence.js` already gets this right with
  explicit null checks — match it.
- **Liveness failure emails have no throttle.** `identifyAndVerify.js` calls
  `notifyAdmins` on every failure. Bad lighting at one site in the morning
  means dozens of emails, and Gmail's ~500/day limit means the one alert that
  matters gets dropped. Batch these into the daily digest, and only send
  immediately on a real pattern (3+ failures for one employee in an hour).
- **SMTP silently no-ops.** `notify.js` logs to console when `SMTP_*` isn't
  configured. Nothing tells you notifications aren't working, so HR will
  believe alerts are live when they aren't. Surface SMTP status on `/health`
  and put a warning banner on the dashboard.
- **`GET /api/v1/attendance` defaults to `limit: 100`** with no pagination and
  no total count. Past 100 records HR silently sees a truncated view with no
  indication. Add proper pagination with a total.
- **Supervisor scoping does two queries** (`supervisorEmployeeIds` fetches all
  employee ids, then filters logs by `$in`). At a few thousand employees that
  `$in` array gets large. Denormalise `workLocation` onto `AttendanceLog` (you
  already denormalise `siteName`) and filter on it directly.
- **The README describes a completely different project** — teachers, students,
  classes, `/api/students`. It's the original school project it was forked
  from. Anyone you hand this to will be misled, and it makes the work look
  careless. Rewrite it.
- **`/verify-faces` in the ML service appears unused.** Delete it or use it for
  the 1:1 verification mode in A7.
- **The ML service has no authentication.** Anyone who learns its Render URL
  can call `/extract-embedding` freely and burn your compute. Add a shared
  secret header the backend sends and the service requires.

---

# PART B — Real-world problems that aren't code bugs

The things that go wrong on site, with people, on a Tuesday.

---

## B1. Bad lighting at 6 AM and 9 PM

Facility work starts before sunrise and runs after dark. Your liveness check
measures Laplacian variance (sharpness) and rejects flat images. A dim, grainy
frame from a cheap tablet camera at 6 AM reads as flat. Workers get rejected as
suspected photo-holders while standing right there.

**Fix:** require a minimum brightness *before* running liveness, and if it's
too dark say so specifically — "Too dark to scan. Please turn on the light."
Add a screen-brightness flash from the kiosk as a fill light. Recommend a
cheap clip-on ring light per kiosk in the deployment guide; it's a ₹300 fix
for a problem that otherwise looks like broken software.

## B2. Wet hands, dust, sweat, masks, helmets

Housekeeping and maintenance staff arrive with dirty or wet hands — which is
exactly why face recognition beats fingerprint here, and worth saying out loud
in your advantages document. But masks, safety helmets, and hair coverings do
break face recognition.

**Fix:** detect a covered face and say which covering to remove. Give
supervisors a documented fallback (B4).

## B3. Old phones and dead tablets

The kiosk needs `getUserMedia` and HTTPS. Older Android browsers, low RAM, and
a 720p capture on a cheap tablet will be slow or fail outright.

**Fix:** write down a minimum device spec and test on the cheapest tablet
Radiance would actually buy — not on your laptop. Detect an unsupported browser
and say so plainly. Reduce capture to 640×480 (also helps A4).

## B4. What happens when it just doesn't work

Right now: nothing. A worker whose face won't scan has no path. They stand
there, then leave, then aren't paid.

**This is the single biggest adoption risk.** Not the technology — the absence
of a fallback. HR will not approve a system where a failure means someone
doesn't get paid.

**Fix:** a supervisor override. Supervisor logs into the dashboard on their
phone, marks the employee present, gives a reason, and it's logged as a manual
entry with their name on it (A13). Set a limit — 3 per employee per month —
and put overrides on a report so the pattern is visible rather than hidden.

## B5. GPS is easy to fake and inaccurate indoors

Browser geolocation can be spoofed with a fake-GPS app or dev tools. Indoors it
drifts 50–100 m, which is more than the 150 m default radius can absorb
reliably. So the geofence both **fails honest workers** (drift puts them
outside) and **can be defeated by dishonest ones** (spoofing).

**Fix:** treat the geofence as one signal, not proof. Log the distance on every
scan (you already capture the coordinates) and let HR see a "clocked in from
420 m away" report rather than only hard-blocking. Widen the radius to reduce
false blocks, and lean on the kiosk being a **fixed device at the site** (A5,
point 2) as the real control. A fixed tablet bolted to the wall is far stronger
than any GPS check — the URL being open to the whole internet is the actual
weakness.

## B6. Shared and changed phone numbers

`phone` is a unique index. Low-wage workers routinely share a family phone, and
change numbers often. Two genuine employees sharing one number cannot both
register — and the error tells them a duplicate exists, which sounds like an
accusation.

**Fix:** drop the unique constraint on `phone` (keep it on `nationalId`, which
genuinely is unique per person). Warn on a duplicate instead of blocking.

## B7. Aadhaar typos, and workers without one

Twelve digits typed on a tablet by someone in a hurry. There's no checksum
validation, so a typo creates a permanently wrong record — and since Aadhaar is
unique, the correct owner can't register later.

Some workers won't have an Aadhaar card to hand, or won't want to give the
number to a kiosk.

**Fix:** validate the Aadhaar **Verhoeff checksum** — it catches most typos in
a few lines of code. Allow alternative ID types (voter ID, PAN, driving
licence) with a `idType` field. And see C1 — you may not want to store the
full number at all.

## B8. Nobody assigns sites and shifts after registration

Registration is self-service; assignment isn't. Nothing prompts HR, so
employees sit unassigned indefinitely — which silently disables their geofence
and late detection (A5).

**Fix:** the dashboard banner in A5. Plus a weekly email: "6 employees have
been unassigned for more than 3 days."

## B9. One kiosk, sixty people, one shift start

Each scan is a camera capture plus three ML round trips. Even at 3 seconds
each, 60 people through one tablet is a 3-minute queue in the best case, and
much worse on a cold start.

**Fix:** measure the real per-scan time first, then size it — one kiosk per 30
people arriving in the same 15-minute window is a reasonable starting rule.
Speed up the matching (D1) — that's most of the latency. Show a queue position
so people don't tap repeatedly and make it worse.

## B10. Workers who can't read English

Your kiosk is entirely in English. Much of the workforce this is built for
won't read it comfortably.

**Fix:** Tamil and Hindi at minimum, given Radiance's location. Big icons,
minimal text, voice prompts for success and failure. Ask HR which languages
their sites actually need — good demo question, shows you're thinking about
their staff.

---

# PART C — Security, privacy and legal

Take this section seriously. Biometrics plus Aadhaar is the most regulated data
you could have picked.

---

## C1. Storing full Aadhaar numbers is a legal problem 🔴 CRITICAL

`nationalId` holds all 12 digits in plaintext in MongoDB. The API masks it on
read (`getMaskedNationalId`) — good — but the raw number sits in the database,
in every backup, and in any dump.

Two issues. The **Aadhaar Act** restricts storing Aadhaar numbers, and the
penalties for unauthorised storage are not trivial. The **DPDP Act 2023**
treats this as personal data requiring purpose limitation, security safeguards
and deletion on request. Face embeddings are biometric data under the same law.

You do not need the full number. You need to identify a person uniquely.

**Fix:**

1. Store `nationalIdLast4` (plain, for HR to eyeball) plus
   `nationalIdHash` = HMAC-SHA256 of the full number with a server-side secret.
   Uniqueness works on the hash. Drop the plaintext field.
2. Migrate what's there: compute hashes, then unset the plaintext.
3. If Radiance's legal position genuinely requires the full number, encrypt it
   at rest with a key held outside the database, and restrict read access to
   admin with an audit entry per read.
4. Never put Aadhaar in the CSV export.
5. Never log it.

## C2. There's no privacy policy, retention rule, or deletion path 🟠 HIGH

You collect a consent checkbox at registration and store `consentedAt` — that's
genuinely more than most projects do. But there is no policy document, no
retention period, and no way to delete someone's biometric data.

Under DPDP, someone can ask for their data to be erased. Today you have no
answer.

**Fix:**

1. Write a one-page privacy notice: what's collected, why, who sees it, how
   long it's kept, how to request deletion. Show it on the kiosk **before** the
   consent checkbox, not as a line of small print.
2. Set a retention period: attendance for 3 years (payroll audits), face
   embeddings deleted 30 days after an employee is deactivated.
3. Build `DELETE /api/v1/employees/:id/biometrics` — wipes the embedding,
   keeps the attendance history for payroll. Add it to the UI.
4. Add a scheduled job to purge embeddings for long-inactive employees.
5. Document that you store a mathematical embedding, **not a photograph**. That
   is a genuinely strong privacy answer and it will help you with both HR and
   the workers. Which brings up —

## C3. Your email to Srivathsan described this wrongly

You wrote: *"the backend will save the picture of the employee and it will be
stored in the database."*

It doesn't. `Employee` stores `faceEmbedding` — an array of 128 numbers — and
no image. The photo is discarded after the embedding is extracted.

This is better for privacy, but you told the owner something inaccurate about
his own system. Correct it when you next write, and use it as a selling point.

Separately, HR will probably *want* a photo — to confirm which Ramesh Kumar
EMP-003 is, and for ID cards. Decide deliberately: add an optional stored
photo (with its own consent line and retention rule), or explain why you
don't. Either is defensible; not having thought about it isn't.

## C4. The kiosk URL is open to the entire internet 🟠 HIGH

`radiance-app-beta.vercel.app` is public. Anyone can open it, register
themselves as a Radiance employee, and clock in. The only barriers are the
geofence — inert for self-registered users (A5) — and liveness.

**Fix:**

1. Require a device token: a per-site secret in the kiosk's environment, sent
   as a header and validated by the backend. An unregistered device gets
   nothing.
2. Add Vercel password protection or an IP allowlist to the scanner deployment
   as a quick immediate win.
3. Move registration behind HR approval regardless (see the todo list) — a
   registration should create a **pending** profile that can't clock in until
   approved.

## C5. The JWT sits in localStorage 🟡 MEDIUM

`frontend/lib/api.ts` stores the token in `localStorage` — a deliberate,
documented choice to work around Safari's third-party cookie blocking. That
reasoning is sound. But any XSS on the dashboard reads the token and gets a
7-day session.

**Fix:** shorten the token to 8 hours with a refresh token in an httpOnly
cookie. Add a strict Content-Security-Policy on the dashboard. Add
`SameSite=Strict` where it works. This is a real tradeoff, not a mistake —
just don't leave the 7-day window sitting in localStorage.

## C6. CORS allows requests with no origin 🟡 MEDIUM

`middleware/cors.js`: `if (!origin) return callback(null, true)`. Any
non-browser client — curl, Postman, a script — passes. The comment explains why
(mobile apps), but there is no mobile app.

Not catastrophic, since the sensitive routes require a JWT. But it means the
public `/register` and `/clock-in` endpoints are scriptable at will. Combined
with C4, someone could enrol identities in bulk.

**Fix:** drop the no-origin allowance, or gate it behind the device token from
C4.

---

# PART D — Scale: what breaks as you grow

Today at 10 employees everything is fine. Here's where the walls are.

## D1. Every scan compares against every employee 🟠 HIGH

`identifyAndVerify.js` loads **all** active employees with embeddings from
MongoDB, builds a `candidates` object, and POSTs the whole thing to the ML
service. Then `main.py` loops over them in Python, calling
`recognizer.match()` once per candidate.

| Employees | Payload per scan | Comparisons per scan |
|---|---|---|
| 50 | ~70 KB | 50 |
| 500 | ~700 KB | 500 |
| 2000 | ~2.8 MB | 2000 |

At 2000 employees you send 2.8 MB over the network and run 2000 sequential
OpenCV calls **for every single scan**. Sixty people at a shift change becomes
168 MB of traffic and 120,000 comparisons. It will time out.

**Fix — three steps, in order of payoff:**

1. **Vectorise the matching.** Replace the Python loop with one NumPy
   operation. Normalise the embeddings and take a single matrix-vector dot
   product — cosine similarity for all candidates at once. Roughly 100× faster
   for a few lines of change, and it gives you the second-best score for free
   (A7).
2. **Filter by site before comparing.** A worker at site A only needs to be
   matched against site A's roster. The kiosk already knows its site once you
   do A5. This cuts the candidate set by however many sites Radiance runs — a
   bigger win than any micro-optimisation.
3. **Cache the embeddings in the ML service.** Stop shipping them on every
   request. Push them once when they change (`POST /sync-embeddings`) and keep
   them in a NumPy array in memory. Payload per scan drops to just the probe
   image.

## D2. Render's free tier will run out mid-month 🟠 HIGH

`render.yaml` sets `plan: free` on both services. `DEPLOYMENT.md` then tells
you to ping both every 5 minutes with UptimeRobot to stop them sleeping.

Free instance hours are limited per account per month. Two services pinged
awake 24/7 is roughly 1,460 instance-hours a month — well past the free
allowance. **Both services stop partway through the month.** Meanwhile, not
pinging them means cold starts and the model re-download in A8.

There is no configuration that makes this work. Verify the current numbers on
Render's pricing page, then price the paid tier.

**Fix:** move both services to a paid plan. Get the real monthly figure —
backend + ML service + Atlas above M0 + domain + SMTP — and put it in the
commercials. A payroll system on a free tier isn't a cost saving; it's an
outage waiting for a payday.

## D3. The registration mutex only works in one process 🟡 MEDIUM

`utils/asyncMutex.js` is honest about this in its own comment: it's a
process-local lock. The moment you scale to two instances, two simultaneous
registrations of the same face can both pass the duplicate check — which is
exactly the buddy-punching setup the check exists to stop.

**Fix:** a MongoDB-backed lock (insert a uniquely-indexed lock document, delete
it after) before you ever run more than one instance. Cheap now, and it removes
a landmine.

## D4. Unbounded queries 🟡 MEDIUM

`GET /api/v1/employees` returns every employee with five `populate` calls and
no limit. `GET /api/v1/regularization` returns every request ever. Both get
slow and eventually time out.

**Fix:** pagination, server-side search, and a default date window on the
regularization queue.

## D5. No tests, no CI, no error tracking 🟠 HIGH

You said you want to avoid errors in the near future. This is how.

There is not a single test in the repo. Every one of the bugs in Part A would
have been caught by a handful of them — especially the timezone bug, which is
the kind of thing that is nearly invisible by inspection and completely obvious
under a test with the clock set to UTC.

**Fix:**

1. Jest + supertest on the backend. Cover: clock-in creates a log; second
   clock-in same day works; late detection with the server clock in UTC;
   night-shift clock-out isn't flagged early; geofence rejects out-of-radius;
   duplicate face is refused; a supervisor can't read another site's data.
2. Pytest on the ML service: a known face pair matches, two different faces
   don't, a static duplicated frame fails the motion check.
3. GitHub Actions running both on every push.
4. **Sentry** on all three services. Render's free logs are ephemeral — right
   now a 500 in production leaves no trace you can investigate. This is the
   single highest-value addition for "don't get errors in the near future",
   because it turns invisible failures into a notification.
5. A seed script that generates realistic fake data — 200 employees, 3 sites,
   30 days of attendance. You cannot find performance and pagination problems
   against 5 test records.

---

# PART E — Upgrades that move this to the next level

Part A and B make it correct. This makes it a product.

## E1. Finish the billing story — the highest-value feature you can add

`frontend/app/dashboard/billing/page.tsx` is only service-tag configuration.
But you already denormalise `siteName` and `service` onto every attendance log
(a genuinely smart decision), which means you are one step from something
Radiance would pay for on its own.

A facility management company's core problem is **invoicing clients for hours
worked at their site.** Attendance is the input; the invoice is the output.

**Build:** a rate card (rate per service per site, per hour or per shift), then
a monthly invoice generator — hours by site by service, multiplied by the rate,
exported as PDF. Add a "billable vs paid hours" margin view per site.

This changes your pitch from "we track attendance" to "we bill your clients
correctly." That's a different conversation about price.

## E2. WhatsApp notifications instead of email

Your workforce doesn't read email. Everyone has WhatsApp.

**Build:** WhatsApp Business API (or Twilio) for: clock-in confirmation, "you
haven't clocked in and your shift started 15 minutes ago", monthly attendance
summary, leave approval. Supervisors get a daily site summary.

Costs a small amount per message. Include it in the commercials.

## E3. Supervisor mobile view

Supervisors are walking around a site, not sitting at a desk. Give them a
phone-first view: who's present right now, who's missing, one-tap override
(B4), and a photo-attached incident note.

Ship it as a PWA — installable, offline-tolerant, no app store.

## E4. Rosters and scheduling

Right now an employee has one shift template, forever. Real facility work is
rostered — different shifts on different days, rotating night duty, planned
cover for leave.

**Build:** a weekly roster grid per site. Assign shifts per employee per day.
Then "absent" means "rostered and didn't show", which is the number that
actually matters — and it makes the whole late/absent calculation meaningful.

## E5. Payroll export that plugs into something

Add exports in the formats Indian payroll software actually ingests, with PF
and ESI columns, and a per-employee monthly summary — days present, leave
taken, overtime hours, late marks. Ask HR what they use today and match it
exactly. Being the system that drops straight into their existing process is
worth more than any feature.

## E6. Anomaly detection

You already log confidence, liveness scores and spoof attempts. Use them.

**Build:** a weekly report flagging patterns — someone always clocking in
exactly at the grace-period edge, repeated low-confidence matches for one
person, clock-ins from an unusual distance, one employee generating most of the
liveness failures. Simple rules, no ML needed. This is the kind of thing that
makes a system feel intelligent, and it's mostly SQL over data you already have.

## E7. Photo-on-scan for audit

Store a low-resolution snapshot on each clock-in for 7 days, then auto-delete.
When a worker disputes a record, HR can look. Needs its own consent line and a
strict retention rule (C2) — but it resolves disputes that are otherwise
unresolvable.

## E8. Kiosk hardening

Fullscreen kiosk mode, no address bar, no navigation away. Auto-reset to the
landing screen after 20 seconds idle so one worker's session never bleeds into
the next. A visible "Site: Anna Nagar · Online" status bar. A supervisor PIN
to exit kiosk mode.

## E9. Multi-tenancy — the long game

If this works for Radiance, it works for other facility companies. That means
a `Company` model at the root of every query, subdomain-per-tenant, and
per-tenant configuration.

Do **not** build this now. But make one decision now that keeps the door open:
put a `company` field on the core models from the start. Retrofitting tenancy
into a live schema is a rewrite; carrying an unused field is free.

---

# PART F — What HR will ask, and how to answer

Read this before the demo. Short honest answers beat confident vague ones — and
where the answer is "not yet", say so and say when.

### "What if the system doesn't recognise someone?"
They retry. If it fails again, the supervisor marks them present from their
phone with a reason, and it's logged with the supervisor's name. Nobody misses
pay because of a scan failure. *(Build B4 first — don't promise this until it
exists.)*

### "What if the internet goes down?"
The kiosk keeps working and stores scans locally, then syncs with the original
scan time when the connection returns. *(Build A3 and A4 first. Today it
records the wrong time and breaks after ~12 scans — do not claim this yet.)*

### "Can someone clock in for a friend?"
Three barriers. The face has to match. A liveness check rejects a held-up
printed photo by looking for natural movement between two frames. And one face
can only ever be registered to one employee, so nobody can enrol a second
"ghost" profile. Be honest about the limit: a video played on a phone screen
could potentially pass, which is why every failed attempt is logged and
reported.

### "Can they clock in from home?"
Once a site is assigned, no — they must be within the site's radius. *(Fix A5
first. Today anyone who registered at the kiosk has no site, so they can.)*

### "Who can see the employees' Aadhaar numbers?"
The dashboard only ever shows the last 4 digits. *(After C1, the full number
isn't stored at all — that's a much better answer, so build it before the
demo.)*

### "Where are the photos stored?"
No photograph is stored. The system converts the face into a list of numbers
that can't be turned back into an image, and discards the photo. This is a
genuinely strong answer — lead with it.

### "What happens when someone leaves?"
Their profile is deactivated, attendance history is kept for payroll, and their
face data is deleted after 30 days. *(Build C2.)*

### "Can we correct a mistake?"
Yes. The employee reports the issue at the kiosk, HR reviews and approves it,
and the record is corrected with a note showing who changed it and when.
*(Build A12 and A13 — today approving doesn't actually correct anything.)*

### "How do we handle leave and weekly offs?"
Be straight: not built yet. It's the next thing after go-live, and you'd like
their input on what leave types they use. Then build A14.

### "Does it handle night shifts?"
Yes, including shifts crossing midnight. *(Fix A1 first. Today night workers
are wrongly flagged as leaving early.)*

### "Can we get the data into our salary sheet?"
Yes, CSV export filtered by date, site and service. Ask what format they use
today and match it (E5). *(Fix A1 first, or every time in the file is wrong.)*

### "How many people can it handle?"
Comfortable at a few hundred once the matching is optimised (D1). Be honest
about where the current ceiling is rather than guessing high.

### "What if someone forgets to clock out?"
An automatic sweep closes the record at their scheduled shift end and flags it
as auto-closed, so it's visible rather than silently wrong. Already built and
working.

### "Who pays for the tablet at each site?"
Their call — decide your recommendation before the demo. A basic Android tablet
with a wall mount and a ring light, roughly costed.

### "What if you're not available later?"
The honest answer, and the one that builds trust: the code is documented, it's
in a repository they own, and you'll write a handover guide. Then agree a
support arrangement in writing.

### "How do we know it's secure?"
Passwords hashed with bcrypt, sessions expire, three permission levels with
supervisors locked to their own site, rate limiting, and every failed liveness
check logged. Then name the gaps you're fixing rather than waiting to be
caught: password rotation (A11), audit logging (A13), Aadhaar storage (C1).

---

# PART G — Build order

Don't build top to bottom. Build in this order.

## Phase 1 — Before HR sees it (must-do)

Wrong numbers destroy trust permanently. Fix these first.

1. **A1** — timezone. Everything else is meaningless until times are right.
2. **A2** — multiple sessions per day. Schema change; do it before real data.
3. **A5** — site on registration, fail closed without one.
4. **A11** — change-password, and rotate `radiance27`.
5. **A6** — face re-enrolment and rehire.
6. **A9** — raise the rate limit.
7. **D5 (Sentry only)** — so you can see what breaks.

## Phase 2 — Before real payroll depends on it

8. **A3 + A4** — offline queue timestamps and IndexedDB.
9. **A7** — match margin and threshold.
10. **C1** — stop storing full Aadhaar.
11. **A10** — backups.
12. **A8** — commit the models.
13. **B4** — supervisor override.
14. **A12 + A13** — regularization actually corrects; audit log.
15. **D2** — paid hosting.

## Phase 3 — What HR will demand within a month

16. **A14** — leave, holidays, weekly offs.
17. **A15** — overtime and half-days.
18. **C2** — privacy policy, retention, deletion.
19. **C4** — device-bound kiosk.
20. **D1** — vectorised, site-filtered matching.
21. **D5 (tests + CI)**.
22. **B10** — Tamil and Hindi.

## Phase 4 — The upgrade that changes the price

23. **E1** — invoicing. Build this one properly.
24. **E2** — WhatsApp.
25. **E3** — supervisor mobile.
26. **E4** — rosters.
27. **E5** — payroll export.

## Phase 5 — Later

28. E6 anomaly detection · E7 audit photos · E8 kiosk hardening
29. E9 multi-tenancy — decision now (add the `company` field), build later.

---

## Two things to keep in mind

**A1 is the whole ball game.** Every time in the system is wrong by 5h30m
right now. A demo where the clock-in says 03:35 instead of 09:05 ends the
conversation, and no amount of good architecture underneath will save it.

**Fail closed, not open.** The same pattern shows up three times — A5 (no site
means no geofence), A9 (throttling blocks real workers), C6 (no origin means
allowed). Missing configuration currently disables security controls silently.
Flip the default: when the system doesn't know, it should refuse and say why.

---

# Known gaps (as of the ArcFace switch)

Everything in Parts A–D above is fixed and deployed. This is what is
genuinely still open, in the order it matters. Hosting/infra is covered
separately in `DEPLOYMENT.md`.

## Blocking a real rollout

**1. Nobody has scanned a real face yet.**
Every accuracy figure in this document comes from LFW — public celebrity
photographs, with dim and blurry conditions *simulated*. Not one actual
Radiance employee has scanned at an actual kiosk in actual 6 AM light. The
model comparison is sound (both models got identical inputs), but the
absolute numbers will move. This is the single biggest unknown and only a
pilot resolves it.

**2. Kiosk device tokens are still off** (`kiosk.configured: false`).
The scanner is reachable by anyone who finds the URL, and without a site
token every scan compares against all 4,000 employees instead of that
site's ~200 — slower and measurably less accurate. Set `KIOSK_DEVICES` and
`KIOSK_ENFORCE=true` per `DEPLOYMENT.md`.

**3. Liveness is a heuristic, not a trained model.**
Texture, glare, and inter-frame motion. It defeats a printed photo. It would
probably *not* defeat a video of a colleague played on a phone — and
buddy-punching is the main fraud this system exists to prevent. A passive
anti-spoofing model (e.g. Silent-Face-Anti-Spoofing) is the real fix. Until
then, every failure is logged and attributed, which is mitigation, not a
solution.

**4. No error tracking.**
Render's logs are ephemeral. A 500 in production currently leaves no trace to
investigate. Sentry has a working free tier; this is an hour of work and the
highest-value thing on this list after the pilot.

## Should be done before payroll depends on it

**5. No load test against the deployed service.**
Throughput was measured per-scan and the capacity figures are arithmetic from
that, not from firing concurrent requests at production. The 15-minute shift
change has ~1.8x headroom on paper. Worth proving before trusting.

**6. Retention is a manual endpoint, not a policy.**
`DELETE /employees/:id/biometrics` exists, but nothing runs on a schedule.
The DPDP position stated to HR — face data erased 30 days after an employee
leaves — is currently a promise, not an enforced job.

**7. No privacy notice document.**
Consent is captured and versioned at the kiosk, but there is no one-page
notice explaining what is collected, why, who sees it, and how to request
deletion. HR will ask, and it should exist before the demo.

**8. Restore has never been tested.**
Once backups are on (M10+), restore one. An untested backup is a rumour.

## Worth doing, not urgent

**9. No frontend tests.** Backend has 86 and the ML service has 5; the
dashboard has none beyond a type check.

**10. No staging environment.** Every push deploys straight to production.
A `staging` branch and a second Render/Vercel target would make a bad deploy
a non-event.

**11. The ML service is single-threaded** for detection and embedding
(`_engine_lock`). Correct on one CPU, but it is the ceiling if the instance
ever gets more cores.
