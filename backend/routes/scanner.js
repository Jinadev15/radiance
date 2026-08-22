const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AttendanceLog = require('../models/AttendanceLog');
const { isWithinGeofence } = require('../utils/geofence');
const { computeClockInStatus } = require('../utils/shiftStatus');
const { identifyAndVerify } = require('../utils/identifyAndVerify');

// POST /api/v1/clock-in — Employee clock in
router.post('/', async (req, res) => {
  try {
    const { images, image, latitude, longitude } = req.body;
    // Accept a single legacy `image` too, normalized to the frames array.
    const frames = images || (image ? [image] : []);
    if (frames.length === 0) return res.status(400).json({ error: 'Face image is required' });

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    let matchedEmployee, confidence;
    try {
      ({ matchedEmployee, confidence } = await identifyAndVerify(frames, 'CLOCK_IN'));
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.error || 'Internal server error' });
    }

    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    // Look for an already-open shift within the last 20 hours, not just "today's"
    // date string — a night shift that started yesterday evening is still the
    // same ongoing shift after midnight, and shouldn't create a second log.
    const lookback = new Date(now.getTime() - 20 * 60 * 60 * 1000);
    let existingLog = await AttendanceLog.findOne({
      employee: matchedEmployee._id,
      clockInTime: { $gte: lookback },
      clockOutTime: { $exists: false }
    }).sort({ clockInTime: -1 });
    let isRepeat = false;
    let status = 'VALID';

    if (!existingLog) {
      // Geofence check — hard block, only if the employee is assigned to a site.
      // Matches Truein's behavior: an out-of-radius attempt simply isn't permitted,
      // it doesn't get logged as a fudged "present" record.
      if (matchedEmployee.workLocation) {
        const lat = latitude !== undefined && latitude !== null ? parseFloat(latitude) : null;
        const lon = longitude !== undefined && longitude !== null ? parseFloat(longitude) : null;
        if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) {
          return res.status(403).json({ error: 'Location access is required to clock in. Please enable location and try again.' });
        }
        const geo = isWithinGeofence(lat, lon, matchedEmployee.workLocation);
        if (!geo.within) {
          return res.status(403).json({
            error: `You're ${geo.distanceMeters}m from ${matchedEmployee.workLocation.name}. Move within ${matchedEmployee.workLocation.radiusMeters}m of the site to clock in.`
          });
        }
      }

      status = computeClockInStatus(now, matchedEmployee.shiftTemplate);

      const newLog = new AttendanceLog({
        employee: matchedEmployee._id,
        date: today,
        clockInTime: now,
        clockInLatitude: parseFloat(latitude || 0),
        clockInLongitude: parseFloat(longitude || 0),
        status,
        confidence,
        markedBy: 'AUTO',
        siteName: matchedEmployee.workLocation?.name || null,
        service: matchedEmployee.serviceTag?.name || null,
      });
      await newLog.save();
    } else {
      isRepeat = true;
      status = existingLog.status;
    }

    const timeStr = (isRepeat ? existingLog.clockInTime : now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const lateNote = status === 'LATE' ? ' You are marked late today.' : '';

    return res.status(200).json({
      success: true,
      employeeName: matchedEmployee.name,
      employeeId: matchedEmployee.employeeId,
      timestamp: isRepeat ? existingLog.clockInTime : now,
      status,
      confidence,
      message: isRepeat
        ? `Welcome back ${matchedEmployee.name}! You already clocked in today at ${timeStr}.`
        : `Welcome ${matchedEmployee.name}! Clock-in successful.${lateNote}`
    });

  } catch (error) {
    console.error('[Scanner/ClockIn]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
