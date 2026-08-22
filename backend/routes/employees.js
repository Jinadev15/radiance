const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const Employee = require('../models/Employee');
require('../models/WorkLocation');
require('../models/ShiftTemplate');
require('../models/ServiceTag');
require('../models/Contractor');
const auth = require('../middleware/auth');

// GET /api/v1/employees
router.get('/', auth, async (req, res) => {
  try {
    const filter = { isActive: true };
    // Supervisors only see their own site's roster.
    if (req.user.role === 'supervisor' && req.user.workLocation) {
      filter.workLocation = req.user.workLocation;
    }

    const employees = await Employee.find(filter)
      .populate('workLocation', 'name address')
      .populate('shiftTemplate', 'name startTime endTime')
      .populate('serviceTag', 'name')
      .populate('contractor', 'name')
      .select('-faceEmbedding')
      .sort({ name: 1 });

    const safeEmployees = employees.map(emp => ({
      ...emp.toObject(),
      nationalId: emp.getMaskedNationalId()
    }));

    res.json(safeEmployees);
  } catch (error) {
    console.error('[Employees/GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// GET /api/v1/employees/:id
router.get('/:id', auth,
  [param('id').isMongoId().withMessage('Invalid employee ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findById(req.params.id)
        .populate('workLocation', 'name address latitude longitude radiusMeters shiftStart shiftEnd')
        .populate('shiftTemplate')
        .populate('serviceTag', 'name')
        .populate('contractor', 'name')
        .select('-faceEmbedding');
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      if (req.user.role === 'supervisor' && String(employee.workLocation?._id) !== String(req.user.workLocation)) {
        return res.status(403).json({ error: 'Not authorized to view this employee.' });
      }
      res.json({ ...employee.toObject(), nationalId: employee.getMaskedNationalId() });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch employee' });
    }
  }
);

// Employee self-registration lives at POST /api/v1/register (see routes/register.js) —
// kept as the single registration path so the kiosk ID returned always matches what's saved.

// PUT /api/v1/employees/:id
router.put('/:id', auth,
  [
    param('id').isMongoId().withMessage('Invalid employee ID'),
    body('workLocation').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid work location ID'),
    body('shiftTemplate').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid shift template ID'),
    body('serviceTag').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid service ID'),
    body('contractor').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid contractor ID'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      // Supervisors can't reassign someone to a different site or edit contractor/service billing fields.
      const allowedFields = req.user.role === 'supervisor'
        ? ['name', 'shiftTemplate']
        : ['name', 'workLocation', 'shiftTemplate', 'serviceTag', 'contractor'];
      const updates = {};
      allowedFields.forEach(field => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });

      const employee = await Employee.findByIdAndUpdate(
        req.params.id,
        updates,
        { new: true, runValidators: true }
      ).select('-faceEmbedding')
        .populate('workLocation', 'name address')
        .populate('shiftTemplate', 'name startTime endTime')
        .populate('serviceTag', 'name')
        .populate('contractor', 'name');

      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      res.json({ success: true, employee: { ...employee.toObject(), nationalId: employee.getMaskedNationalId() } });
    } catch (error) {
      console.error('[Employees/PUT]', error.message);
      res.status(500).json({ error: 'Failed to update employee' });
    }
  }
);

// DELETE /api/v1/employees/:id — Soft deactivate (admin/HR only, not supervisors)
router.delete('/:id', auth,
  [param('id').isMongoId().withMessage('Invalid employee ID')],
  async (req, res) => {
    if (req.user.role === 'supervisor') {
      return res.status(403).json({ error: 'Only admins or HR can deactivate employees.' });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findByIdAndUpdate(
        req.params.id,
        { isActive: false },
        { new: true }
      );
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      res.json({ success: true, message: 'Employee deactivated successfully.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to deactivate employee' });
    }
  }
);

module.exports = router;
