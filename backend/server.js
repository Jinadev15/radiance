require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const corsMiddleware = require('./middleware/cors');
const { runAutoClockOutSweep } = require('./utils/autoClockOut');
const { sendDailyDigest } = require('./utils/dailyDigest');

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

// Rate limiting on attendance scanner endpoint
const scannerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please wait before trying again.' },
});

// Auth rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many login attempts. Try again later.' },
});

// Registration is the only unauthenticated route that also triggers ML
// compute (face-embedding extraction + a full duplicate-face scan) — the
// most expensive thing an anonymous caller can trigger, so it gets its own
// tighter limiter rather than relying on the general one below.
const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many registration attempts. Please wait before trying again.' },
});

// Light general-purpose limiter for every other /api/v1 route as defense
// in depth. Applied per-route below (not blanket-mounted on '/api/v1')
// so it doesn't double-count against the routes that already have their
// own stricter limiter — a blanket mount would have meant e.g. /clock-in
// traffic was being debited from both its own 30/min bucket *and* this
// one's shared 300/min bucket at the same time.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
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
app.use('/api/v1/my-attendance', scannerLimiter, require('./routes/myAttendance'));
app.use('/api/v1/security', apiLimiter, require('./routes/security'));
app.use('/api/v1/dashboard', apiLimiter, require('./routes/stats'));

// Health check (always 200 OK)
app.get('/api/v1/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Radiance Backend API', 
    dbConnected: mongoose.connection.readyState === 1,
    timestamp: new Date() 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  console.error('[ERROR]', err.stack);
  // Full internal error text (library validation messages, Mongoose
  // errors, etc.) is useful in logs but shouldn't reach the client —
  // some of those messages describe internal config/field details that
  // are unnecessary information disclosure on public endpoints like
  // /register and /clock-in.
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
  console.log('Radiance Backend active on http://localhost:' + PORT);
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
    runAutoClockOutSweep().catch(e => console.error('[AutoClockOut]', e.message));
    setInterval(() => {
      runAutoClockOutSweep().catch(e => console.error('[AutoClockOut]', e.message));
    }, 15 * 60 * 1000);

    // Daily attendance summary at 10:30am server time — late arrivals catch
    // up by then, and it's early enough for absences to still be actionable.
    cron.schedule('30 10 * * *', () => {
      sendDailyDigest().catch(e => console.error('[DailyDigest]', e.message));
    });
  } catch (err) {
    console.warn('MongoDB connection failed:', err.message);
    // The in-memory fallback is a local-dev convenience only ("it just
    // works" with no MongoDB installed). It must never trigger in
    // production: if a real MONGODB_URI is configured but fails to connect
    // for any reason (wrong password, IP allowlist, a transient Atlas
    // blip), silently substituting a throwaway in-memory database means
    // the app looks fully functional — registrations, clock-ins,
    // everything "works" — while quietly writing to data that vanishes on
    // the next restart/redeploy, with no error surfaced to anyone. Safer
    // to keep the site degraded-but-honest (DB-dependent routes return
    // 503, server stays up, health check still reports dbConnected:false)
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
