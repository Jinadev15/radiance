const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AttendanceLog = require('../models/AttendanceLog');
const { identifyAndVerify } = require('../utils/identifyAndVerify');

// POST /api/v1/my-attendance — kiosk self-service: identify via face, see your
// own last 7 days. No employee login system exists (or needs to) — the face
// scan *is* the authentication, same as clock-in.
router.post('/', async (req, res) => {
  try {
    const { images, image } = req.body;
    const frames = images || (image ? [image] : []);
    if (frames.length === 0) return res.status(400).json({ error: 'Face image is required' });
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Database unavailable' });

    let matchedEmployee;
    try {
      ({ matchedEmployee } = await identifyAndVerify(frames, 'CLOCK_IN'));
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.error || 'Internal server error' });
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().split('T')[0];

    const logs = await AttendanceLog.find({ employee: matchedEmployee._id, date: { $gte: cutoff } })
      .sort({ date: -1 })
      .select('date clockInTime clockOutTime totalHours status siteName');

    res.json({
      success: true,
      employeeName: matchedEmployee.name,
      employeeId: matchedEmployee.employeeId,
      records: logs,
    });
  } catch (error) {
    console.error('[MyAttendance]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
