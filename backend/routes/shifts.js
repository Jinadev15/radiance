const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const ShiftTemplate = require('../models/ShiftTemplate');
const Employee = require('../models/Employee');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;

// GET /api/v1/shifts — all active shift templates
router.get('/', auth, async (req, res) => {
  try {
    const shifts = await ShiftTemplate.find({ isActive: true }).sort({ startTime: 1 });
    res.json(shifts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch shift templates' });
  }
});

// POST /api/v1/shifts — create a shift template
router.post('/', auth, requireAdminOrHr,
  [
    body('name').notEmpty().trim().withMessage('Shift name is required'),
    body('startTime').matches(/^\d{2}:\d{2}$/).withMessage('Start time must be HH:MM'),
    body('endTime').matches(/^\d{2}:\d{2}$/).withMessage('End time must be HH:MM'),
    body('graceMinutes').optional().isInt({ min: 0, max: 120 }).withMessage('Grace must be 0-120 minutes'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { name, startTime, endTime, graceMinutes } = req.body;
      const shift = new ShiftTemplate({ name, startTime, endTime, graceMinutes });
      await shift.save();
      res.status(201).json(shift);
    } catch (error) {
      console.error('[Shifts/POST]', error.message);
      res.status(500).json({ error: 'Failed to create shift template' });
    }
  }
);

// PUT /api/v1/shifts/:id
router.put('/:id', auth, requireAdminOrHr,
  [
    param('id').isMongoId().withMessage('Invalid shift ID'),
    body('startTime').optional().matches(/^\d{2}:\d{2}$/).withMessage('Start time must be HH:MM'),
    body('endTime').optional().matches(/^\d{2}:\d{2}$/).withMessage('End time must be HH:MM'),
    body('graceMinutes').optional().isInt({ min: 0, max: 120 }).withMessage('Grace must be 0-120 minutes'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const allowedFields = ['name', 'startTime', 'endTime', 'graceMinutes'];
      const updates = {};
      allowedFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
      const shift = await ShiftTemplate.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
      if (!shift) return res.status(404).json({ error: 'Shift template not found' });
      res.json(shift);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update shift template' });
    }
  }
);

// DELETE /api/v1/shifts/:id — soft delete
router.delete('/:id', auth, requireAdminOrHr,
  [param('id').isMongoId().withMessage('Invalid shift ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const shift = await ShiftTemplate.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
      if (!shift) return res.status(404).json({ error: 'Shift template not found' });
      const stillAssigned = await Employee.countDocuments({ shiftTemplate: req.params.id, isActive: true });
      res.json({ success: true, message: 'Shift template deactivated.', stillAssignedCount: stillAssigned });
    } catch (error) {
      res.status(500).json({ error: 'Failed to deactivate shift template' });
    }
  }
);

// POST /api/v1/shifts/bulk-assign — assign one shift template to many employees at once,
// either by explicit employee IDs or to everyone at a given site.
router.post('/bulk-assign', auth, requireAdminOrHr,
  [
    body('shiftTemplate').isMongoId().withMessage('A valid shift template is required'),
    body('employeeIds').optional().isArray().withMessage('employeeIds must be an array'),
    body('workLocation').optional().isMongoId().withMessage('Invalid site ID'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { shiftTemplate, employeeIds, workLocation } = req.body;
      if (!employeeIds?.length && !workLocation) {
        return res.status(400).json({ error: 'Provide either employeeIds or a workLocation to assign to.' });
      }

      const filter = { isActive: true };
      if (employeeIds?.length) filter._id = { $in: employeeIds };
      if (workLocation) filter.workLocation = workLocation;

      const result = await Employee.updateMany(filter, { shiftTemplate });
      res.json({ success: true, matched: result.matchedCount, updated: result.modifiedCount });
    } catch (error) {
      console.error('[Shifts/BulkAssign]', error.message);
      res.status(500).json({ error: 'Bulk assignment failed' });
    }
  }
);

module.exports = router;
