const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { body, param, validationResult } = require('express-validator');
const User = require('../models/User');
require('../models/WorkLocation');
const auth = require('../middleware/auth');
const { requireAdmin } = auth;
const audit = require('../utils/audit');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

// Shorter than the previous 7 days. The dashboard keeps this token in
// localStorage (a deliberate tradeoff — Safari blocks the httpOnly cookie
// outright when the dashboard and API sit on different domains, which is the
// normal outcome of split hosting), so any XSS that reads it inherits a
// session for its whole lifetime. Eight hours covers a working day without
// leaving a week-long credential lying around.
const TOKEN_TTL = process.env.JWT_TTL || '8h';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

// SameSite=Strict only works when the dashboard and this API share a
// registrable domain. On genuinely separate domains Strict silently stops the
// browser ever sending the cookie, so auth just always 401s with nothing
// visibly broken. COOKIE_CROSS_SITE=true switches to SameSite=None, which
// requires Secure regardless of NODE_ENV.
const CROSS_SITE = process.env.COOKIE_CROSS_SITE === 'true';
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: CROSS_SITE ? 'none' : 'strict',
  secure: CROSS_SITE || process.env.NODE_ENV === 'production',
  path: '/',
};

// A valid-format bcrypt hash of a value nobody will ever type, used only to
// burn roughly the same time a real comparison would. A nonexistent email
// otherwise returns near-instantly (no bcrypt round trip at all) while a real
// one takes the full compare, which is a timing oracle for enumerating logins.
const DUMMY_HASH = '$2a$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

function signToken(user) {
  const payload = {
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      workLocation: user.workLocation || null,
    },
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// POST /api/auth/login
router.post('/login',
  [
    body('email', 'Valid email required').isEmail().normalizeEmail(),
    body('password', 'Password required').notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database unavailable. Please try again shortly.' });
      }

      const user = await User.findOne({ email, isActive: true });

      // Per-account lockout. The route rate limiter is per-IP, so it does
      // nothing against attempts spread across many addresses at one known
      // email — which is the shape a real credential-stuffing run takes.
      if (user && user.isLocked()) {
        const minutes = Math.ceil((user.lockedUntil - new Date()) / 60000);
        return res.status(429).json({
          error: `Too many failed attempts. This account is locked for another ${minutes} minute(s).`,
          code: 'ACCOUNT_LOCKED',
        });
      }

      // Always run a bcrypt compare, real or dummy, so a nonexistent email
      // doesn't return measurably faster than a real one.
      const isMatch = user
        ? await user.comparePassword(password)
        : await bcrypt.compare(password, DUMMY_HASH);

      if (!user || !isMatch) {
        if (user) await user.registerFailedLogin();
        return res.status(401).json({ msg: 'Invalid credentials' });
      }

      await user.registerSuccessfulLogin();
      const token = signToken(user);

      // httpOnly so an XSS payload can't read the token off document.cookie.
      res.cookie('radiance_token', token, { ...COOKIE_OPTIONS, maxAge: TOKEN_TTL_MS });

      // Also returned in the body: Safari (and Firefox strict mode) block this
      // cookie outright when the dashboard and API are on different domains,
      // since it is third-party from the browser's point of view no matter
      // what SameSite/Secure say. The dashboard sends this back as an
      // Authorization header instead, which no browser blocks.
      return res.json({
        token,
        // Surfaced so the dashboard can force the change before showing
        // anything else — this is what makes handing someone an initial
        // password safe, and stops a shared starter credential becoming
        // permanent.
        mustChangePassword: Boolean(user.mustChangePassword),
        user: {
          id: user.id, name: user.name, email: user.email,
          role: user.role, workLocation: user.workLocation,
        },
      });
    } catch (err) {
      console.error('[Auth/Login]', err.message);
      res.status(500).json({ error: 'Authentication error' });
    }
  }
);

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('radiance_token', COOKIE_OPTIONS);
  res.json({ success: true });
});

// GET /api/auth/me (protected)
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').populate('workLocation', 'name');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('[Auth/Me]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/change-password
//
// There was previously no way to change a password anywhere in the system:
// rotating one meant creating a new account and deactivating the old, and a
// compromised admin password had no recovery path short of editing the
// database by hand.
router.post('/change-password', auth,
  [
    body('currentPassword').notEmpty().withMessage('Your current password is required'),
    body('newPassword').notEmpty().withMessage('A new password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const ok = await user.comparePassword(req.body.currentPassword);
      if (!ok) return res.status(401).json({ error: 'Your current password is incorrect.' });

      if (req.body.newPassword === req.body.currentPassword) {
        return res.status(400).json({ error: 'The new password must be different from the current one.' });
      }

      const weak = User.validatePasswordStrength(req.body.newPassword, { email: user.email, name: user.name });
      if (weak) return res.status(400).json({ error: weak });

      user.password = req.body.newPassword; // hashed by the pre-save hook
      user.mustChangePassword = false;
      await user.save();

      await audit.record(req, {
        action: audit.ACTIONS.USER_PASSWORD_CHANGED,
        targetModel: 'User',
        targetId: user._id,
        targetLabel: `${user.name} <${user.email}>`,
      });

      // Re-issue so the caller keeps a working session with the
      // mustChangePassword flag cleared.
      const token = signToken(user);
      res.cookie('radiance_token', token, { ...COOKIE_OPTIONS, maxAge: TOKEN_TTL_MS });
      res.json({ success: true, token, message: 'Password changed.' });
    } catch (err) {
      console.error('[Auth/ChangePassword]', err.message);
      res.status(500).json({ error: 'Failed to change password' });
    }
  }
);

