require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const corsMiddleware = require('./middleware/cors');
const { kioskStatus } = require('./middleware/kiosk');
const { runAutoClockOutSweep } = require('./utils/autoClockOut');
const { sendDailyDigest } = require('./utils/dailyDigest');
const { health: mlHealth } = require('./utils/mlServiceCall');
const { smtpStatus } = require('./utils/notify');
const rosterCache = require('./utils/rosterCache');
const { DEFAULT_TZ, businessDateTime } = require('./utils/tz');

// Fail loudly at boot on a production misconfiguration that would otherwise
// surface later as a mysterious 500 or a silent security gap.
if (process.env.NODE_ENV === 'production') {
  const required = ['JWT_SECRET', 'MONGODB_URI', 'NATIONAL_ID_HMAC_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s) in production: ${missing.join(', ')}`);
  }
  if (!process.env.ML_SERVICE_TOKEN) {
    console.warn('[Boot] ML_SERVICE_TOKEN is not set — the face recognition service is reachable by anyone who finds its URL.');
  }
  if (!kioskStatus().configured) {
    console.warn('[Boot] No KIOSK_DEVICES/KIOSK_TOKEN configured — the scanner is reachable by anyone who finds its URL.');
  }
}

const app = express();

// Required for express-rate-limit to read the real client IP correctly (and
// not throw) once this sits behind any real reverse proxy/load balancer
// (Render, Vercel, nginx, Cloudflare, etc. all add X-Forwarded-For) — without
// this, express-rate-limit's validation rejects every request the moment
// that header shows up in production. `1` trusts exactly one hop (the
// immediate proxy in front of this process); override via TRUST_PROXY if
// the real deployment sits behind more hops than that.
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 1);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS — allowlisted origins only (see middleware/cors.js)
app.use(corsMiddleware);

// Scanner endpoints (clock-in/out): sized for a real shift change, not a
// trickle. All employees at one site share the site's public IP, so the
// previous 30/min limit meant person #31 in a 60-person shift change got
// "too many requests" at the exact moment attendance matters most. Also
// covers a burst replay from the offline queue after an outage.
const scannerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.SCANNER_RATE_LIMIT || 200),
  standardHeaders: true,
  message: { error: 'Too many requests from this location. Please wait a moment and try again.' },
});

// Auth rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  message: { error: 'Too many login attempts. Try again later.' },
});

// Registration is the only unauthenticated route that also triggers ML
// compute (face-embedding extraction + a full duplicate-face scan) — the
// most expensive thing an anonymous caller can trigger, so it keeps its own
// tighter limiter rather than the scanner's.
const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  message: { error: 'Too many registration attempts. Please wait before trying again.' },
});

// Light general-purpose limiter for every other /api/v1 route as defense in
// depth. Applied per-route (not blanket-mounted) so it doesn't double-count
// against routes that already have their own stricter limiter.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  message: { error: 'Too many requests. Please slow down.' },
});

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/v1/clock-in', scannerLimiter, require('./routes/scanner'));
app.use('/api/v1/clock-out', scannerLimiter, require('./routes/clockout'));
app.use('/api/v1/register', registerLimiter, require('./routes/register'));
app.use('/api/v1/employees', apiLimiter, require('./routes/employees'));
app.use('/api/v1/locations', apiLimiter, require('./routes/locations'));
app.use('/api/v1/shifts', apiLimiter, require('./routes/shifts'));
app.use('/api/v1/services', apiLimiter, require('./routes/services'));
app.use('/api/v1/contractors', apiLimiter, require('./routes/contractors'));
app.use('/api/v1/attendance', apiLimiter, require('./routes/attendance'));
app.use('/api/v1/regularization', scannerLimiter, require('./routes/regularization'));
app.use('/api/v1/leave', scannerLimiter, require('./routes/leave'));
app.use('/api/v1/holidays', apiLimiter, require('./routes/holidays'));
app.use('/api/v1/my-attendance', scannerLimiter, require('./routes/myAttendance'));
app.use('/api/v1/security', apiLimiter, require('./routes/security'));
app.use('/api/v1/audit', apiLimiter, require('./routes/audit'));
app.use('/api/v1/dashboard', apiLimiter, require('./routes/stats'));

