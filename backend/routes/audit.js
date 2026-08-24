const express = require('express');
const router = express.Router();
const { query, validationResult } = require('express-validator');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const { requireAdmin } = auth;

// GET /api/v1/audit — read-only activity trail. Admin only: this shows who
// changed what across every employee and every user account, which is a
// wider view than HR or a supervisor needs.
router.get('/', auth, requireAdmin,
  [
    query('action').optional().isString(),
    query('targetModel').optional().isString(),
    query('actor').optional().isMongoId(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const page = req.query.page || 1;
      const limit = req.query.limit || 50;
      const filter = {};
      if (req.query.action) filter.action = req.query.action;
      if (req.query.targetModel) filter.targetModel = req.query.targetModel;
      if (req.query.actor) filter.actor = req.query.actor;

      const [entries, total] = await Promise.all([
        AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        AuditLog.countDocuments(filter),
      ]);

      res.json({ entries, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
    } catch (error) {
      console.error('[Audit/GET]', error.message);
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  }
);

module.exports = router;
