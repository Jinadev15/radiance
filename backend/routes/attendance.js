const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { query, body, param, validationResult } = require('express-validator');
const AttendanceLog = require('../models/AttendanceLog');
const Employee = require('../models/Employee');
require('../models/WorkLocation');
require('../models/ServiceTag');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;
const audit = require('../utils/audit');
const { computeWorkedHours } = require('../utils/shiftStatus');
const { businessDate, businessDateTime, businessTime, DEFAULT_TZ } = require('../utils/tz');
const { restrictToApproved } = require('../utils/attendanceEngine');
const deviceAnomalies = require('../utils/deviceAnomalies');

// Supervisor scoping now filters on the log's own denormalised `workLocation`
// rather than first resolving every employee id at that site and passing a
// giant $in array — which grew with headcount and made every scoped query
// slower than the unscoped one.
function applyScope(filter, req) {
  if (req.user.role === 'supervisor' && req.user.workLocation) {
    filter.workLocation = req.user.workLocation;
  }
  return filter;
}

// GET /api/v1/attendance
router.get('/', auth,
  [
    query('date').optional().matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date must be YYYY-MM-DD'),
    query('startDate').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('endDate').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('employeeId').optional().isMongoId(),
    query('status').optional().isIn(['VALID', 'LATE', 'EARLY_DEPARTURE', 'LOCATION_MISMATCH', 'SPOOF_ATTEMPT']),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
    query('openOnly').optional().isBoolean().toBoolean(),
    query('approvedOnly').optional().isBoolean().toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database unavailable' });
      }

      const page = req.query.page || 1;
      const limit = req.query.limit || 100;
      const { date, startDate, endDate, employeeId, status } = req.query;

      let filter = {};
      if (date) filter.date = date;
      else if (startDate || endDate) {
        filter.date = {};
        if (startDate) filter.date.$gte = startDate;
        if (endDate) filter.date.$lte = endDate;
      }
      if (status) filter.status = status;
      if (req.query.openOnly) filter.clockOutTime = null;

      applyScope(filter, req);

      if (employeeId) {
        // A supervisor asking about someone outside their site gets an empty
        // result, not another site's data.
        if (filter.workLocation) {
          const emp = await Employee.findOne({ _id: employeeId, workLocation: filter.workLocation }).select('_id');
          if (!emp) return res.json({ logs: [], pagination: { page, limit, total: 0, pages: 1 } });
        }
        filter.employee = employeeId;
      }

      filter = await restrictToApproved(filter, req.query.approvedOnly);

      const [logs, total] = await Promise.all([
        AttendanceLog.find(filter)
          .populate('employee', 'name employeeId phone workLocation status')
          .sort({ clockInTime: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        AttendanceLog.countDocuments(filter),
      ]);

      // Paginating without a total left the UI silently truncating at the
      // default limit with no way for HR to know records were missing.
      res.json({
        logs,
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (error) {
      console.error('[Attendance/GET]', error.message);
      res.status(500).json({ error: 'Failed to fetch attendance records' });
    }
  }
);

// GET /api/v1/attendance/today
router.get('/today', auth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    // Business date, not the UTC date — before this, every clock-in between
    // midnight and 05:30 IST was filed under (and looked up as) the wrong day.
    const today = businessDate(new Date(), DEFAULT_TZ);
    const filter = applyScope({ date: today }, req);

    const logs = await AttendanceLog.find(filter)
      .populate('employee', 'name employeeId status')
      .sort({ clockInTime: -1 });
    res.json(logs);
  } catch (error) {
    console.error('[Attendance/Today]', error.message);
    res.status(500).json({ error: "Failed to fetch today's attendance" });
  }
});

// GET /api/v1/attendance/export — the payroll sheet.
//
// Times are rendered in the business timezone. Previously they came out of
// toLocaleTimeString() in the server's locale, which on a UTC host meant every
// single time in the file HR used to pay people was 5h30m wrong.
router.get('/export', auth,
  [
    query('startDate').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('endDate').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('approvedOnly').optional().isBoolean().toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    // "Employee Status" is always in the sheet, whether or not approvedOnly
    // was used to filter it — this is the column that answers "has HR
    // actually confirmed this person" when someone is putting salary
    // together from this file.
    const header = [
      'Employee ID', 'Name', 'Phone', 'Employee Status', 'Site', 'Service', 'Date', 'Session',
      'Clock In', 'Clock Out', 'Gross Hours', 'Break (min)', 'Net Hours',
      'Regular Hours', 'Overtime Hours', 'Half Day', 'Attendance Status', 'Recorded By',
      'Match Confidence', 'Notes',
    ].join(',');

    const filename = `attendance_${businessDate(new Date(), DEFAULT_TZ)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    try {
      if (mongoose.connection.readyState !== 1) return res.send(`${header}\n`);

      const { startDate, endDate, siteName, service } = req.query;
      let filter = {};
      if (startDate || endDate) {
        filter.date = {};
        if (startDate) filter.date.$gte = startDate;
        if (endDate) filter.date.$lte = endDate;
      }
      if (siteName) filter.siteName = siteName;
      if (service) filter.service = service;
      applyScope(filter, req);
      filter = await restrictToApproved(filter, req.query.approvedOnly);

      // Streamed with a cursor rather than loaded into an array: a year of
      // attendance for a few hundred employees is hundreds of thousands of
      // rows, and buffering that in memory to build one string is how an
      // export takes the process down.
      res.write(`${header}\n`);

      const csvCell = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        // Guard against CSV injection: a leading =, +, - or @ is executed as
        // a formula when the file is opened in Excel, and employee names are
        // attacker-influenced input.
        const escaped = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
        return /[",\n\r]/.test(escaped) ? `"${escaped.replace(/"/g, '""')}"` : escaped;
      };

      const cursor = AttendanceLog.find(filter)
        .populate('employee', 'name employeeId phone status')
        .sort({ date: -1, clockInTime: -1 })
        .cursor();

      // Human-readable, not the raw enum — "Pending Approval" reads as a
      // to-do, "PENDING_APPROVAL" reads as a data glitch.
      const EMPLOYEE_STATUS_LABEL = {
        ACTIVE: 'Approved',
        PENDING_APPROVAL: 'Pending Approval',
        INACTIVE: 'Inactive',
        REJECTED: 'Rejected',
      };

      let rows = 0;
      for await (const log of cursor) {
        const emp = log.employee || {};
        const tz = log.timezone || DEFAULT_TZ;
        res.write([
          csvCell(emp.employeeId),
          csvCell(emp.name),
          csvCell(emp.phone),
          csvCell(EMPLOYEE_STATUS_LABEL[emp.status] || emp.status || ''),
          csvCell(log.siteName),
          csvCell(log.service),
          csvCell(log.date),
          csvCell(log.sessionNumber),
          csvCell(log.clockInTime ? businessTime(log.clockInTime, tz) : ''),
          csvCell(log.clockOutTime ? businessTime(log.clockOutTime, tz) : ''),
          csvCell(log.grossMinutes ? (log.grossMinutes / 60).toFixed(2) : ''),
          csvCell(log.breakMinutes || 0),
          csvCell(log.totalHours || ''),
          csvCell(log.regularHours || ''),
          csvCell(log.overtimeHours || ''),
          csvCell(log.isHalfDay ? 'Yes' : ''),
          csvCell(log.status),
          csvCell(log.markedBy),
          csvCell(log.confidence ? `${(log.confidence * 100).toFixed(1)}%` : ''),
          csvCell(log.notes),
        ].join(',') + '\n');
        rows += 1;
      }

      if (rows === 0) res.write('# No attendance records matched this filter\n');
      res.end();
    } catch (error) {
      console.error('[Attendance/Export]', error.message);
      // Headers are already sent by this point, so surface the failure inside
      // the file rather than pretending the export completed.
      if (!res.headersSent) return res.status(500).json({ error: 'Export failed' });
      res.write('# EXPORT FAILED PARTWAY THROUGH — do not use this file for payroll\n');
      res.end();
    }
  }
);

