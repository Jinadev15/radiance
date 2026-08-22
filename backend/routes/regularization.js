const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, param, validationResult } = require('express-validator');
const RegularizationRequest = require('../models/RegularizationRequest');
require('../models/Employee');
require('../models/User');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;
const { identifyAndVerify } = require('../utils/identifyAndVerify');

// POST /api/v1/regularization — kiosk-facing: employee identifies themselves
// via face (same pipeline as clock-in) and flags a past-date attendance issue.
router.post('/',
  [
    body('date').isISO8601().withMessage('A valid date is required'),
    body('reason').notEmpty().trim().withMessage('Please describe the issue'),
    body('requestedClockIn').optional({ nullable: true, checkFalsy: true }).matches(/^\d{2}:\d{2}$/),
    body('requestedClockOut').optional({ nullable: true, checkFalsy: true }).matches(/^\d{2}:\d{2}$/),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const { images, image, date, reason, requestedClockIn, requestedClockOut } = req.body;
      const frames = images || (image ? [image] : []);
      if (frames.length === 0) return res.status(400).json({ error: 'Face image is required to identify you' });
      if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Database unavailable' });

      let matchedEmployee;
      try {
        ({ matchedEmployee } = await identifyAndVerify(frames, 'CLOCK_IN'));
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.error || 'Internal server error' });
      }

      const requestDate = new Date(date);
      if (requestDate > new Date()) {
        return res.status(400).json({ error: 'Cannot report an issue for a future date.' });
      }

      const request = new RegularizationRequest({
        employee: matchedEmployee._id,
        date,
        reason,
        requestedClockIn: requestedClockIn || null,
        requestedClockOut: requestedClockOut || null,
      });
      await request.save();

      res.status(201).json({
        success: true,
        employeeName: matchedEmployee.name,
        message: `Thanks ${matchedEmployee.name}, your report for ${date} has been sent for review.`
      });
    } catch (error) {
      console.error('[Regularization/POST]', error.message);
      res.status(500).json({ error: 'Failed to submit report. Please try again.' });
    }
  }
);

// GET /api/v1/regularization — admin/HR review queue
router.get('/', auth, requireAdminOrHr, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const requests = await RegularizationRequest.find(filter)
      .populate('employee', 'name employeeId')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    console.error('[Regularization/GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch regularization requests' });
  }
});

// PUT /api/v1/regularization/:id — approve or reject
router.put('/:id', auth, requireAdminOrHr,
  [
    param('id').isMongoId().withMessage('Invalid request ID'),
    body('status').isIn(['APPROVED', 'REJECTED']).withMessage('Status must be APPROVED or REJECTED'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const request = await RegularizationRequest.findByIdAndUpdate(
        req.params.id,
        { status: req.body.status, reviewNote: req.body.reviewNote || '', reviewedBy: req.user.id, reviewedAt: new Date() },
        { new: true }
      ).populate('employee', 'name employeeId');
      if (!request) return res.status(404).json({ error: 'Request not found' });
      res.json({ success: true, request });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update request' });
    }
  }
);

module.exports = router;
