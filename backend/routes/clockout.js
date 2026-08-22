const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AttendanceLog = require('../models/AttendanceLog');
const { isWithinGeofence } = require('../utils/geofence');
const { computeClockOutStatus } = require('../utils/shiftStatus');
const { identifyAndVerify } = require('../utils/identifyAndVerify');

// POST /api/v1/clock-out — Employee clock out
router.post('/', async (req, res) => {
  try {
    const { images, image, latitude, longitude } = req.body;
    const frames = images || (image ? [image] : []);
    if (frames.length === 0) return res.status(400).json({ error: 'Face image is required' });

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    let matchedEmployee, confidence;
    try {
      ({ matchedEmployee, confidence } = await identifyAndVerify(frames, 'CLOCK_OUT'));
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.error || 'Internal server error' });
    }

    const now = new Date();

    // Most recent clock-in within the last 30 hours, open or already closed —
    // covers night shifts that started "yesterday" by wall-clock date and
    // still lets us report a proper "already clocked out" message afterward.
    const lookback = new Date(now.getTime() - 30 * 60 * 60 * 1000);
    let existingLog = await AttendanceLog.findOne({
      employee: matchedEmployee._id,
      clockInTime: { $gte: lookback }
    }).sort({ clockInTime: -1 });
    if (!existingLog) {
       return res.status(400).json({ error: 'No clock-in record found for your current shift. Please clock in first.' });
    }

    const isAlreadyClockedOut = Boolean(existingLog.clockOutTime);
    if (!isAlreadyClockedOut) {
      // Geofence check — same hard block as clock-in, only if a site is assigned.
      if (matchedEmployee.workLocation) {
        const lat = latitude !== undefined && latitude !== null ? parseFloat(latitude) : null;
        const lon = longitude !== undefined && longitude !== null ? parseFloat(longitude) : null;
        if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) {
          return res.status(403).json({ error: 'Location access is required to clock out. Please enable location and try again.' });
        }
        const geo = isWithinGeofence(lat, lon, matchedEmployee.workLocation);
        if (!geo.within) {
          return res.status(403).json({
            error: `You're ${geo.distanceMeters}m from ${matchedEmployee.workLocation.name}. Move within ${matchedEmployee.workLocation.radiusMeters}m of the site to clock out.`
          });
        }
      }

      existingLog.clockOutTime = now;
      existingLog.clockOutLatitude = parseFloat(latitude || 0);
      existingLog.clockOutLongitude = parseFloat(longitude || 0);
      const outStatus = computeClockOutStatus(now, existingLog.clockInTime, matchedEmployee.shiftTemplate);
      if (outStatus === 'EARLY_DEPARTURE' && existingLog.status === 'VALID') {
        existingLog.status = outStatus;
      }
      await existingLog.save();
    }

    const outTimeStr = existingLog.clockOutTime ? new Date(existingLog.clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return res.status(200).json({
      success: true,
      employeeName: matchedEmployee.name,
      employeeId: matchedEmployee.employeeId,
      totalHours: existingLog.totalHours || 0,
      timestamp: existingLog.clockOutTime || now,
      status: 'VALID',
      confidence,
      message: isAlreadyClockedOut
        ? `You have already clocked out today at ${outTimeStr} (${existingLog.totalHours || 0} hrs).`
        : `Goodbye ${matchedEmployee.name}! Clock-out recorded at ${outTimeStr} (${existingLog.totalHours || 0} hrs).`
    });

  } catch (error) {
    console.error('[Scanner/ClockOut]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
