const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const ServiceTag = require('../models/ServiceTag');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;

// GET /api/v1/services
router.get('/', auth, async (req, res) => {
  try {
    const services = await ServiceTag.find({ isActive: true }).sort({ name: 1 });
    res.json(services);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// POST /api/v1/services
router.post('/', auth, requireAdminOrHr,
  [body('name').notEmpty().trim().withMessage('Service name is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const service = new ServiceTag({ name: req.body.name });
      await service.save();
      res.status(201).json(service);
    } catch (error) {
      if (error.code === 11000) return res.status(400).json({ error: 'A service with this name already exists.' });
      res.status(500).json({ error: 'Failed to create service' });
    }
  }
);

// DELETE /api/v1/services/:id — soft delete
router.delete('/:id', auth, requireAdminOrHr,
  [param('id').isMongoId().withMessage('Invalid service ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const service = await ServiceTag.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
      if (!service) return res.status(404).json({ error: 'Service not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to deactivate service' });
    }
  }
);

module.exports = router;
