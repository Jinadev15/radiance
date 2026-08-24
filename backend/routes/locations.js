const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const WorkLocation = require('../models/WorkLocation');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;
const { requireKioskDevice } = require('../middleware/kiosk');

// GET /api/v1/locations/public — minimal site list for the kiosk's own
// registration form (name + id only, no coordinates or radius).
//
// The kiosk has no dashboard login, so it can't call the authenticated GET /
// below — and it needs a real site list, because self-registration requiring
// a site (see routes/register.js) is what closes the hole where every
// self-registered employee had no geofence and no late detection at all.
// Gated by the same kiosk-device check as the scanning endpoints rather than
// left fully open, even though a list of site names is low-sensitivity.
router.get('/public', requireKioskDevice, async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.kioskSiteId) filter._id = req.kioskSiteId; // a bound kiosk only offers its own site
    const locations = await WorkLocation.find(filter).select('name').sort({ name: 1 });
    res.json(locations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sites' });
  }
});

// GET /api/v1/locations — All active locations, or just a supervisor's own site
router.get('/', auth, async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.user.role === 'supervisor' && req.user.workLocation) {
      filter._id = req.user.workLocation;
    }
    const locations = await WorkLocation.find(filter).sort({ name: 1 });
    res.json(locations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// GET /api/v1/locations/:id (auth required)
router.get('/:id', auth,
  [param('id').isMongoId().withMessage('Invalid location ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const location = await WorkLocation.findById(req.params.id);
      if (!location) return res.status(404).json({ error: 'Location not found' });
      // GET / already scopes supervisors to their own site — this direct-ID
      // lookup needs the same check, or a supervisor can read any other
      // site's exact coordinates/geofence radius just by guessing/iterating IDs.
      if (req.user.role === 'supervisor' && String(location._id) !== String(req.user.workLocation)) {
        return res.status(403).json({ error: 'Not authorized to view this site.' });
      }
      res.json(location);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch location' });
    }
  }
);

// POST /api/v1/locations — Create location (admin/HR only)
router.post('/', auth, requireAdminOrHr,
  [
    body('name').notEmpty().trim().withMessage('Location name is required'),
    body('address').notEmpty().trim().withMessage('Address is required'),
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required (-90 to 90)'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required (-180 to 180)'),
    body('radiusMeters').optional().isInt({ min: 50, max: 5000 }).withMessage('Radius must be 50-5000 meters'),
    body('shiftStart').notEmpty().matches(/^\d{2}:\d{2}$/).withMessage('Shift start must be HH:MM format'),
    body('shiftEnd').notEmpty().matches(/^\d{2}:\d{2}$/).withMessage('Shift end must be HH:MM format'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { name, address, latitude, longitude, radiusMeters, shiftStart, shiftEnd } = req.body;
      const newLocation = new WorkLocation({ name, address, latitude, longitude, radiusMeters, shiftStart, shiftEnd });
      await newLocation.save();
      res.status(201).json(newLocation);
    } catch (error) {
      console.error('[Locations/POST]', error.message);
      res.status(500).json({ error: 'Failed to create location' });
    }
  }
);

// PUT /api/v1/locations/:id (admin/HR only)
router.put('/:id', auth, requireAdminOrHr,
  [
    param('id').isMongoId().withMessage('Invalid location ID'),
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
    body('radiusMeters').optional().isInt({ min: 50, max: 5000 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const allowedFields = ['name', 'address', 'latitude', 'longitude', 'radiusMeters', 'shiftStart', 'shiftEnd'];
      const updates = {};
      allowedFields.forEach(field => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });
      const location = await WorkLocation.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
      if (!location) return res.status(404).json({ error: 'Location not found' });
      res.json(location);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update location' });
    }
  }
);

// DELETE /api/v1/locations/:id — Soft delete (admin/HR only)
router.delete('/:id', auth, requireAdminOrHr,
  [param('id').isMongoId().withMessage('Invalid location ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const location = await WorkLocation.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
      if (!location) return res.status(404).json({ error: 'Location not found' });
      res.json({ success: true, message: 'Location deactivated.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to deactivate location' });
    }
  }
);

module.exports = router;