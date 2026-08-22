const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const Contractor = require('../models/Contractor');
const Employee = require('../models/Employee');
require('../models/WorkLocation');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;

// GET /api/v1/contractors (admin/HR only — matches the Billing page's nav visibility)
router.get('/', auth, requireAdminOrHr, async (req, res) => {
  try {
    const [contractors, counts] = await Promise.all([
      Contractor.find({ isActive: true }).populate('workLocation', 'name').sort({ name: 1 }),
      Employee.aggregate([
        { $match: { isActive: true, contractor: { $ne: null } } },
        { $group: { _id: '$contractor', count: { $sum: 1 } } },
      ]),
    ]);
    const countByContractor = new Map(counts.map(c => [c._id.toString(), c.count]));
    const withCounts = contractors.map(c => ({
      ...c.toObject(),
      currentHeadcount: countByContractor.get(c._id.toString()) || 0,
    }));
    res.json(withCounts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch contractors' });
  }
});

// POST /api/v1/contractors
router.post('/', auth, requireAdminOrHr,
  [
    body('name').notEmpty().trim().withMessage('Contractor name is required'),
    body('workLocation').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid site ID'),
    body('headcountCap').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('Headcount cap must be a positive number'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { name, contactPhone, workLocation, headcountCap } = req.body;
      const contractor = new Contractor({ name, contactPhone, workLocation: workLocation || null, headcountCap: headcountCap || null });
      await contractor.save();
      res.status(201).json(contractor);
    } catch (error) {
      console.error('[Contractors/POST]', error.message);
      res.status(500).json({ error: 'Failed to create contractor' });
    }
  }
);

// PUT /api/v1/contractors/:id
router.put('/:id', auth, requireAdminOrHr,
  [
    param('id').isMongoId().withMessage('Invalid contractor ID'),
    body('headcountCap').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('Headcount cap must be a positive number'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const allowedFields = ['name', 'contactPhone', 'workLocation', 'headcountCap', 'documents'];
      const updates = {};
      allowedFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
      const contractor = await Contractor.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
      if (!contractor) return res.status(404).json({ error: 'Contractor not found' });
      res.json(contractor);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update contractor' });
    }
  }
);

// DELETE /api/v1/contractors/:id — soft delete
router.delete('/:id', auth, requireAdminOrHr,
  [param('id').isMongoId().withMessage('Invalid contractor ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const contractor = await Contractor.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
      if (!contractor) return res.status(404).json({ error: 'Contractor not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to deactivate contractor' });
    }
  }
);

module.exports = router;
