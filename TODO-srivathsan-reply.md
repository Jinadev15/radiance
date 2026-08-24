# Todo — after Srivathsan's reply (24 Aug 2026)

He asked for 3 things, in this order:
1. Get the **HR team's agreement** first (he won't decide without it)
2. Then a list of **advantages**
3. Then a **time frame** and the **commercials** (your price)

So HR is the gate. Everything below is ordered around that.

---

## STEP 1 — Fix these before HR sees the system

These are things HR will hit in the first 10 minutes. Fix them first.

- [ ] **Change the dashboard password.**
      You emailed `radiance27@gmail.com` / `radiance27` in plain text to 4 people.
      Problem: there is **no "change password" screen in the app right now**.
      Admin can only create users and delete users (`backend/routes/auth.js`).
      Do this: add a change-password route + screen, OR create a fresh admin
      account with a strong password and delete the old one.

- [ ] **Make one login per person, not one shared login.**
      Right now everyone would share `radiance27`. If 3 HR people share one
      account, the dashboard can't show who did what. Create a separate
      account for each HR person and each supervisor.

- [ ] **Move off the free hosting plan.**
      `render.yaml` has `plan: free` for both the backend and the face-recognition
      service. Free plans go to sleep when unused. That means the **first employee
      to clock in each morning waits ~50 seconds** while the server wakes up.
      With a whole shift arriving at 9am, this will look broken to HR.
      This costs real money per month — and that number goes into your
      commercials answer, so work it out now.

- [ ] **Decide who is allowed to register a new employee.**
      Today anyone can walk up to the scanner and register themselves. The app
      checks that the phone is 10 digits and Aadhaar is 12 digits, but it does
      **not verify that the person actually works for Radiance**.
      HR will 100% ask "what stops a fake employee being added?"
      Two options — pick one:
      - Add an approval step: new registrations wait until HR approves them
      - Or turn off self-registration and let only HR/admin add employees
      Option 1 is better (less work for HR), but option 2 is faster to build.

---

## STEP 2 — Show it to HR and get their agreement

- [ ] **Find out who to contact.** Pradeep and your mother (prabavathy) were
      both on the email. Ask them who in HR handles attendance day to day.

- [ ] **Book a demo.** In person or a screen share. Don't just send URLs —
      Srivathsan didn't open them, and HR probably won't either.

- [ ] **Let them do it themselves.** Don't demo it for them. Hand it over and
      let one HR person register a real employee and clock them in and out.
      What confuses them is what you need to fix.

- [ ] **Write down every complaint.** Even small ones. This list becomes your
      next round of work, and it's proof to Srivathsan that HR was involved.

- [ ] **Ask them how they track attendance today.** Register book? Excel?
      Biometric machine? You need this to write the advantages — you can't say
      "this saves time" without knowing what it's replacing.

- [ ] **Get a clear yes in writing.** An email from HR saying they're happy
      with it. That is the "concurrence" Srivathsan asked for.

---

## STEP 3 — Things HR will ask. Have answers ready.

- [ ] What if the internet is down at a site?
- [ ] What if an employee's face isn't recognised? (Is there a manual override?
      → You have a "regularization request" feature — know how to show it.)
- [ ] Can someone clock in from home? (→ You have geofencing per site. Show it.)
- [ ] Can someone hold up a photo to fool it? (→ You have a liveness check and
      you log spoof attempts. Show that log.)
- [ ] Who can see employees' photos and Aadhaar numbers?
- [ ] What happens to an employee's face data when they leave?
- [ ] Whose phone or tablet runs the scanner at each site? Who pays for it?
- [ ] Night shift crossing midnight — does it count correctly?
- [ ] Can we get the data into our salary sheet? (→ Yes, CSV export. Show it.)

---

## STEP 4 — Write the advantages document

Only after HR says yes. Keep it to one page. Compare against **how they do it
today**, not against nothing.

Things you already built that are worth listing:
- [ ] Face recognition clock in/out — no buddy punching, no signing for a friend
- [ ] Geofencing — can only clock in at the actual site
- [ ] Anti-spoofing with a log of attempts
- [ ] Duplicate face check — same person can't register twice
- [ ] CSV export straight into salary calculation
- [ ] 3 access levels — Admin, HR, Supervisor (supervisors see their site only)
- [ ] Shift templates with a grace period for late arrivals
- [ ] Auto clock-out if someone forgets
- [ ] Regularization requests for fixing mistakes
- [ ] Live dashboard — see who is present right now, per site

For each one, write the benefit in money or time. Example: "no buddy punching"
→ "stops paying for hours nobody worked".

---

## STEP 5 — Write the time frame

Give ranges, not exact dates. Rough shape:

- [ ] Fixes from Step 1 — how many days?
- [ ] HR training — half a day?
- [ ] Pilot at ONE site first — 1 to 2 weeks
- [ ] Enrolling employees — work out minutes per person × headcount, per site
- [ ] Roll out to remaining sites — depends on how many sites they have
- [ ] **Ask how many sites and how many employees.** You cannot answer this
      question without those two numbers.

Recommend starting with one site as a pilot. It's an easier yes for him than
"switch everything over".

---

## STEP 6 — Work out the commercials

This is the important one. Three separate numbers — don't mix them up:

- [ ] **One-time setup fee** — building it, deploying it, training, enrolling
      employees. What you charge for the work already done plus the work left.
- [ ] **Monthly running cost** — hosting (backend + face service), database,
      and any per-scan charges. This is a real recurring bill someone has to
      pay. Get the actual figures before you quote.
- [ ] **Support and maintenance** — are you fixing bugs for free forever? For
      how long? What happens after? Put a limit on it now, in writing.

Also decide:
- [ ] Does the company own the code, or are you licensing it to them?
- [ ] What if they ask for new features later — included, or charged separately?

Note: you're his employee's son, so it's tempting to underprice or say "free".
Don't. He asked for commercials, which means he expects to pay. A price of zero
makes it look like a hobby project instead of a system they should rely on.

---

## STEP 7 — Reply to Srivathsan

- [ ] Short reply now (today), so he knows you got it:
      "Thanks — I'll take this to the HR team and come back with the advantages,
      timeline and commercials once they've reviewed it."
- [ ] Keep Pradeep and prabavathy on Cc, same as he did.
- [ ] Then the full reply with all 3 answers **after** HR agrees.
- [ ] Don't send the price before HR says yes. He asked for them in order —
      follow his order.

---

## Order of work, short version

1. Fix password + separate logins
2. Decide the registration approval question
3. Sort out paid hosting (and note the cost)
4. Short holding reply to Srivathsan
5. Demo to HR, collect their feedback
6. Fix what HR raises
7. Get HR's yes in writing
8. Send advantages + timeline + price