// GET /api/v1/attendance/summary — per-employee monthly totals, which is the
// shape payroll actually needs (one row per person, not one per session).
router.get('/summary', auth,
  [
    query('startDate').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('startDate (YYYY-MM-DD) is required'),
    query('endDate').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('endDate (YYYY-MM-DD) is required'),
    query('approvedOnly').optional().isBoolean().toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      if (mongoose.connection.readyState !== 1) return res.json([]);
      let match = { date: { $gte: req.query.startDate, $lte: req.query.endDate } };
      applyScope(match, req);
      match = await restrictToApproved(match, req.query.approvedOnly);

      const rows = await AttendanceLog.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$employee',
            // Distinct dates, so two sessions in one day count as one day present.
            daysPresent: { $addToSet: '$date' },
            sessions: { $sum: 1 },
            totalHours: { $sum: '$totalHours' },
            regularHours: { $sum: '$regularHours' },
            overtimeHours: { $sum: '$overtimeHours' },
            lateCount: { $sum: { $cond: [{ $eq: ['$status', 'LATE'] }, 1, 0] } },
            earlyDepartures: { $sum: { $cond: [{ $eq: ['$status', 'EARLY_DEPARTURE'] }, 1, 0] } },
            halfDays: { $sum: { $cond: ['$isHalfDay', 1, 0] } },
            manualEntries: { $sum: { $cond: [{ $ne: ['$markedBy', 'AUTO'] }, 1, 0] } },
            siteName: { $last: '$siteName' },
          },
        },
        {
          $project: {
            daysPresent: { $size: '$daysPresent' },
            sessions: 1, siteName: 1, lateCount: 1, earlyDepartures: 1, halfDays: 1, manualEntries: 1,
            totalHours: { $round: ['$totalHours', 2] },
            regularHours: { $round: ['$regularHours', 2] },
            overtimeHours: { $round: ['$overtimeHours', 2] },
          },
        },
      ]);

      const employees = await Employee.find({ _id: { $in: rows.map(r => r._id) } })
        .select('name employeeId phone status')
        .lean();
      const byId = new Map(employees.map(e => [String(e._id), e]));

      res.json(rows.map(r => {
        const emp = byId.get(String(r._id)) || {};
        return {
          employee: r._id,
          name: emp.name || null,
          employeeCode: emp.employeeId || null,
          phone: emp.phone || null,
          // 'ACTIVE' | 'PENDING_APPROVAL' | 'INACTIVE' | 'REJECTED' — this is
          // the "hasn't been confirmed by HR yet" flag the payroll sheet
          // needs before this row's hours get paid out.
          employeeStatus: emp.status || null,
          siteName: r.siteName,
          daysPresent: r.daysPresent,
          sessions: r.sessions,
          totalHours: r.totalHours,
          regularHours: r.regularHours,
          overtimeHours: r.overtimeHours,
          lateCount: r.lateCount,
          earlyDepartures: r.earlyDepartures,
          halfDays: r.halfDays,
          manualEntries: r.manualEntries,
        };
      }).sort((a, b) => String(a.name).localeCompare(String(b.name))));
    } catch (error) {
      console.error('[Attendance/Summary]', error.message);
      res.status(500).json({ error: 'Failed to build attendance summary' });
    }
  }
);

