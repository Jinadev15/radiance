# Deploying Radiance (free hosting)

Four pieces, four places they live:

| Piece | Host | Repo folder |
|---|---|---|
| Dashboard (admin site) | Vercel | `frontend/` |
| Scanner kiosk | Vercel | `scanner/` |
| Backend API | Render | `backend/` |
| Face-recognition service | Render | `ml-service/` |
| Database | MongoDB Atlas | — |

Do these **in order** — later steps need URLs/values produced by earlier ones.

---

## 1. MongoDB Atlas (the database)

1. Go to https://www.mongodb.com/cloud/atlas/register and create a free account.
2. Create a new **free M0 cluster** (it will suggest this by default — don't pick a paid tier).
3. When it asks for a username/password for database access, create one and **save the password somewhere** — you'll need it in step 3.
4. Under **Network Access**, add IP address `0.0.0.0/0` ("allow access from anywhere"). This is safe here because the database still requires the username/password — it just means Render's servers (which don't have a fixed IP) are allowed to reach it.
5. Click **Connect** on your cluster → **Drivers** → copy the connection string. It looks like:
   `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Edit it: replace `<username>`/`<password>` with your real ones, and add a database name before the `?`, e.g.:
   `mongodb+srv://myuser:mypass@cluster0.xxxxx.mongodb.net/radiance?retryWrites=true&w=majority`
7. Save this full string somewhere — this is your `MONGODB_URI`.

## 2. Render (backend + face-recognition service)

1. Go to https://render.com and sign up (use "Sign up with GitHub" — makes the next step easier).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub account if asked, then select this repository. Render will find the `render.yaml` file at the root and detect **two services**: `radiance-backend` and `radiance-ml-service`.
4. Before it deploys, it'll ask you to fill in a few values for `radiance-backend` (leave `radiance-ml-service` as-is, it needs nothing extra):
   - `JWT_SECRET` — any long random string. Easiest: run this on your own computer and paste the result: `openssl rand -hex 48` (or just mash your keyboard for 40+ random characters — it just needs to be unguessable).
   - `MONGODB_URI` — the connection string you saved in step 1.
   - `ML_SERVICE_URL` — leave a placeholder like `http://localhost:8000` for now, you'll fix this in step 5.
   - `FRONTEND_URL` and `SCANNER_URL` — also leave placeholders for now (e.g. `http://localhost:3000`), you'll fix these in step 4.
5. Click **Apply** / **Deploy Blueprint**. Both services will start building — this takes a few minutes the first time (the face-recognition service downloads its models automatically on first boot, so it may take a little longer than the backend).
6. Once both show **Live**, click into each and copy its URL from the top of the page — they'll look like `https://radiance-backend-xxxx.onrender.com` and `https://radiance-ml-service-xxxx.onrender.com`.
7. Go back into `radiance-backend`'s **Environment** tab and update `ML_SERVICE_URL` to the ml-service URL you just copied. Save — it'll redeploy automatically.

## 3. Vercel (dashboard + scanner)

Do this twice — once per app.

**Dashboard:**
1. Go to https://vercel.com and sign up with GitHub.
2. **Add New** → **Project** → select this repository.
3. Under **Root Directory**, click Edit and choose `frontend`.
4. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_API_URL` = your `radiance-backend` URL from step 2.6
   - `NEXT_PUBLIC_KIOSK_URL` = (leave blank for now — you'll add it after deploying the scanner below)
5. Click **Deploy**. When it finishes, copy the live URL (e.g. `https://radiance-dashboard.vercel.app`).

**Scanner:**
1. **Add New** → **Project** → same repository again.
2. Root Directory: `scanner`.
3. Environment variable: `VITE_API_URL` = your backend URL **with `/api` on the end**, e.g. `https://radiance-backend-xxxx.onrender.com/api`.
4. Deploy. Copy this URL too (e.g. `https://radiance-kiosk.vercel.app`).

