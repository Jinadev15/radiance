const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const SpoofAttemptLog = require('../models/SpoofAttemptLog');
require('../models/Employee');
require('../models/WorkLocation');
const auth = require('../middleware/auth');

// GET /api/v1/security/spoof-attempts — most recent liveness-check failures,
// each attributed to the identity that was targeted.
router.get('/spoof-attempts', auth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const filter = {};
    // Supervisors only see spoof attempts targeted at their own site — a
    // security alert about another client site isn't theirs to see.
    if (req.user.role === 'supervisor' && req.user.workLocation) {
      filter.workLocation = req.user.workLocation;
    }
    const attempts = await SpoofAttemptLog.find(filter)
      .populate('targetedEmployee', 'name employeeId')
      .populate('workLocation', 'name')
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json(attempts);
  } catch (error) {
    console.warn('[Security/SpoofAttempts]', error.message);
    res.json([]);
  }
});

module.exports = router;