// PUT /api/v1/attendance/manual — admin/HR corrects or backfills a session.
router.put('/manual', auth, requireAdminOrHr,
  [
    body('employeeId').isMongoId().withMessage('Valid employee ID required'),
    body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date must be YYYY-MM-DD'),
    body('sessionNumber').optional().isInt({ min: 1 }).toInt(),
    body('clockInTime').isISO8601().withMessage('A valid clock-in time is required'),
    body('clockOutTime').optional({ nullable: true }).isISO8601().withMessage('Invalid clock-out time'),
    body('reason').notEmpty().trim().withMessage('A reason for the correction is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { employeeId, date, clockInTime, clockOutTime, notes, reason } = req.body;
      const sessionNumber = req.body.sessionNumber || 1;

      const employee = await Employee.findById(employeeId)
        .populate('workLocation', 'name')
        .populate('serviceTag', 'name')
        .populate('shiftTemplate');
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      const clockIn = new Date(clockInTime);
      const clockOut = clockOutTime ? new Date(clockOutTime) : null;
      if (clockOut && clockOut <= clockIn) {
        return res.status(400).json({ error: 'Clock-out must be after clock-in.' });
      }

      // Targets a specific session. The previous version did
      // findOne({ employee, date }) and assumed one row per day, so with
      // multiple sessions it silently edited whichever happened to come back
      // first.
      let log = await AttendanceLog.findOne({ employee: employeeId, date, sessionNumber });
      const isNew = !log;
      const before = log
        ? {
            clockInTime: log.clockInTime,
            clockOutTime: log.clockOutTime,
            totalHours: log.totalHours,
            status: log.status,
          }
        : null;

      if (!log) {
        log = new AttendanceLog({
          employee: employeeId,
          date,
          sessionNumber,
          clockInTime: clockIn,
          status: 'VALID',
          workLocation: employee.workLocation ? employee.workLocation._id : null,
          siteName: employee.workLocation ? employee.workLocation.name : null,
          service: employee.serviceTag ? employee.serviceTag.name : null,
          timezone: DEFAULT_TZ,
        });
      }

      log.clockInTime = clockIn;
      log.clockOutTime = clockOut;

      // Recompute the payroll breakdown so a correction produces the same
      // numbers a real scan would, rather than leaving stale hours behind.
      const hours = computeWorkedHours({
        clockInTime: clockIn,
        clockOutTime: clockOut,
        shift: employee.shiftTemplate,
      });
      Object.assign(log, {
        grossMinutes: hours.grossMinutes,
        breakMinutes: hours.breakMinutes,
        netMinutes: hours.netMinutes,
        regularMinutes: hours.regularMinutes,
        overtimeMinutes: hours.overtimeMinutes,
        totalHours: hours.totalHours,
        regularHours: hours.regularHours,
        overtimeHours: hours.overtimeHours,
        isHalfDay: hours.isHalfDay,
      });

      log.markedBy = 'MANUAL';
      log.correctedBy = req.user.id;
      log.correctedAt = new Date();
      log.notes = [log.notes, notes, `Corrected: ${reason}`].filter(Boolean).join(' | ');

      await log.save();

      // Names the actual person, not just their role — the whole point of the
      // audit trail is that a disputed record can be traced to someone.
      await audit.record(req, {
        action: audit.ACTIONS.ATTENDANCE_MANUAL,
        targetModel: 'AttendanceLog',
        targetId: log._id,
        targetLabel: `${employee.name} (${employee.employeeId}) ${date} #${sessionNumber}`,
        before,
        after: {
          clockInTime: log.clockInTime,
          clockOutTime: log.clockOutTime,
          totalHours: log.totalHours,
          status: log.status,
          created: isNew,
        },
        reason,
      });

      res.json({ success: true, created: isNew, log });
    } catch (error) {
      if (error && error.code === 11000) {
        return res.status(409).json({ error: 'A record for this employee, date and session already exists.' });
      }
      console.error('[Attendance/Manual]', error.message);
      res.status(500).json({ error: 'Failed to save manual correction' });
    }
  }
);

