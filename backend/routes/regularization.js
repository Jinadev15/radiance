const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, param, query, validationResult } = require('express-validator');
const RegularizationRequest = require('../models/RegularizationRequest');
const AttendanceLog = require('../models/AttendanceLog');
const Employee = require('../models/Employee');
require('../models/User');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;
const { identifyAndVerify } = require('../utils/identifyAndVerify');
const { computeWorkedHours } = require('../utils/shiftStatus');
const { instantFromZonedParts, parseHHMM, DEFAULT_TZ, businessDate } = require('../utils/tz');
const audit = require('../utils/audit');
const { requireKioskDevice } = require('../middleware/kiosk');

// POST /api/v1/regularization — kiosk-facing: employee identifies via face
// (same pipeline as clock-in) and flags a past-date attendance issue.
router.post('/',
  requireKioskDevice,
  [
    body('date').isISO8601().withMessage('A valid date is required'),
    body('reason').notEmpty().trim().isLength({ max: 500 }).withMessage('Please describe the issue'),
    body('requestedClockIn').optional({ nullable: true, checkFalsy: true }).matches(/^\d{2}:\d{2}$/),
    body('requestedClockOut').optional({ nullable: true, checkFalsy: true }).matches(/^\d{2}:\d{2}$/),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const { images, image, date, reason, requestedClockIn, requestedClockOut } = req.body;
      const frames = Array.isArray(images) ? images : (image ? [image] : []);
      if (frames.length === 0) return res.status(400).json({ error: 'Face image is required to identify you' });
      if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Database unavailable' });

      // Matched against the whole roster rather than one site: someone
      // requesting a correction is very often not at their site when
      // they do it.
      const { matchedEmployee } = await identifyAndVerify(frames, 'CLOCK_IN', {});

      const requestDate = businessDate(new Date(date), DEFAULT_TZ);
      const today = businessDate(new Date(), DEFAULT_TZ);
      if (requestDate > today) {
        return res.status(400).json({ error: 'Cannot report an issue for a future date.' });
      }

      const request = new RegularizationRequest({
        employee: matchedEmployee._id,
        date: requestDate,
        reason,
        requestedClockIn: requestedClockIn || null,
        requestedClockOut: requestedClockOut || null,
      });
      await request.save();

      res.status(201).json({
        success: true,
        employeeName: matchedEmployee.name,
        message: `Thanks ${matchedEmployee.name}, your report for ${requestDate} has been sent for review.`,
      });
    } catch (error) {
      if (error && error.isServiceError) return res.status(error.status).json({ error: error.error, code: error.code });
      console.error('[Regularization/POST]', error.message);
      res.status(500).json({ error: 'Failed to submit report. Please try again.' });
    }
  }
);

// GET /api/v1/regularization — admin/HR review queue
router.get('/', auth, requireAdminOrHr,
  [query('status').optional().isIn(['PENDING', 'APPROVED', 'REJECTED'])],
  async (req, res) => {
    try {
      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      const requests = await RegularizationRequest.find(filter)
        .populate('employee', 'name employeeId workLocation')
        .populate('reviewedBy', 'name')
        .sort({ createdAt: -1 });
      res.json(requests);
    } catch (error) {
      console.error('[Regularization/GET]', error.message);
      res.status(500).json({ error: 'Failed to fetch regularization requests' });
    }
  }
);

