const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { identifyAndVerify } = require('../utils/identifyAndVerify');
const engine = require('../utils/attendanceEngine');
const { businessTime, DEFAULT_TZ } = require('../utils/tz');
const { requireKioskDevice } = require('../middleware/kiosk');

// POST /api/v1/clock-out — Employee clock out
router.post('/',
  requireKioskDevice,
  [
    body('capturedAt').optional({ nullable: true }).isISO8601()
      .withMessage('capturedAt must be an ISO 8601 timestamp'),
    body('latitude').optional({ nullable: true }).isFloat({ min: -90, max: 90 }),
    body('longitude').optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const { images, image, latitude, longitude, capturedAt } = req.body;
      const frames = Array.isArray(images) ? images : (image ? [image] : []);
      if (frames.length === 0) return res.status(400).json({ error: 'Face image is required' });

      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database unavailable' });
      }

      const timeZone = DEFAULT_TZ;
      const { at } = engine.resolveCaptureTime(capturedAt);

      const { matchedEmployee, confidence } = await identifyAndVerify(
        frames,
        'CLOCK_OUT',
        { workLocationId: req.kioskSiteId || null }
      );

      // Most recent session within the clock-out window, open or closed — the
      // closed case is what lets us answer "you already clocked out" properly
      // instead of claiming there was no clock-in at all.
      const session = await engine.findLatestSession(matchedEmployee._id, at);
      if (!session) {
        return res.status(400).json({
          error: 'No clock-in record found for your current shift. Please clock in first.',
          code: 'NO_OPEN_SESSION',
        });
      }

      if (session.clockOutTime) {
        const totals = await engine.dayTotals(matchedEmployee._id, session.date);
        return res.status(200).json({
          success: true,
          alreadyClockedOut: true,
          employeeName: matchedEmployee.name,
          employeeId: matchedEmployee.employeeId,
          sessionNumber: session.sessionNumber,
          totalHours: session.totalHours || 0,
          dayTotalHours: totals.totalHours,
          timestamp: session.clockOutTime,
          status: session.status,
          confidence,
          message: `You already clocked out at ${businessTime(session.clockOutTime, timeZone)} ` +
                   `(${session.totalHours || 0} hrs this session, ${totals.totalHours} hrs today).`,
        });
      }

      // Guard against a clock-out timestamped before its own clock-in — only
      // reachable via a replayed offline scan with a skewed device clock, and
      // it would otherwise produce negative hours in payroll.
      if (at < new Date(session.clockInTime)) {
        return res.status(400).json({
          error: 'This scan is timestamped before your clock-in and cannot be recorded. Please ask HR to correct it.',
          code: 'CAPTURE_BEFORE_CLOCK_IN',
        });
      }

      const geo = engine.enforceGeofence(matchedEmployee, latitude, longitude, 'clock out');

      await engine.closeSession({ session, employee: matchedEmployee, at, geo, timeZone });
      const totals = await engine.dayTotals(matchedEmployee._id, session.date);

      const outTimeStr = businessTime(session.clockOutTime, timeZone);
      const overtimeNote = session.overtimeHours > 0
        ? ` Includes ${session.overtimeHours} hrs overtime.`
        : '';

      return res.status(200).json({
        success: true,
        alreadyClockedOut: false,
        employeeName: matchedEmployee.name,
        employeeId: matchedEmployee.employeeId,
        sessionNumber: session.sessionNumber,
        totalHours: session.totalHours,
        regularHours: session.regularHours,
        overtimeHours: session.overtimeHours,
        dayTotalHours: totals.totalHours,
        daySessions: totals.sessions,
        timestamp: session.clockOutTime,
        status: session.status,
        confidence,
        distanceMeters: geo.distanceMeters,
        message: `Goodbye ${matchedEmployee.name}! Clocked out at ${outTimeStr} ` +
                 `(${session.totalHours} hrs).${overtimeNote}`,
      });

    } catch (error) {
      if (error && error.isServiceError) {
        return res.status(error.status).json({ error: error.error, code: error.code });
      }
      console.error('[Scanner/ClockOut]', error.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
