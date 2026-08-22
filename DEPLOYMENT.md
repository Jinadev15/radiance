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
