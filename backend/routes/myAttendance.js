const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AttendanceLog = require('../models/AttendanceLog');
const { identifyAndVerify } = require('../utils/identifyAndVerify');
const { businessTime, recentBusinessDates, DEFAULT_TZ } = require('../utils/tz');
const { requireKioskDevice } = require('../middleware/kiosk');

// POST /api/v1/my-attendance — kiosk self-service: identify via face, see
// your own last 7 days. No employee login exists (or needs to) — the face
// scan *is* the authentication, same as clock-in.
router.post('/', requireKioskDevice, async (req, res) => {
  try {
    const { images, image } = req.body;
    const frames = Array.isArray(images) ? images : (image ? [image] : []);
    if (frames.length === 0) return res.status(400).json({ error: 'Face image is required' });
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Database unavailable' });

    // Matched against the whole roster rather than one site: someone
    // checking their own attendance is very often not at their site when
    // they do it.
    const { matchedEmployee } = await identifyAndVerify(frames, 'CLOCK_IN', {});

    const cutoff = recentBusinessDates(7, DEFAULT_TZ).slice(-1)[0];
    const logs = await AttendanceLog.find({ employee: matchedEmployee._id, date: { $gte: cutoff } })
      .sort({ date: -1, sessionNumber: 1 })
      .select('date sessionNumber clockInTime clockOutTime totalHours overtimeHours status siteName timezone');

    // Grouped by day so multiple sessions in one shift read as one entry
    // rather than confusing separate rows.
    const byDate = new Map();
    for (const log of logs) {
      if (!byDate.has(log.date)) byDate.set(log.date, []);
      byDate.get(log.date).push({
        session: log.sessionNumber,
        clockIn: businessTime(log.clockInTime, log.timezone || DEFAULT_TZ),
        clockOut: log.clockOutTime ? businessTime(log.clockOutTime, log.timezone || DEFAULT_TZ) : null,
        totalHours: log.totalHours || 0,
        overtimeHours: log.overtimeHours || 0,
        status: log.status,
        siteName: log.siteName,
      });
    }

    const records = Array.from(byDate.entries()).map(([date, sessions]) => ({
      date,
      sessions,
      totalHours: parseFloat(sessions.reduce((sum, s) => sum + s.totalHours, 0).toFixed(2)),
    }));

    res.json({
      success: true,
      employeeName: matchedEmployee.name,
      employeeId: matchedEmployee.employeeId,
      records,
    });
  } catch (error) {
    if (error && error.isServiceError) return res.status(error.status).json({ error: error.error, code: error.code });
    console.error('[MyAttendance]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