// PUT /api/v1/regularization/:id — approve or reject.
//
// Approval now actually applies the correction to attendance in the same
// operation. Previously this endpoint only flipped the request's status —
// the real fix was a *separate* call to PUT /attendance/manual that nothing
// ever made, so HR approved the request, believed the problem was solved,
// and the employee's hours stayed wrong until payday.
router.put('/:id', auth, requireAdminOrHr,
  [
    param('id').isMongoId().withMessage('Invalid request ID'),
    body('status').isIn(['APPROVED', 'REJECTED']).withMessage('Status must be APPROVED or REJECTED'),
    body('reviewNote').optional().isString().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const request = await RegularizationRequest.findById(req.params.id).populate('employee', 'name employeeId');
      if (!request) return res.status(404).json({ error: 'Request not found' });
      if (request.status !== 'PENDING') {
        return res.status(400).json({ error: `This request was already ${request.status.toLowerCase()}.` });
      }

      let appliedLog = null;

      if (req.body.status === 'APPROVED') {
        const hasTimes = request.requestedClockIn || request.requestedClockOut;
        if (!hasTimes) {
          return res.status(400).json({
            error: 'This request has no requested clock-in/out time to apply. ' +
                   'Use Attendance → Manual Correction instead, then reject or note this request.',
            code: 'NO_TIMES_TO_APPLY',
          });
        }

        const employee = await Employee.findById(request.employee._id)
          .populate('workLocation', 'name').populate('serviceTag', 'name').populate('shiftTemplate');
        if (!employee) return res.status(404).json({ error: 'Employee no longer exists.' });

        const toHHMM = (hhmm) => {
          const [y, m, d] = request.date.split('-').map(Number);
          const parsed = parseHHMM(hhmm);
          if (parsed === null) return null;
          return instantFromZonedParts({ year: y, month: m, day: d, hour: Math.floor(parsed / 60), minute: parsed % 60 }, DEFAULT_TZ);
        };

        const clockIn = request.requestedClockIn ? toHHMM(request.requestedClockIn) : null;
        const clockOut = request.requestedClockOut ? toHHMM(request.requestedClockOut) : null;
        if (request.requestedClockIn && !clockIn) {
          return res.status(400).json({ error: 'The requested clock-in time on this request is invalid.' });
        }
        if (clockOut && clockIn && clockOut <= clockIn) {
          return res.status(400).json({ error: 'Requested clock-out must be after the requested clock-in.' });
        }

        let log = await AttendanceLog.findOne({ employee: employee._id, date: request.date }).sort({ sessionNumber: -1 });
        const before = log ? { clockInTime: log.clockInTime, clockOutTime: log.clockOutTime, totalHours: log.totalHours } : null;

        if (!log) {
          log = new AttendanceLog({
            employee: employee._id,
            date: request.date,
            sessionNumber: 1,
            clockInTime: clockIn || new Date(`${request.date}T09:00:00`),
            status: 'VALID',
            workLocation: employee.workLocation ? employee.workLocation._id : null,
            siteName: employee.workLocation ? employee.workLocation.name : null,
            service: employee.serviceTag ? employee.serviceTag.name : null,
            timezone: DEFAULT_TZ,
          });
        }
        if (clockIn) log.clockInTime = clockIn;
        if (clockOut) log.clockOutTime = clockOut;

        if (log.clockOutTime) {
          const hours = computeWorkedHours({ clockInTime: log.clockInTime, clockOutTime: log.clockOutTime, shift: employee.shiftTemplate });
          Object.assign(log, {
            grossMinutes: hours.grossMinutes, breakMinutes: hours.breakMinutes, netMinutes: hours.netMinutes,
            regularMinutes: hours.regularMinutes, overtimeMinutes: hours.overtimeMinutes,
            totalHours: hours.totalHours, regularHours: hours.regularHours, overtimeHours: hours.overtimeHours,
            isHalfDay: hours.isHalfDay,
          });
        }
        log.markedBy = 'MANUAL';
        log.correctedBy = req.user.id;
        log.correctedAt = new Date();
        log.notes = [log.notes, `Applied from approved regularization request: ${request.reason}`].filter(Boolean).join(' | ');
        await log.save();
        appliedLog = log;

        await audit.record(req, {
          action: audit.ACTIONS.ATTENDANCE_MANUAL,
          targetModel: 'AttendanceLog',
          targetId: log._id,
          targetLabel: `${employee.name} (${employee.employeeId}) ${request.date}`,
          before,
          after: { clockInTime: log.clockInTime, clockOutTime: log.clockOutTime, totalHours: log.totalHours },
          reason: `Regularization request ${request._id} approved`,
        });
      }

      request.status = req.body.status;
      request.reviewNote = req.body.reviewNote || '';
      request.reviewedBy = req.user.id;
      request.reviewedAt = new Date();
      await request.save();

      await audit.record(req, {
        action: audit.ACTIONS.REGULARIZATION_REVIEWED,
        targetModel: 'RegularizationRequest',
        targetId: request._id,
        targetLabel: `${request.employee.name} (${request.employee.employeeId}) ${request.date}`,
        after: { status: request.status, appliedToAttendance: Boolean(appliedLog) },
        reason: req.body.reviewNote || null,
      });

      res.json({
        success: true,
        request,
        appliedLog,
        message: appliedLog
          ? 'Request approved and the attendance record has been corrected.'
          : `Request ${req.body.status.toLowerCase()}.`,
      });
    } catch (error) {
      console.error('[Regularization/PUT]', error.message);
      res.status(500).json({ error: 'Failed to update request' });
    }
  }
);

module.exports = router;
