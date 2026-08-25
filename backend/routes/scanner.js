const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { identifyAndVerify } = require('../utils/identifyAndVerify');
const engine = require('../utils/attendanceEngine');
const { businessTime, businessDate, DEFAULT_TZ } = require('../utils/tz');
const { requireKioskDevice } = require('../middleware/kiosk');
const { resolveScanSite } = require('../utils/siteResolver');
const { assessLocation } = require('../utils/locationTrust');

// POST /api/v1/clock-in — Employee clock in
router.post('/',
  requireKioskDevice,
  [
    body('capturedAt').optional({ nullable: true }).isISO8601()
      .withMessage('capturedAt must be an ISO 8601 timestamp'),
    body('latitude').optional({ nullable: true }).isFloat({ min: -90, max: 90 }),
    body('longitude').optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
    body('accuracy').optional({ nullable: true }).isFloat({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const { images, image, latitude, longitude, accuracy, capturedAt } = req.body;
      // Accept a single legacy `image` too, normalised to the frames array.
      const frames = Array.isArray(images) ? images : (image ? [image] : []);
      if (frames.length === 0) return res.status(400).json({ error: 'Face image is required' });

      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database unavailable' });
      }

      const timeZone = DEFAULT_TZ;
      // `at` is when the scan actually happened, which for a replayed offline
      // scan is not now. Validated inside the engine.
      const { at, source } = engine.resolveCaptureTime(capturedAt);
      const deviceId = req.deviceId || null;

      // Location gate, before any ML work. Refuses a missing fix, a fix too
      // imprecise to mean anything, and a position outside every site fence.
      //
      // Employees scan from their own phones, so the site can no longer come
      // from the device — it is derived from the coordinates. That keeps the
      // benefit that mattered: comparing against a couple of hundred
      // candidates instead of all 4,000 is both faster and materially more
      // accurate, because every extra enrolled face is another chance for a
      // false match.
      const { siteIds: scopedSiteIds } = await resolveScanSite({
        latitude, longitude, accuracy, verb: 'clock in', requireSite: true,
      });

      const { matchedEmployee, confidence, margin, livenessScore } = await identifyAndVerify(
        frames,
        'CLOCK_IN',
        { workLocationIds: scopedSiteIds }
      );

      // Already clocked in? Report the existing session rather than opening a
      // second one — including across midnight for a night shift.
      const openSession = await engine.findOpenSession(matchedEmployee._id, at);
      if (openSession) {
        return res.status(200).json({
          success: true,
          alreadyClockedIn: true,
          employeeName: matchedEmployee.name,
          employeeId: matchedEmployee.employeeId,
          sessionNumber: openSession.sessionNumber,
          timestamp: openSession.clockInTime,
          status: openSession.status,
          confidence,
          message: `Welcome back ${matchedEmployee.name}! You're already clocked in since ` +
                   `${businessTime(openSession.clockInTime, timeZone)}.`,
        });
      }

      // A brand-new session, so the geofence applies. Fails closed when the
      // employee has no site assigned.
      const latest = await engine.findLatestSession(matchedEmployee._id, at);
      engine.assertNotDoubleTap(latest, at);

      // One phone cannot hold two people clocked in at once. Face recognition
      // already stops A clocking in as B; this stops one person clocking in a
      // dozen colleagues from a single handset using their photos.
      await engine.assertDeviceFree(deviceId, matchedEmployee._id, at);

      const geo = engine.enforceGeofence(matchedEmployee, latitude, longitude, 'clock in');

      // Advisory only — recorded for HR, never used to refuse a scan. GPS is
      // erratic indoors and a false fraud accusation against an honest worker
      // is worse than a missed one.
      const { flags: locationFlags, notes: locationNotes } = await assessLocation({
        latitude, longitude, accuracy, employeeId: matchedEmployee._id, at,
      });

      const log = await engine.openSession({
        employee: matchedEmployee,
        at,
        geo,
        confidence,
        margin,
        livenessScore,
        source,
        timeZone,
        deviceId,
        accuracy: accuracy === undefined || accuracy === null ? null : Number(accuracy),
        locationFlags,
        notes: [
          source === 'OFFLINE_SYNC' ? 'Recorded from an offline scan queued on the phone.' : null,
          locationNotes,
        ].filter(Boolean).join(' | ') || null,
      });

      const timeStr = businessTime(log.clockInTime, timeZone);
      const lateNote = log.status === 'LATE' ? ' You are marked late today.' : '';
      const sessionNote = log.sessionNumber > 1 ? ` (session ${log.sessionNumber} today)` : '';
      const queuedNote = source === 'OFFLINE_SYNC'
        ? ` Recorded at your original scan time of ${timeStr}.`
        : '';

      return res.status(200).json({
        success: true,
        alreadyClockedIn: false,
        employeeName: matchedEmployee.name,
        employeeId: matchedEmployee.employeeId,
        sessionNumber: log.sessionNumber,
        date: log.date,
        timestamp: log.clockInTime,
        status: log.status,
        confidence,
        matchMargin: margin,
        distanceMeters: geo.distanceMeters,
        message: `Welcome ${matchedEmployee.name}! Clocked in at ${timeStr}${sessionNote}.${lateNote}${queuedNote}`,
      });

    } catch (error) {
      // Errors raised by the ML client, the identify pipeline and the
      // attendance engine all carry { status, error } so they can be
      // returned directly — anything else is genuinely unexpected.
      if (error && error.isServiceError) {
        return res.status(error.status).json({ error: error.error, code: error.code });
      }
      console.error('[Scanner/ClockIn]', error.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/v1/clock-in/today — kiosk-side sanity check that the backend and
// the tablet agree on what day it is. A device with a wrong clock is a real
// failure mode for the offline queue, and this makes it visible on the kiosk
// instead of surfacing later as mis-dated attendance.
router.get('/today', requireKioskDevice, (req, res) => {
  const now = new Date();
  res.json({
    businessDate: businessDate(now, DEFAULT_TZ),
    businessTime: businessTime(now, DEFAULT_TZ),
    timezone: DEFAULT_TZ,
    serverTime: now.toISOString(),
  });
});

module.exports = router;