// Health check — reports the state of every dependency, not just "the
// process is running". Previously a real query failure and "everything's
// fine" both rendered as an identical 200 OK; this is what makes SMTP being
// unconfigured, the ML service being unreachable, or the kiosk being
// unauthenticated visible instead of silently assumed to be working.
app.get('/api/v1/health', async (req, res) => {
  const ml = await mlHealth();
  res.json({
    status: 'OK',
    service: 'Radiance Backend API',
    dbConnected: mongoose.connection.readyState === 1,
    timezone: DEFAULT_TZ,
    serverBusinessTime: businessDateTime(new Date(), DEFAULT_TZ),
    mlService: ml,
    smtp: smtpStatus(),
    kiosk: kioskStatus(),
    rosterCache: rosterCache.status(),
    timestamp: new Date(),
  });
});

// Global error handler
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  console.error('[ERROR]', err.stack);
  // Full internal error text (library validation messages, Mongoose errors,
  // etc.) is useful in logs but shouldn't reach the client — some of those
  // messages describe internal config/field details that are unnecessary
  // information disclosure on public endpoints like /register and /clock-in.
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || 'Internal server error');
  res.status(500).json({ error: message });
});

// 404 fallback
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Database & Server Boot
const PORT = process.env.PORT || 5000;

// ALWAYS start HTTP listener immediately so server NEVER causes "Failed to fetch"
app.listen(PORT, () => {
  console.log(`Radiance Backend active on http://localhost:${PORT} (business timezone: ${DEFAULT_TZ})`);
  connectWithRetry();
});

let MongoMemoryServer;
try {
  MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
} catch (e) {}

async function connectWithRetry() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/radiance';
  console.log(`Connecting to MongoDB at: ${uri.split('@').pop()}`);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    console.log('MongoDB connected successfully.');
    // Without this, a post-connect network blip emits an unhandled 'error'
    // event on the Connection (an EventEmitter) with zero listeners, which
    // crashes the whole Node process by default — taking down every route,
    // not just DB-dependent ones. Directly undermines this file's own
    // "HTTP listener starts immediately, server never goes down" design.
    mongoose.connection.on('error', (err) => {
      console.error('[MongoDB]', err.message);
    });
    // Push the roster to the ML service's resident embedding cache as soon as
    // the database is up. Without this the first scan after a backend restart
    // pays for a full sync; with it, the common path is already warm.
    // Failure is non-fatal — a scan that finds a stale cache resyncs itself.
    rosterCache.sync({ force: true }).catch(e =>
      console.warn('[RosterCache] Initial sync failed (will retry on first scan):', e.error || e.message)
    );
    // Periodic reconciliation. Every mutation already invalidates the cache
    // explicitly, so this only covers the gaps those can't see: a direct
    // database edit, or a background invalidate that failed while the ML
    // service happened to be restarting.
    setInterval(() => {
      rosterCache.sync().catch(() => {});
    }, 10 * 60 * 1000);

    runAutoClockOutSweep().catch(e => console.error('[AutoClockOut]', e.message));
    setInterval(() => {
      runAutoClockOutSweep().catch(e => console.error('[AutoClockOut]', e.message));
    }, 15 * 60 * 1000);

    // Daily attendance summary at 10:30 IST — explicit `timezone` option
    // rather than relying on the process's TZ, so this fires at the right
    // wall-clock moment regardless of how the host is configured. The
    // previous '30 10 * * *' with no timezone ran in the server's own zone,
    // which on a UTC host meant 4:00 PM IST instead of the intended 10:30 AM.
    cron.schedule('30 10 * * *', () => {
      sendDailyDigest().catch(e => console.error('[DailyDigest]', e.message));
    }, { timezone: DEFAULT_TZ });
  } catch (err) {
    console.warn('MongoDB connection failed:', err.message);
    // The in-memory fallback is a local-dev convenience only ("it just
    // works" with no MongoDB installed). It must never trigger in
    // production: if a real MONGODB_URI is configured but fails to connect
    // for any reason, silently substituting a throwaway in-memory database
    // means the app looks fully functional while quietly writing to data
    // that vanishes on the next restart. Safer to stay degraded-but-honest
    // (DB-dependent routes return 503, health check reports dbConnected:false)
    // and keep retrying the real database.
    if (MongoMemoryServer && process.env.NODE_ENV !== 'production') {
      console.log('Spinning up Embedded Database Engine (development only)...');
      try {
        const mongoServer = await MongoMemoryServer.create();
        const memUri = mongoServer.getUri();
        await mongoose.connect(memUri);
        console.log('Embedded Database Connected & Ready!');
        return;
      } catch (memErr) {
        console.error('Embedded DB error:', memErr.message);
      }
    }
    console.warn('Retrying DB connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  }
}

module.exports = app;