// POST /api/v1/attendance/override — supervisor marks someone present.
//
// The fallback for when face recognition simply will not work for a person:
// bad light, an injury, a covered face, a failing camera. Without this, a
// scan failure meant the employee had no path at all — they stood there, then
// left, then weren't paid. HR will not adopt a system where that is possible,
// and rightly so. Bounded and reported so it can't quietly become the norm.
const OVERRIDE_MONTHLY_LIMIT = Number(process.env.OVERRIDE_MONTHLY_LIMIT || 3);

router.post('/override', auth,
  [
    body('employeeId').isMongoId().withMessage('Valid employee ID required'),
    body('action').isIn(['CLOCK_IN', 'CLOCK_OUT']).withMessage('action must be CLOCK_IN or CLOCK_OUT'),
    body('reason').notEmpty().trim().isLength({ min: 5, max: 500 })
      .withMessage('Please describe why the scan could not be used'),
    body('at').optional({ nullable: true }).isISO8601(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findById(req.body.employeeId)
        .populate('workLocation', 'name')
        .populate('serviceTag', 'name')
        .populate('shiftTemplate');
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      // A supervisor may only override their own site's staff.
      if (req.user.role === 'supervisor') {
        if (String(employee.workLocation?._id) !== String(req.user.workLocation)) {
          return res.status(403).json({ error: 'You can only override attendance for your own site.' });
        }
      }

      const at = req.body.at ? new Date(req.body.at) : new Date();
      if (at > new Date(Date.now() + 60 * 1000)) {
        return res.status(400).json({ error: 'Cannot record an override in the future.' });
      }
      const date = businessDate(at, DEFAULT_TZ);
      const monthPrefix = date.slice(0, 7);

      // Cap per employee per month, so a chronic recognition problem surfaces
      // as a problem to fix instead of being papered over indefinitely.
      const usedThisMonth = await AttendanceLog.countDocuments({
        employee: employee._id,
        markedBy: 'SUPERVISOR_OVERRIDE',
        date: { $regex: `^${monthPrefix}` },
      });
      if (usedThisMonth >= OVERRIDE_MONTHLY_LIMIT) {
        return res.status(429).json({
          error: `${employee.name} has already had ${usedThisMonth} manual overrides this month ` +
                 `(limit ${OVERRIDE_MONTHLY_LIMIT}). Re-enrol their face from the Employees page, ` +
                 'or ask HR to make a manual correction.',
          code: 'OVERRIDE_LIMIT_REACHED',
        });
      }

      const engine = require('../utils/attendanceEngine');

      if (req.body.action === 'CLOCK_IN') {
        const open = await engine.findOpenSession(employee._id, at);
        if (open) {
          return res.status(409).json({
            error: `${employee.name} is already clocked in since ${businessTime(open.clockInTime, DEFAULT_TZ)}.`,
            code: 'ALREADY_CLOCKED_IN',
          });
        }
        // No geofence on an override: the supervisor is physically present and
        // is vouching for the person. Their name on the record is the control.
        const log = await engine.openSession({
          employee, at, geo: null,
          confidence: null, margin: null, livenessScore: null,
          source: 'SUPERVISOR_OVERRIDE',
          timeZone: DEFAULT_TZ,
          notes: `Supervisor override by ${req.user.name || req.user.role}: ${req.body.reason}`,
        });

        await audit.record(req, {
          action: audit.ACTIONS.ATTENDANCE_OVERRIDE,
          targetModel: 'AttendanceLog',
          targetId: log._id,
          targetLabel: `${employee.name} (${employee.employeeId}) ${date} #${log.sessionNumber}`,
          after: { action: 'CLOCK_IN', at: log.clockInTime, status: log.status },
          reason: req.body.reason,
        });

        return res.status(201).json({
          success: true,
          sessionNumber: log.sessionNumber,
          overridesUsedThisMonth: usedThisMonth + 1,
          overrideLimit: OVERRIDE_MONTHLY_LIMIT,
          message: `${employee.name} marked present at ${businessTime(log.clockInTime, DEFAULT_TZ)}.`,
        });
      }

      const open = await engine.findOpenSession(employee._id, at);
      if (!open) {
        return res.status(400).json({ error: `${employee.name} has no open session to close.`, code: 'NO_OPEN_SESSION' });
      }
      if (at < new Date(open.clockInTime)) {
        return res.status(400).json({ error: 'Clock-out cannot be before the clock-in.' });
      }

      open.markedBy = 'SUPERVISOR_OVERRIDE';
      open.notes = [open.notes, `Clock-out override by ${req.user.name || req.user.role}: ${req.body.reason}`]
        .filter(Boolean).join(' | ');
      await engine.closeSession({ session: open, employee, at, geo: null, timeZone: DEFAULT_TZ });

      await audit.record(req, {
        action: audit.ACTIONS.ATTENDANCE_OVERRIDE,
        targetModel: 'AttendanceLog',
        targetId: open._id,
        targetLabel: `${employee.name} (${employee.employeeId}) ${open.date} #${open.sessionNumber}`,
        after: { action: 'CLOCK_OUT', at: open.clockOutTime, totalHours: open.totalHours },
        reason: req.body.reason,
      });

      return res.json({
        success: true,
        totalHours: open.totalHours,
        overridesUsedThisMonth: usedThisMonth + 1,
        overrideLimit: OVERRIDE_MONTHLY_LIMIT,
        message: `${employee.name} clocked out at ${businessTime(open.clockOutTime, DEFAULT_TZ)} (${open.totalHours} hrs).`,
      });
    } catch (error) {
      if (error && error.isServiceError) return res.status(error.status).json({ error: error.error, code: error.code });
      console.error('[Attendance/Override]', error.message);
      res.status(500).json({ error: 'Failed to record override' });
    }
  }
);

