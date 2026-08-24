const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, param, query, validationResult } = require('express-validator');
const LeaveRequest = require('../models/LeaveRequest');
const Employee = require('../models/Employee');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;
const audit = require('../utils/audit');
const { identifyAndVerify } = require('../utils/identifyAndVerify');
const { businessDate, DEFAULT_TZ } = require('../utils/tz');
const { requireKioskDevice } = require('../middleware/kiosk');
const { notifyAdmins } = require('../utils/notify');

// POST /api/v1/leave — kiosk-facing: employee applies for leave via face ID,
// same authentication model as Report an Issue.
router.post('/',
  requireKioskDevice,
  [
    body('leaveType').isIn(LeaveRequest.LEAVE_TYPES).withMessage('Invalid leave type'),
    body('fromDate').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('fromDate must be YYYY-MM-DD'),
    body('toDate').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('toDate must be YYYY-MM-DD'),
    body('reason').notEmpty().trim().isLength({ max: 500 }).withMessage('Please give a reason'),
    body('isHalfDay').optional().isBoolean().toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const { images, image, leaveType, fromDate, toDate, reason, isHalfDay } = req.body;
      const frames = Array.isArray(images) ? images : (image ? [image] : []);
      if (frames.length === 0) return res.status(400).json({ error: 'Face image is required to identify you' });
      if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Database unavailable' });

      if (toDate < fromDate) {
        return res.status(400).json({ error: 'To date cannot be before the from date.' });
      }

      const { matchedEmployee } = await identifyAndVerify(frames, 'CLOCK_IN', {
        workLocationId: req.kioskSiteId || null,
      });

      const request = new LeaveRequest({
        employee: matchedEmployee._id,
        leaveType, fromDate, toDate, reason,
        isHalfDay: Boolean(isHalfDay),
        source: 'KIOSK',
      });
      await request.save();

      notifyAdmins(
        `Leave request: ${matchedEmployee.name} (${fromDate} to ${toDate})`,
        `${matchedEmployee.name} (${matchedEmployee.employeeId}) requested ${leaveType} leave from ${fromDate} to ${toDate}.\nReason: ${reason}`
      ).catch(() => {});

      res.status(201).json({
        success: true,
        employeeName: matchedEmployee.name,
        message: `Thanks ${matchedEmployee.name}, your leave request has been sent for approval.`,
      });
    } catch (error) {
      if (error && error.isServiceError) return res.status(error.status).json({ error: error.error, code: error.code });
      console.error('[Leave/POST]', error.message);
      res.status(500).json({ error: 'Failed to submit leave request' });
    }
  }
);

// POST /api/v1/leave/dashboard — HR/admin enters leave directly (e.g. a
// phoned-in request), approved on creation since an operator entered it.
router.post('/dashboard', auth, requireAdminOrHr,
  [
    body('employeeId').isMongoId(),
    body('leaveType').isIn(LeaveRequest.LEAVE_TYPES),
    body('fromDate').matches(/^\d{4}-\d{2}-\d{2}$/),
    body('toDate').matches(/^\d{4}-\d{2}-\d{2}$/),
    body('reason').notEmpty().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findById(req.body.employeeId).select('name employeeId');
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      if (req.body.toDate < req.body.fromDate) {
        return res.status(400).json({ error: 'To date cannot be before the from date.' });
      }

      const request = new LeaveRequest({
        employee: employee._id,
        leaveType: req.body.leaveType,
        fromDate: req.body.fromDate,
        toDate: req.body.toDate,
        reason: req.body.reason,
        source: 'DASHBOARD',
        status: 'APPROVED',
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
        reviewNote: 'Entered and approved directly by HR.',
      });
      await request.save();

      await audit.record(req, {
        action: audit.ACTIONS.LEAVE_REVIEWED,
        targetModel: 'LeaveRequest',
        targetId: request._id,
        targetLabel: `${employee.name} (${employee.employeeId}) ${req.body.fromDate}..${req.body.toDate}`,
        after: { status: 'APPROVED', source: 'DASHBOARD' },
      });

      res.status(201).json({ success: true, request });
    } catch (error) {
      console.error('[Leave/Dashboard]', error.message);
      res.status(500).json({ error: 'Failed to create leave request' });
    }
  }
);

// GET /api/v1/leave
router.get('/', auth,
  [query('status').optional().isIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])],
  async (req, res) => {
    try {
      const filter = {};
      if (req.query.status) filter.status = req.query.status;

      if (req.user.role === 'supervisor' && req.user.workLocation) {
        const ids = await Employee.find({ workLocation: req.user.workLocation }).select('_id');
        filter.employee = { $in: ids.map(e => e._id) };
      }

      const requests = await LeaveRequest.find(filter)
        .populate('employee', 'name employeeId workLocation')
        .populate('reviewedBy', 'name')
        .sort({ createdAt: -1 });
      res.json(requests);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch leave requests' });
    }
  }
);

// PUT /api/v1/leave/:id — approve/reject
router.put('/:id', auth, requireAdminOrHr,
  [
    param('id').isMongoId(),
    body('status').isIn(['APPROVED', 'REJECTED']),
    body('reviewNote').optional().isString().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const request = await LeaveRequest.findById(req.params.id).populate('employee', 'name employeeId');
      if (!request) return res.status(404).json({ error: 'Request not found' });
      if (request.status !== 'PENDING') {
        return res.status(400).json({ error: `This request was already ${request.status.toLowerCase()}.` });
      }

      request.status = req.body.status;
      request.reviewNote = req.body.reviewNote || '';
      request.reviewedBy = req.user.id;
      request.reviewedAt = new Date();
      await request.save();

      await audit.record(req, {
        action: audit.ACTIONS.LEAVE_REVIEWED,
        targetModel: 'LeaveRequest',
        targetId: request._id,
        targetLabel: `${request.employee.name} (${request.employee.employeeId}) ${request.fromDate}..${request.toDate}`,
        after: { status: request.status },
        reason: req.body.reviewNote || null,
      });

      res.json({ success: true, request });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update leave request' });
    }
  }
);

// DELETE /api/v1/leave/:id — cancel a still-pending request (own or, for
// admin/HR, anyone's).
router.delete('/:id', auth,
  [param('id').isMongoId()],
  async (req, res) => {
    try {
      const request = await LeaveRequest.findById(req.params.id);
      if (!request) return res.status(404).json({ error: 'Request not found' });
      if (request.status !== 'PENDING') {
        return res.status(400).json({ error: 'Only a pending request can be cancelled.' });
      }
      request.status = 'CANCELLED';
      await request.save();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to cancel leave request' });
    }
  }
);

module.exports = router;
