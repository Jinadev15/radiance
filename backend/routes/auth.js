const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { body, param, validationResult } = require('express-validator');
const User = require('../models/User');
require('../models/WorkLocation');
const auth = require('../middleware/auth');
const { requireAdmin } = auth;

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

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
      // If MongoDB is connected, query the User collection
      if (mongoose.connection.readyState === 1) {
        const user = await User.findOne({ email, isActive: true });
        if (user) {
          const isMatch = await user.comparePassword(password);
          if (isMatch) {
            const payload = { user: { id: user.id, role: user.role, workLocation: user.workLocation || null } };
            const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
            // httpOnly so an XSS payload can't read the session token off
            // document.cookie — the browser attaches it automatically on
            // same-site requests, the dashboard JS never touches it directly.
            res.cookie('radiance_token', token, {
              httpOnly: true,
              sameSite: 'strict',
              secure: process.env.NODE_ENV === 'production',
              maxAge: 7 * 24 * 60 * 60 * 1000,
              path: '/',
            });
            return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, workLocation: user.workLocation } });
          }
        }
      }

      return res.status(401).json({ msg: 'Invalid credentials' });
    } catch (err) {
      console.error('[Auth/Login]', err.message);
      res.status(500).json({ error: 'Authentication error' });
    }
  }
);

// POST /api/auth/logout — clears the session cookie server-side (client JS
// can't touch an httpOnly cookie, so this is the only way to log out).
router.post('/logout', (req, res) => {
  res.clearCookie('radiance_token', { path: '/' });
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

// GET /api/auth/users — list dashboard logins (admin only)
router.get('/users', auth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find({ isActive: true }).select('-password').populate('workLocation', 'name').sort({ name: 1 });
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
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').isIn(['admin', 'hr', 'supervisor']).withMessage('Invalid role'),
    body('workLocation').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid site ID'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { name, email, password, role, workLocation } = req.body;
      if (role === 'supervisor' && !workLocation) {
        return res.status(400).json({ error: 'Supervisors must be assigned to a site.' });
      }
      const user = new User({ name, email, password, role, workLocation: role === 'supervisor' ? workLocation : null });
      await user.save();
      res.status(201).json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (err) {
      if (err.code === 11000) return res.status(400).json({ error: 'A user with this email already exists.' });
      console.error('[Auth/CreateUser]', err.message);
      res.status(500).json({ error: 'Failed to create user' });
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
      const user = await User.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to deactivate user' });
    }
  }
);

module.exports = router;
