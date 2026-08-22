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

// Light general-purpose limiter applied to every authenticated API route as
// defense in depth — the specific limiters above stay stricter where it matters.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/v1', apiLimiter);

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/v1/clock-in', scannerLimiter, require('./routes/scanner'));
app.use('/api/v1/clock-out', scannerLimiter, require('./routes/clockout'));
app.use('/api/v1/register', registerLimiter, require('./routes/register'));
app.use('/api/v1/employees', require('./routes/employees'));
app.use('/api/v1/locations', require('./routes/locations'));
app.use('/api/v1/shifts', require('./routes/shifts'));
app.use('/api/v1/services', require('./routes/services'));
app.use('/api/v1/contractors', require('./routes/contractors'));
app.use('/api/v1/attendance', require('./routes/attendance'));
app.use('/api/v1/regularization', scannerLimiter, require('./routes/regularization'));
app.use('/api/v1/my-attendance', scannerLimiter, require('./routes/myAttendance'));
app.use('/api/v1/security', require('./routes/security'));
app.use('/api/v1/dashboard', require('./routes/stats'));

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
  res.status(500).json({ error: err.message || 'Internal server error' });
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
    console.warn('Local MongoDB 27017 not detected:', err.message);
    if (MongoMemoryServer) {
      console.log('Spinning up Embedded Database Engine...');
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
