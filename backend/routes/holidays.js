const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const Holiday = require('../models/Holiday');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;
const audit = require('../utils/audit');

// GET /api/v1/holidays?year=2026
router.get('/', auth,
  [query('year').optional().isInt({ min: 2020, max: 2100 }).toInt()],
  async (req, res) => {
    try {
      const filter = {};
      if (req.query.year) {
        filter.date = { $gte: `${req.query.year}-01-01`, $lte: `${req.query.year}-12-31` };
      }
      const holidays = await Holiday.find(filter).populate('workLocations', 'name').sort({ date: 1 });
      res.json(holidays);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch holidays' });
    }
  }
);

// POST /api/v1/holidays
router.post('/', auth, requireAdminOrHr,
  [
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date must be YYYY-MM-DD'),
    body('name').notEmpty().trim().withMessage('Holiday name is required'),
    body('workLocations').optional().isArray(),
    body('isPaid').optional().isBoolean().toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const holiday = new Holiday({
        date: req.body.date,
        name: req.body.name,
        workLocations: req.body.workLocations || [],
        isPaid: req.body.isPaid !== false,
      });
      await holiday.save();

      await audit.record(req, {
        action: audit.ACTIONS.HOLIDAY_CHANGED,
        targetModel: 'Holiday',
        targetId: holiday._id,
        targetLabel: `${holiday.name} (${holiday.date})`,
        after: { date: holiday.date, name: holiday.name, siteScoped: holiday.workLocations.length > 0 },
      });

      res.status(201).json(holiday);
    } catch (error) {
      if (error.code === 11000) return res.status(400).json({ error: 'A holiday with this name already exists on this date.' });
      res.status(500).json({ error: 'Failed to create holiday' });
    }
  }
);

// DELETE /api/v1/holidays/:id
router.delete('/:id', auth, requireAdminOrHr,
  [param('id').isMongoId()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const holiday = await Holiday.findByIdAndDelete(req.params.id);
      if (!holiday) return res.status(404).json({ error: 'Holiday not found' });

      await audit.record(req, {
        action: audit.ACTIONS.HOLIDAY_CHANGED,
        targetModel: 'Holiday',
        targetId: holiday._id,
        targetLabel: `${holiday.name} (${holiday.date})`,
        before: { date: holiday.date, name: holiday.name },
        after: null,
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete holiday' });
    }
  }
);

module.exports = router;