**Now go back and fill in the blanks:**
- In the Dashboard's Vercel project → Settings → Environment Variables → set `NEXT_PUBLIC_KIOSK_URL` to the scanner's URL, then redeploy (Vercel's "Redeploy" button on the latest deployment).
- In Render → `radiance-backend` → Environment → set `FRONTEND_URL` to the dashboard's Vercel URL and `SCANNER_URL` to the scanner's Vercel URL. Save (redeploys automatically).

## 4. Keep the backend awake (UptimeRobot)

Render's free tier sleeps after 15 minutes with no traffic, which would also pause the scheduled attendance jobs. This fixes it for free:

1. Go to https://uptimerobot.com and sign up (free plan).
2. **Add New Monitor** → HTTP(s) → paste your backend's health check URL: `https://radiance-backend-xxxx.onrender.com/api/v1/health`
3. Set the check interval to 5 minutes.
4. Repeat for the ML service: `https://radiance-ml-service-xxxx.onrender.com/health`

## 5. Create your first real admin login

The database starts empty. From your own computer, with `MONGODB_URI` pointed at your Atlas cluster:

```bash
cd backend
ADMIN_EMAIL="you@yourcompany.com" ADMIN_PASSWORD="choose-a-real-password" MONGODB_URI="<paste your Atlas connection string>" node create-admin.js
```

That creates the one real login you'll actually use. Go to your dashboard URL and sign in with it.

## 6. Final checklist

- [ ] Dashboard loads and you can log in
- [ ] Dashboard shows real data (Employees, Sites, etc. — empty is fine, errors are not)
- [ ] Scanner kiosk loads at its own URL
- [ ] From the scanner, "New Employee" registration works end to end (this exercises dashboard → backend → ML service all at once)
- [ ] Clock-in/out works from the scanner
- [ ] Both UptimeRobot monitors show "Up"

Once all of these pass, the system is genuinely live and ready to hand to your client.

---

## Sizing for Radiance's real scale (126 sites, ~4,000 employees)

The free tiers in the steps above are fine for a pilot at one site. They are
not sufficient for the full rollout. Measured requirements:

### MongoDB Atlas — M0 is not viable

Attendance documents measure ~660 bytes. At 4,000 employees averaging two
sessions a day that is ~1.85 GB per year, against M0's 512 MB cap — the
database fills up somewhere around month three. M0 also has **no backups at
all**, under data that decides what people get paid.

Use **M10 or above**: continuous backups, dedicated resources, and room to
grow. This is the single most important upgrade on this page.

### Render — Starter is not sufficient for the ML service

The ML service holds the face-recognition models plus the resident embedding
cache (~2.7 MB for 4,000 employees — the cache itself is small; the models and
OpenCV are what need the memory). Starter's 512 MB is too tight once several
scans are processed concurrently.

- `radiance-backend`: **Starter** is adequate
- `radiance-ml-service`: **Standard (2 GB)** or above

Both must be on a paid plan regardless, so they stop sleeping — a sleeping
service means the first employee of the morning waits for a cold start.

### Kiosk device tokens are required at this scale

`KIOSK_DEVICES` is not just a security control here, it is a correctness and
performance one. A kiosk that identifies its site makes each scan compare
against that site's roster (~200 people at the largest site) instead of all
4,000. Fewer candidates means both a faster scan and a materially lower chance
of a false match.

Generate one token per site:

```bash
openssl rand -hex 32
```

Then set on the backend, one entry per kiosk:

```
KIOSK_DEVICES=<siteId>:<token>,<siteId>:<token>,...
KIOSK_ENFORCE=true
```

and on each kiosk's own Vercel project, `VITE_KIOSK_TOKEN` plus
`VITE_KIOSK_SITE_ID`. Set `KIOSK_ENFORCE=true` only once every kiosk carries
its token, or you will lock all of them out at once.

### What was measured

At 126 sites / 4,000 employees, before and after the scale work:

| Path | Before | After |
|---|---|---|
| Clock-in scan payload | 13.6 MB | 2.5 KB |
| Backend→ML traffic at 133 scans/min | ~1,813 MB/min | 0.33 MB/min |
| Dashboard `/stats` queries | ~381 | 3 (flat, regardless of site count) |
| `approvedOnly` payroll query | 105 KB | 2.1 KB |
| Employees page reachable | first 200 only | all, paged + server-side search |

The embedding cache lives in the ML service's memory, so it is rebuilt on
every restart. That is handled automatically: the backend pushes it at boot
(retrying on a backoff) and any scan that finds a stale version triggers a
resync. `GET /api/v1/health` reports both `rosterCache` and
`mlService.embedding_cache` so this is visible rather than assumed.
