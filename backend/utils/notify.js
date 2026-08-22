// Free-tier email notifications — no paid SMS/WhatsApp gateway required.
// Works with any SMTP account (Gmail's free tier included, ~500 msgs/day).
// If SMTP_* env vars aren't set, this silently no-ops to console instead of
// crashing anything that calls it — notifications are a nice-to-have, not a
// dependency the rest of the app should ever break on.
const nodemailer = require('nodemailer');
const User = require('../models/User');

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function getAdminEmails() {
  const admins = await User.find({ role: { $in: ['admin', 'hr'] }, isActive: true }).select('email');
  return admins.map(a => a.email);
}

async function sendEmail(to, subject, text) {
  if (!transporter) {
    console.log(`[Notify] (SMTP not configured, logging only) To: ${to} — ${subject}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: Array.isArray(to) ? to.join(',') : to,
      subject,
      text,
    });
  } catch (err) {
    console.error('[Notify] Failed to send email:', err.message);
  }
}

async function notifyAdmins(subject, text) {
  const emails = await getAdminEmails();
  if (emails.length === 0) return;
  await sendEmail(emails, subject, text);
}

module.exports = { sendEmail, notifyAdmins, getAdminEmails };