// GET /api/auth/users — list dashboard logins (admin only)
router.get('/users', auth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({ isActive: true })
      .select('-password')
      .populate('workLocation', 'name')
      .sort({ name: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/auth/users — create a new dashboard login (admin only)
router.post('/users', auth, requireAdmin,
  [
    body('name').notEmpty().trim().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').optional().isString(),
    body('role').isIn(['admin', 'hr', 'supervisor']).withMessage('Invalid role'),
    body('workLocation').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid site ID'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { name, email, role, workLocation } = req.body;
      if (role === 'supervisor' && !workLocation) {
        return res.status(400).json({ error: 'Supervisors must be assigned to a site.' });
      }

      // If no password is supplied, generate a strong one-time password and
      // return it once. That is safer than asking an admin to invent one, and
      // paired with mustChangePassword it means the initial credential is
      // never the long-term credential.
      const generated = !req.body.password;
      const password = req.body.password || `${crypto.randomBytes(9).toString('base64url')}-Rd1`;

      if (!generated) {
        const weak = User.validatePasswordStrength(password, { email, name });
        if (weak) return res.status(400).json({ error: weak });
      }

      const user = new User({
        name, email, password, role,
        workLocation: role === 'supervisor' ? workLocation : null,
        mustChangePassword: true,
      });
      await user.save();

      await audit.record(req, {
        action: audit.ACTIONS.USER_CREATED,
        targetModel: 'User',
        targetId: user._id,
        targetLabel: `${user.name} <${user.email}>`,
        after: { role: user.role, workLocation: user.workLocation ? String(user.workLocation) : null },
      });

      res.status(201).json({
        success: true,
        // Shown once, never stored in readable form and never emailed from
        // here — the admin hands it over directly.
        temporaryPassword: generated ? password : undefined,
        mustChangePassword: true,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    } catch (err) {
      if (err.code === 11000) return res.status(400).json({ error: 'A user with this email already exists.' });
      console.error('[Auth/CreateUser]', err.message);
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

// POST /api/auth/users/:id/reset-password — admin sets a temporary password.
router.post('/users/:id/reset-password', auth, requireAdmin,
  [param('id').isMongoId().withMessage('Invalid user ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const temporaryPassword = `${crypto.randomBytes(9).toString('base64url')}-Rd1`;
      user.password = temporaryPassword;
      user.mustChangePassword = true;
      // Clear any lockout — a reset is the intended way out of one.
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      await user.save();

      await audit.record(req, {
        action: audit.ACTIONS.USER_PASSWORD_RESET,
        targetModel: 'User',
        targetId: user._id,
        targetLabel: `${user.name} <${user.email}>`,
      });

      res.json({
        success: true,
        temporaryPassword,
        message: `Temporary password set for ${user.name}. They must change it at next login.`,
      });
    } catch (err) {
      console.error('[Auth/ResetPassword]', err.message);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  }
);

// DELETE /api/auth/users/:id — deactivate a dashboard login (admin only)
router.delete('/users/:id', auth, requireAdmin,
  [param('id').isMongoId().withMessage('Invalid user ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You can't deactivate your own account." });
    }
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Never allow the last admin to be removed — that locks everyone out of
      // user management permanently, with no way back through the UI.
      if (user.role === 'admin') {
        const remainingAdmins = await User.countDocuments({
          role: 'admin', isActive: true, _id: { $ne: user._id },
        });
        if (remainingAdmins === 0) {
          return res.status(400).json({
            error: 'This is the only remaining admin account. Create another admin before deactivating this one.',
            code: 'LAST_ADMIN',
          });
        }
      }

      user.isActive = false;
      await user.save();

      await audit.record(req, {
        action: audit.ACTIONS.USER_DEACTIVATED,
        targetModel: 'User',
        targetId: user._id,
        targetLabel: `${user.name} <${user.email}>`,
      });

      res.json({ success: true });
    } catch (err) {
      console.error('[Auth/DeleteUser]', err.message);
      res.status(500).json({ error: 'Failed to deactivate user' });
    }
  }
);

module.exports = router;
