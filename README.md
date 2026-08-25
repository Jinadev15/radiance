# Radiance — Face Recognition Attendance System

Attendance and payroll-hours tracking for a facility management company:
employees clock in and out by face from their own phones, and HR manages the
roster, leave, and payroll exports from a dashboard.

Built for ~4,000 employees across ~126 client sites, where the largest single
site has around 200 people and shifts often start before sunrise.

---

## What it does

**On the employee's phone:**
- Clock in / out by face — no cards, no PINs, no shared tablet to queue at
- Anti-spoofing: a trained passive model runs on every scan, so a photo or a
  video of a colleague played on another phone is rejected
- Geofenced — a scan is only accepted inside a site's radius, and the site
  itself is derived from the phone's GPS
- One phone cannot hold two people clocked in at once, so a single handset
  cannot walk the floor clocking in a whole shift
- Self-registration with consent capture, held for HR approval
- Works offline: scans queue on the device and replay with their *original*
  capture time when the connection returns
- Self-service: check your own last 7 days, report a missed scan, request leave

**In the dashboard:**
- Live attendance, per-site breakdown, and trends
- Employee roster with an approval queue for self-registrations
- Leave requests and a per-site holiday calendar
- Regularization: an employee reports a missed scan, HR approves, and the
  attendance record is corrected in the same action
- Payroll CSV with regular/overtime hours split, break deduction, and half-days
- Supervisor override for when face scanning genuinely cannot be used
- Append-only audit log — every correction attributed to a named person
- Three roles: Admin, HR, and Supervisor (scoped to their own site)

---

## Architecture

| Piece | Stack | Role |
|---|---|---|
| `frontend/` | Next.js + TypeScript | HR/Admin/Supervisor dashboard |
| `scanner/` | React + Vite | The page employees open on their phone |
| `backend/` | Node + Express + Mongoose | All business logic and authorisation |
| `ml-service/` | Python + FastAPI + ONNX Runtime | Face detection, embedding, liveness |
| database | MongoDB | Employees, attendance, leave, audit |

### How a clock-in works

1. The phone captures two frames and posts them with GPS, GPS accuracy, an
   anonymous device id, and the capture time
2. Backend asks the ML service for a face embedding
3. The ML service matches it against its **resident roster cache** — the
   embeddings live in its memory, so a scan sends only the probe vector
4. The match must clear a similarity threshold **and** beat the runner-up by a
   margin, otherwise it is refused rather than guessed
5. Backend re-checks the matched employee against the database (the database,
   not the cache, is the authority on who may clock in), enforces the geofence,
   then opens or closes an attendance session

The GPS is used before step 2, not just for the geofence: the coordinates
resolve to a site, and matching is scoped to that site's roster (~200 people)
rather than all 4,000. Fewer candidates is both faster and materially less
likely to produce a false match.

### Face recognition

- **Detection & alignment:** OpenCV YuNet, run on a downscaled copy for speed
  with coordinates mapped back so embeddings use full-resolution pixels
- **Recognition:** ArcFace MobileFaceNet (512-d), chosen by benchmarking
  against SFace over 1,200 real LFW identities including unenrolled "stranger"
  probes. At a matched ~1% stranger-acceptance rate it identified 91.8% of
  people in dim light versus SFace's 84.2% — the deciding case, since shifts
  start before sunrise
- Every embedding records which model produced it; vectors from different
  models are never compared, because cross-model similarity is meaningless

---

## Running locally

**Prerequisites:** Node 18+, Python 3.11+, MongoDB (optional — the backend
falls back to an in-memory database in development)

```bash
# ML service — downloads its models on first boot
cd ml-service && pip install -r requirements.txt && python main.py

# Backend
cd backend && npm install && cp .env.example .env && npm run dev

# Dashboard
cd frontend && npm install && npm run dev

# Scanner (the page employees open on their phone)
cd scanner && npm install && npm run dev
```

Create the first admin login:

```bash
cd backend
ADMIN_EMAIL="you@example.com" MONGODB_URI="<uri>" node create-admin.js
```

See `backend/.env.example` for every setting. Three are required in
production and the server refuses to boot without them: `JWT_SECRET`,
`MONGODB_URI`, and `NATIONAL_ID_HMAC_SECRET`.

---

## Tests

```bash
cd backend && npm test          # 86 tests, real MongoDB via memory-server
cd ml-service && pytest         # detection scaling and coordinate mapping
cd frontend && npx tsc --noEmit # type check
```

Backend tests run against a real MongoDB rather than mocks, because the bugs
that matter here are timezone handling, unique-index behaviour under
concurrency, and query-count regressions — none of which a mock would catch.

---

## Design decisions worth knowing

**Everything is computed in a business timezone, never the server's.**
`utils/tz.js` is the only place dates and times are derived. Hosts run UTC; a
"09:00" shift compared in server time silently meant 14:30 IST, so nobody was
marked late until mid-afternoon and every completed night shift was flagged as
leaving early.

**Attendance is stored per session, not per day.** Multiple sessions per day
are normal — a lunch break, a second shift, or simply tapping the wrong button
and correcting it.

**Security controls fail closed.** No site assigned means no clock-in, not an
unchecked one. A face match too close to call is refused, not guessed. A roster
cache whose version cannot be confirmed is rebuilt, not trusted.

**National ID numbers are never stored in full** — only a keyed HMAC (for
uniqueness) plus the last four digits (for HR to eyeball), with Verhoeff
checksum validation to catch typos at entry.

**`/api/v1/health` reports what each dependency actually believes** — database,
ML service, roster cache version, SMTP, scanner model — rather than just "the
process is running". It has caught two production bugs that were otherwise
completely silent.

---

## Deployment

See `DEPLOYMENT.md`, including the sizing this scale actually requires — the
free tiers are fine for a single-site pilot and are **not** sufficient for the
full rollout.

## Status

Production-deployed. See the "Known gaps" section of `PROJECT-REVIEW.md` for
what still needs doing before this is the system of record for payroll.