// GET /api/v1/attendance/anomalies — the patterns worth a human look.
//
// Everything here comes from data already being stored; it just was not being
// read. Low-confidence matches are the early warning for recognition drift
// and for a wrong-person match having gone unnoticed.
router.get('/anomalies', auth, requireAdminOrHr,
  [query('days').optional().isInt({ min: 1, max: 90 }).toInt()],
  async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) return res.json({});
      const days = req.query.days || 7;
      const { addBusinessDays } = require('../utils/tz');
      const today = businessDate(new Date(), DEFAULT_TZ);
      const since = addBusinessDays(today, -(days - 1), DEFAULT_TZ);

      const base = applyScope({ date: { $gte: since, $lte: today } }, req);

      const [lowConfidence, farFromSite, manualHeavy, longSessions, overtimeLeaders,
             sharedDevices, flaggedLocations] = await Promise.all([
        // Matches that only just cleared the threshold.
        AttendanceLog.find({ ...base, confidence: { $ne: null, $lt: 0.55 } })
          .populate('employee', 'name employeeId')
          .sort({ confidence: 1 }).limit(20)
          .select('employee date confidence matchMargin siteName clockInTime'),
        // Clocked in inside the radius, but only just — worth seeing before
        // it becomes a dispute.
        AttendanceLog.find({ ...base, clockInDistanceMeters: { $ne: null, $gte: 100 } })
          .populate('employee', 'name employeeId')
          .sort({ clockInDistanceMeters: -1 }).limit(20)
          .select('employee date clockInDistanceMeters siteName'),
        // Employees whose attendance is mostly not coming from real scans.
        AttendanceLog.aggregate([
          { $match: { ...base, markedBy: { $ne: 'AUTO' } } },
          { $group: { _id: '$employee', count: { $sum: 1 }, kinds: { $addToSet: '$markedBy' } } },
          { $match: { count: { $gte: 3 } } },
          { $sort: { count: -1 } }, { $limit: 20 },
        ]),
        // Sessions long enough to suggest a missed clock-out.
        AttendanceLog.find({ ...base, netMinutes: { $gte: 14 * 60 } })
          .populate('employee', 'name employeeId')
          .sort({ netMinutes: -1 }).limit(20)
          .select('employee date totalHours markedBy siteName'),
        AttendanceLog.aggregate([
          { $match: base },
          { $group: { _id: '$employee', overtimeHours: { $sum: '$overtimeHours' } } },
          { $match: { overtimeHours: { $gt: 0 } } },
          { $sort: { overtimeHours: -1 } }, { $limit: 10 },
        ]),
        // Fraud signals specific to people scanning from their own phones.
        deviceAnomalies.sharedDevices(base),
        deviceAnomalies.flaggedLocations(base),
      ]);

      const nameFor = async (rows) => {
        const ids = rows.map(r => r._id).filter(Boolean);
        if (ids.length === 0) return rows;
        const employees = await Employee.find({ _id: { $in: ids } }).select('name employeeId').lean();
        const byId = new Map(employees.map(e => [String(e._id), e]));
        return rows.map(r => ({ ...r, employee: byId.get(String(r._id)) || null }));
      };

      res.json({
        window: { from: since, to: today, days },
        lowConfidenceMatches: lowConfidence,
        clockedInNearBoundary: farFromSite,
        heavyManualEntry: await nameFor(manualHeavy),
        suspiciouslyLongSessions: longSessions,
        overtimeLeaders: await nameFor(overtimeLeaders),
        sharedDevices,
        flaggedLocations,
      });
    } catch (error) {
      console.error('[Attendance/Anomalies]', error.message);
      res.status(500).json({ error: 'Failed to build anomaly report' });
    }
  }
);

// GET /api/v1/attendance/:employeeId/day/:date — every session for one person
// on one day, plus the day's totals.
router.get('/:employeeId/day/:date', auth,
  [param('employeeId').isMongoId(), param('date').matches(/^\d{4}-\d{2}-\d{2}$/)],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const filter = applyScope({ employee: req.params.employeeId, date: req.params.date }, req);
      const sessions = await AttendanceLog.find(filter).sort({ sessionNumber: 1 });
      const totals = sessions.reduce((acc, s) => ({
        sessions: acc.sessions + 1,
        totalHours: parseFloat((acc.totalHours + (s.totalHours || 0)).toFixed(2)),
        regularHours: parseFloat((acc.regularHours + (s.regularHours || 0)).toFixed(2)),
        overtimeHours: parseFloat((acc.overtimeHours + (s.overtimeHours || 0)).toFixed(2)),
      }), { sessions: 0, totalHours: 0, regularHours: 0, overtimeHours: 0 });
      res.json({ date: req.params.date, sessions, totals });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch the day\'s sessions' });
    }
  }
);

module.exports = router;
