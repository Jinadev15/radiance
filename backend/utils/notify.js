// Email notifications.
//
// Works with any SMTP account. If SMTP_* env vars aren't set this no-ops to
// the console rather than crashing anything that calls it — notifications are
// a nice-to-have, not a dependency the rest of the app should break on. But
// that silence used to be invisible: HR believed alerts were live when
// nothing was configured, so `smtpStatus()` now reports it and the backend's
// /health surfaces it.
const nodemailer = require('nodemailer');
const User = require('../models/User');

const SMTP_CONFIGURED = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;
if (SMTP_CONFIGURED) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

let lastSendError = null;
let sentCount = 0;

async function getAdminEmails() {
  const admins = await User.find({ role: { $in: ['admin', 'hr'] }, isActive: true }).select('email');
  return admins.map(a => a.email);
}

async function sendEmail(to, subject, text) {
  if (!transporter) {
    console.log(`[Notify] (SMTP not configured, logging only) To: ${to} — ${subject}`);
    return { sent: false, reason: 'smtp_not_configured' };
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: Array.isArray(to) ? to.join(',') : to,
      subject,
      text,
    });
    sentCount += 1;
    lastSendError = null;
    return { sent: true };
  } catch (err) {
    lastSendError = { message: err.message, at: new Date() };
    console.error('[Notify] Failed to send email:', err.message);
    return { sent: false, reason: err.message };
  }
}

async function notifyAdmins(subject, text) {
  const emails = await getAdminEmails();
  if (emails.length === 0) return { sent: false, reason: 'no_recipients' };
  return sendEmail(emails, subject, text);
}

// ---------------------------------------------------------------------------
// Security-event throttling
// ---------------------------------------------------------------------------
// Liveness failures previously sent one email each, immediately. One site
// with bad morning light produced dozens — and since a free Gmail account
// caps around 500 messages a day, the flood meant the one alert that actually
// mattered was as likely to be dropped as delivered.
//
// Policy: stay quiet for the first few failures against a given key, then
// send once and hold that key for a cool-off window. Everything is still
// written to SpoofAttemptLog regardless, so nothing is lost — only the
// mailing is rate-limited, and the daily digest reports the totals.
const SECURITY_ALERT_THRESHOLD = Number(process.env.SECURITY_ALERT_THRESHOLD || 3);
const SECURITY_ALERT_WINDOW_MS = Number(process.env.SECURITY_ALERT_WINDOW_MS || 60 * 60 * 1000);
const SECURITY_ALERT_COOLDOWN_MS = Number(process.env.SECURITY_ALERT_COOLDOWN_MS || 6 * 60 * 60 * 1000);

const securityEvents = new Map(); // key -> { count, windowStart, lastAlertAt }

// Bounded so a long-running process can't accumulate one entry per employee
// forever. Entries are cheap and expire naturally; this is a backstop.
const MAX_TRACKED_KEYS = 5000;

function pruneSecurityEvents(now) {
  if (securityEvents.size <= MAX_TRACKED_KEYS) return;
  for (const [key, state] of securityEvents) {
    if (now - state.windowStart > SECURITY_ALERT_COOLDOWN_MS) securityEvents.delete(key);
    if (securityEvents.size <= MAX_TRACKED_KEYS) break;
  }
}

/**
 * Record a security event and email admins only if it looks like a pattern.
 *
 * @param {object} event
 * @param {string} event.key      identity of the recurring event, e.g. `liveness:<employeeId>`
 * @param {string} event.subject
 * @param {string} event.body
 */
async function notifySecurityEvent({ key, subject, body }) {
  const now = Date.now();
  pruneSecurityEvents(now);

  let state = securityEvents.get(key);
  if (!state || now - state.windowStart > SECURITY_ALERT_WINDOW_MS) {
    state = { count: 0, windowStart: now, lastAlertAt: state ? state.lastAlertAt : 0 };
  }
  state.count += 1;
  securityEvents.set(key, state);

  const inCooldown = state.lastAlertAt && now - state.lastAlertAt < SECURITY_ALERT_COOLDOWN_MS;
  if (state.count < SECURITY_ALERT_THRESHOLD || inCooldown) {
    return { sent: false, reason: inCooldown ? 'cooldown' : 'below_threshold', count: state.count };
  }

  state.lastAlertAt = now;
  const withContext = [
    body,
    '',
    `This is failure ${state.count} for this employee within the last ` +
    `${Math.round(SECURITY_ALERT_WINDOW_MS / 60000)} minutes.`,
    'Further alerts for the same employee are suppressed for ' +
    `${Math.round(SECURITY_ALERT_COOLDOWN_MS / 3600000)} hours; all attempts remain in the security log.`,
  ].join('\n');

  return notifyAdmins(subject, withContext);
}

// Exposed on /health so a silent misconfiguration is visible instead of
// being mistaken for "no alerts to send".
function smtpStatus() {
  return {
    configured: SMTP_CONFIGURED,
    sent: sentCount,
    lastError: lastSendError,
  };
}

// Test-only: lets the throttle be reset between cases.
function _resetSecurityThrottle() {
  securityEvents.clear();
}

module.exports = {
  sendEmail,
  notifyAdmins,
  getAdminEmails,
  notifySecurityEvent,
  smtpStatus,
  SMTP_CONFIGURED,
  _resetSecurityThrottle,
};
