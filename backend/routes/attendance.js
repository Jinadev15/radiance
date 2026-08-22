const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { query, body, validationResult } = require('express-validator');
const AttendanceLog = require('../models/AttendanceLog');
const Employee = require('../models/Employee');
require('../models/WorkLocation');
require('../models/ServiceTag');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;

// Supervisors only see attendance for employees at their own site.
async function supervisorEmployeeIds(req) {
  if (req.user.role !== 'supervisor' || !req.user.workLocation) return null;
  const employees = await Employee.find({ workLocation: req.user.workLocation }).select('_id');
  return employees.map(e => e._id);
}

// GET /api/v1/attendance
router.get('/', auth,
  [
    query('date').optional().isISO8601(),
    query('employeeId').optional().isMongoId(),
    query('status').optional().isIn(['VALID', 'LATE', 'EARLY_DEPARTURE', 'LOCATION_MISMATCH', 'SPOOF_ATTEMPT']),
    query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      if (mongoose.connection.readyState !== 1) return res.json([]);

      const { date, employeeId, status, limit = 100 } = req.query;
      const filter = {};
      if (date) filter.date = date;
      if (status) filter.status = status;

      const scopedIds = await supervisorEmployeeIds(req);
      if (scopedIds) {
        const scopedIdStrings = scopedIds.map(id => id.toString());
        if (employeeId && !scopedIdStrings.includes(employeeId)) {
          return res.json([]); // asking about someone outside their site
        }
        filter.employee = employeeId ? employeeId : { $in: scopedIds };
      } else if (employeeId) {
        filter.employee = employeeId;
      }

      const logs = await AttendanceLog.find(filter)
        .populate('employee', 'name employeeId phone workLocation')
        .sort({ clockInTime: -1 })
        .limit(limit);

      res.json(logs);
    } catch (error) {
      console.warn('[Attendance Warning]', error.message);
      res.json([]);
    }
  }
);

// GET /api/v1/attendance/today
router.get('/today', auth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);

    const today = new Date().toISOString().split('T')[0];
    const filter = { date: today };
    const scopedIds = await supervisorEmployeeIds(req);
    if (scopedIds) filter.employee = { $in: scopedIds };

    const logs = await AttendanceLog.find(filter)
      .populate('employee', 'name employeeId')
      .sort({ clockInTime: -1 });
    res.json(logs);
  } catch (error) {
    console.warn('[Attendance Today Warning]', error.message);
    res.json([]);
  }
});

// GET /api/v1/attendance/export — optionally scoped to one site and/or service,
// which is what turns this from a flat log dump into something a client
// invoice can actually be built from.
router.get('/export', auth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="attendance_${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send('Employee ID,Name,Phone,Site,Service,Date,Clock In,Clock Out,Total Hours,Status,Confidence\n');
    }

    const { startDate, endDate, siteName, service } = req.query;
    const filter = {};
    if (startDate) filter.date = { ...filter.date, $gte: startDate };
    if (endDate) filter.date = { ...filter.date, $lte: endDate };
    if (siteName) filter.siteName = siteName;
    if (service) filter.service = service;

    const scopedIds = await supervisorEmployeeIds(req);
    if (scopedIds) filter.employee = { $in: scopedIds };

    const logs = await AttendanceLog.find(filter)
      .populate('employee', 'name employeeId phone')
      .sort({ date: -1, clockInTime: -1 });

    const csvRows = ['Employee ID,Name,Phone,Site,Service,Date,Clock In,Clock Out,Total Hours,Status,Confidence'];
    logs.forEach(log => {
      const emp = log.employee || {};
      const clockIn = log.clockInTime ? new Date(log.clockInTime).toLocaleTimeString() : '';
      const clockOut = log.clockOutTime ? new Date(log.clockOutTime).toLocaleTimeString() : '';
      csvRows.push([
        emp.employeeId || '',
        `"${emp.name || ''}"`,
        emp.phone || '',
        `"${log.siteName || ''}"`,
        `"${log.service || ''}"`,
        log.date,
        clockIn,
        clockOut,
        log.totalHours || '',
        log.status,
        log.confidence ? (log.confidence * 100).toFixed(1) + '%' : ''
      ].join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvRows.join('\n'));
  } catch (error) {
    console.error('[Attendance/Export]', error.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// PUT /api/v1/attendance/manual — admin/HR corrects or backfills a record
// (e.g. resolving an approved regularization request). Creates the log if
// none exists for that employee/date yet.
router.put('/manual', auth, requireAdminOrHr,
  [
    body('employeeId').isMongoId().withMessage('Valid employee ID required'),
    body('date').isISO8601().withMessage('Valid date required'),
    body('clockInTime').optional({ nullable: true }).isISO8601().withMessage('Invalid clock-in time'),
    body('clockOutTime').optional({ nullable: true }).isISO8601().withMessage('Invalid clock-out time'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { employeeId, date, clockInTime, clockOutTime, notes } = req.body;
      if (!clockInTime) return res.status(400).json({ error: 'A clock-in time is required.' });

      let log = await AttendanceLog.findOne({ employee: employeeId, date });
      if (!log) {
        const employee = await Employee.findById(employeeId).populate('workLocation', 'name').populate('serviceTag', 'name');
        if (!employee) return res.status(404).json({ error: 'Employee not found' });
        log = new AttendanceLog({
          employee: employeeId,
          date,
          status: 'VALID',
          siteName: employee.workLocation?.name || null,
          service: employee.serviceTag?.name || null,
        });
      }
      log.clockInTime = new Date(clockInTime);
      if (clockOutTime) log.clockOutTime = new Date(clockOutTime);
      log.markedBy = 'MANUAL';
      log.notes = [log.notes, notes, `Manually corrected by ${req.user.role} on ${new Date().toLocaleDateString()}.`]
        .filter(Boolean).join(' ');
      await log.save();

      res.json({ success: true, log });
    } catch (error) {
      if (error.code === 11000) return res.status(400).json({ error: 'A record for this employee and date already exists.' });
      console.error('[Attendance/Manual]', error.message);
      res.status(500).json({ error: 'Failed to save manual correction' });
    }
  }
);

module.exports = router;