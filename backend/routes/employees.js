const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const Employee = require('../models/Employee');
const AttendanceLog = require('../models/AttendanceLog');
const { findDuplicateFace } = require('../utils/duplicateFaceCheck');
const { withLock } = require('../utils/mongoLock');
const ml = require('../utils/mlServiceCall');
const audit = require('../utils/audit');
const rosterCache = require('../utils/rosterCache');
require('../models/WorkLocation');
require('../models/ShiftTemplate');
require('../models/ServiceTag');
require('../models/Contractor');
const auth = require('../middleware/auth');
const { requireAdminOrHr } = auth;

const POPULATE = [
  { path: 'workLocation', select: 'name address' },
  { path: 'shiftTemplate', select: 'name startTime endTime graceMinutes' },
  { path: 'serviceTag', select: 'name' },
  { path: 'contractor', select: 'name' },
];

// Every list response goes through this, so raw embeddings and the ID hash
// can never leak through a route that forgot to exclude them.
function toSafe(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.faceEmbeddings;
  delete obj.nationalIdHash;
  obj.nationalId = `XXXX-XXXX-${obj.nationalIdLast4 || '????'}`;
  obj.hasBiometrics = Array.isArray(doc.faceEmbeddings) && doc.faceEmbeddings.length > 0;
  return obj;
}

// GET /api/v1/employees
// Paginated and searchable. The previous version returned the entire roster
// with five populate() calls and no limit, which gets slow and eventually
// times out as headcount grows — and gave the UI no total to page against.
router.get('/', auth,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    query('status').optional().isIn(['ACTIVE', 'PENDING_APPROVAL', 'INACTIVE', 'REJECTED', 'ALL']),
    query('workLocation').optional().isMongoId(),
    query('search').optional().isString().trim().isLength({ max: 100 }),
    query('unassignedOnly').optional().isBoolean().toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const page = req.query.page || 1;
      const limit = req.query.limit || 50;
      const status = req.query.status || 'ACTIVE';

      const filter = {};
      if (status !== 'ALL') filter.status = status;

      // Supervisors only ever see their own site's roster.
      if (req.user.role === 'supervisor' && req.user.workLocation) {
        filter.workLocation = req.user.workLocation;
      } else if (req.query.workLocation) {
        filter.workLocation = req.query.workLocation;
      }

      // Surfaces the employees whose setup is incomplete — the ones who would
      // otherwise sit with no site or shift and therefore no geofence and no
      // late detection, invisibly.
      if (req.query.unassignedOnly) {
        filter.$or = [{ workLocation: null }, { shiftTemplate: null }];
      }

      if (req.query.search) {
        const safe = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(safe, 'i');
        const searchClause = [{ name: rx }, { employeeId: rx }, { phone: rx }];
        // Combine with an existing $or rather than clobbering it.
        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, { $or: searchClause }];
          delete filter.$or;
        } else {
          filter.$or = searchClause;
        }
      }

      const [employees, total] = await Promise.all([
        Employee.find(filter)
          .populate(POPULATE)
          .select('-faceEmbeddings -nationalIdHash')
          .sort({ name: 1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Employee.countDocuments(filter),
      ]);

      res.json({
        employees: employees.map(toSafe),
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (error) {
      console.error('[Employees/GET]', error.message);
      res.status(500).json({ error: 'Failed to fetch employees' });
    }
  }
);

// GET /api/v1/employees/counts — badge numbers for the dashboard, so the
// "needs attention" states are visible rather than something HR has to
// remember to go looking for.
router.get('/counts', auth, async (req, res) => {
  try {
    const scope = {};
    if (req.user.role === 'supervisor' && req.user.workLocation) scope.workLocation = req.user.workLocation;

    const [active, pending, inactive, unassigned, noBiometrics] = await Promise.all([
      Employee.countDocuments({ ...scope, status: Employee.STATUS.ACTIVE }),
      Employee.countDocuments({ ...scope, status: Employee.STATUS.PENDING }),
      Employee.countDocuments({ ...scope, status: Employee.STATUS.INACTIVE }),
      Employee.countDocuments({
        ...scope,
        status: Employee.STATUS.ACTIVE,
        $or: [{ workLocation: null }, { shiftTemplate: null }],
      }),
      Employee.countDocuments({
        ...scope,
        status: Employee.STATUS.ACTIVE,
        $or: [{ faceEmbeddings: { $size: 0 } }, { faceEmbeddings: { $exists: false } }],
      }),
    ]);

    res.json({ active, pending, inactive, unassigned, noBiometrics });
  } catch (error) {
    console.error('[Employees/counts]', error.message);
    res.status(500).json({ error: 'Failed to fetch employee counts' });
  }
});

// GET /api/v1/employees/:id
router.get('/:id', auth,
  [param('id').isMongoId().withMessage('Invalid employee ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findById(req.params.id)
        .populate('workLocation', 'name address latitude longitude radiusMeters shiftStart shiftEnd')
        .populate('shiftTemplate')
        .populate('serviceTag', 'name')
        .populate('contractor', 'name')
        .select('-nationalIdHash');
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      if (req.user.role === 'supervisor' && String(employee.workLocation?._id) !== String(req.user.workLocation)) {
        return res.status(403).json({ error: 'Not authorized to view this employee.' });
      }
      res.json(toSafe(employee));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch employee' });
    }
  }
);

// PUT /api/v1/employees/:id
router.put('/:id', auth,
  [
    param('id').isMongoId().withMessage('Invalid employee ID'),
    // Mongoose's required:true doesn't reject an empty string, only
    // null/undefined — without this, a PUT with name:"" would blank out an
    // employee's name with no server-side rejection.
    body('name').optional().notEmpty().withMessage('Name cannot be empty').trim(),
    body('workLocation').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid work location ID'),
    body('shiftTemplate').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid shift template ID'),
    body('serviceTag').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid service ID'),
    body('contractor').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid contractor ID'),
    body('phone').optional().matches(/^\d{10}$/).withMessage('Phone must be 10 digits'),
    body('weeklyOff').optional().isArray().withMessage('weeklyOff must be an array of day numbers'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const existing = await Employee.findById(req.params.id).select(
        'name workLocation shiftTemplate serviceTag contractor phone weeklyOff status employeeId'
      );
      if (!existing) return res.status(404).json({ error: 'Employee not found' });

      // Mirrors the scope check GET /:id has — without it a supervisor could
      // edit any employee at any site just by knowing the ID.
      if (req.user.role === 'supervisor' && String(existing.workLocation) !== String(req.user.workLocation)) {
        return res.status(403).json({ error: 'Not authorized to edit this employee.' });
      }

      // Supervisors can't reassign someone to another site or touch billing fields.
      const allowedFields = req.user.role === 'supervisor'
        ? ['name', 'shiftTemplate']
        : ['name', 'workLocation', 'shiftTemplate', 'serviceTag', 'contractor', 'phone', 'weeklyOff'];
      const updates = {};
      allowedFields.forEach(field => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });

      // Clearing the site on an active employee would silently switch off
      // their geofence and their late detection, so it's refused rather than
      // quietly accepted.
      if ('workLocation' in updates && !updates.workLocation && existing.status === Employee.STATUS.ACTIVE) {
        return res.status(400).json({
          error: 'An active employee must be assigned to a site. Deactivate them instead if they no longer work here.',
          code: 'SITE_REQUIRED',
        });
      }

      const employee = await Employee.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
        .populate(POPULATE)
        .select('-faceEmbeddings -nationalIdHash');

      const changes = audit.diff(existing, updates, allowedFields);
      if (changes) {
        await audit.record(req, {
          action: audit.ACTIONS.EMPLOYEE_UPDATED,
          targetModel: 'Employee',
          targetId: employee._id,
          targetLabel: `${employee.name} (${employee.employeeId})`,
          ...changes,
        });
      }

      // Reassigning someone to a different site changes which site's roster
      // they're matched against at a kiosk, so the ML cache's per-site index
      // has to be rebuilt. Other field edits don't affect matching.
      if (changes && 'workLocation' in (changes.after || {})) {
        rosterCache.invalidate('employee reassigned to a different site');
      }

      res.json({ success: true, employee: toSafe(employee) });
    } catch (error) {
      console.error('[Employees/PUT]', error.message);
      res.status(500).json({ error: 'Failed to update employee' });
    }
  }
);

// POST /api/v1/employees/:id/approve — let a pending self-registration in.
router.post('/:id/approve', auth, requireAdminOrHr,
  [
    param('id').isMongoId(),
    body('workLocation').optional({ nullable: true, checkFalsy: true }).isMongoId(),
    body('shiftTemplate').optional({ nullable: true, checkFalsy: true }).isMongoId(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findById(req.params.id);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      if (employee.status === Employee.STATUS.ACTIVE) {
        return res.status(400).json({ error: 'This employee is already active.' });
      }

      // Approval is the moment to complete the setup, so the site and shift
      // are settled here rather than left for someone to remember later.
      if (req.body.workLocation) employee.workLocation = req.body.workLocation;
      if (req.body.shiftTemplate) employee.shiftTemplate = req.body.shiftTemplate;
      if (!employee.workLocation) {
        return res.status(400).json({
          error: 'Assign a work site before approving — without one this employee has no location check.',
          code: 'SITE_REQUIRED',
        });
      }
      if (!employee.hasBiometrics()) {
        return res.status(400).json({
          error: 'This profile has no face data enrolled. Ask the employee to scan at the kiosk, or re-enrol from this page.',
          code: 'NO_BIOMETRICS',
        });
      }

      const previousStatus = employee.status;
      employee.status = Employee.STATUS.ACTIVE;
      employee.approvedBy = req.user.id;
      employee.approvedAt = new Date();
      employee.rejectionReason = null;
      await employee.save();

      await audit.record(req, {
        action: audit.ACTIONS.EMPLOYEE_APPROVED,
        targetModel: 'Employee',
        targetId: employee._id,
        targetLabel: `${employee.name} (${employee.employeeId})`,
        before: { status: previousStatus },
        after: { status: employee.status, workLocation: String(employee.workLocation) },
      });

      // The set of people who can be matched just changed — push it to the
      // ML service's resident cache. Fire-and-forget; a scan that sees a
      // stale version resyncs on its own.
      rosterCache.invalidate('employee approved');

      res.json({ success: true, message: `${employee.name} approved and can now clock in.` });
    } catch (error) {
      console.error('[Employees/approve]', error.message);
      res.status(500).json({ error: 'Failed to approve employee' });
    }
  }
);

// POST /api/v1/employees/:id/reject
router.post('/:id/reject', auth, requireAdminOrHr,
  [param('id').isMongoId(), body('reason').notEmpty().trim().withMessage('A reason is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findById(req.params.id);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      const previousStatus = employee.status;
      employee.status = Employee.STATUS.REJECTED;
      employee.rejectionReason = req.body.reason;
      // A rejected registration has no basis for retaining biometric data.
      employee.faceEmbeddings = [];
      employee.biometricsErasedAt = new Date();
      await employee.save();

      await audit.record(req, {
        action: audit.ACTIONS.EMPLOYEE_REJECTED,
        targetModel: 'Employee',
        targetId: employee._id,
        targetLabel: `${employee.name} (${employee.employeeId})`,
        before: { status: previousStatus },
        after: { status: employee.status },
        reason: req.body.reason,
      });

      // The set of people who can be matched just changed — push it to the
      // ML service's resident cache. Fire-and-forget; a scan that sees a
      // stale version resyncs on its own.
      rosterCache.invalidate('employee rejected');

      res.json({ success: true, message: 'Registration rejected and biometric data erased.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to reject registration' });
    }
  }
);

// POST /api/v1/employees/:id/reactivate — rehire.
//
// Previously impossible: the registration duplicate check ignored status, so a
// deactivated profile still owned that ID number and the returning employee
// was refused with no route forward.
router.post('/:id/reactivate', auth, requireAdminOrHr,
  [param('id').isMongoId(), body('workLocation').optional({ nullable: true, checkFalsy: true }).isMongoId()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findById(req.params.id);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      if (employee.status === Employee.STATUS.ACTIVE) {
        return res.status(400).json({ error: 'This employee is already active.' });
      }

      if (req.body.workLocation) employee.workLocation = req.body.workLocation;
      if (!employee.workLocation) {
        return res.status(400).json({ error: 'Assign a work site before reactivating.', code: 'SITE_REQUIRED' });
      }

      const previousStatus = employee.status;
      employee.status = Employee.STATUS.ACTIVE;
      employee.deactivatedAt = null;
      employee.approvedBy = req.user.id;
      employee.approvedAt = new Date();
      await employee.save();

      await audit.record(req, {
        action: audit.ACTIONS.EMPLOYEE_REACTIVATED,
        targetModel: 'Employee',
        targetId: employee._id,
        targetLabel: `${employee.name} (${employee.employeeId})`,
        before: { status: previousStatus },
        after: { status: employee.status },
      });

      // The set of people who can be matched just changed — push it to the
      // ML service's resident cache. Fire-and-forget; a scan that sees a
      // stale version resyncs on its own.
      rosterCache.invalidate('employee reactivated');

      // Biometrics may have been erased under the retention policy while they
      // were away, so say plainly whether a re-scan is needed.
      res.json({
        success: true,
        needsFaceReenrolment: !employee.hasBiometrics(),
        message: employee.hasBiometrics()
          ? `${employee.name} reactivated and can clock in.`
          : `${employee.name} reactivated, but their face data was erased. Re-enrol their face before they can clock in.`,
      });
    } catch (error) {
      console.error('[Employees/reactivate]', error.message);
      res.status(500).json({ error: 'Failed to reactivate employee' });
    }
  }
);

// POST /api/v1/employees/:id/reenroll-face
//
// There was previously no way to update anyone's face at all: the PUT
// whitelist excluded the embedding, and deactivate-then-re-register was
// blocked by the ID uniqueness check. An employee whose recognition degraded
// — a beard, weight change, or simply a poor original capture — was
// permanently unable to clock in with no path back.
router.post('/:id/reenroll-face', auth, requireAdminOrHr,
  [
    param('id').isMongoId(),
    body('replace').optional().isBoolean().toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findById(req.params.id);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      const frames = Array.isArray(req.body.images) && req.body.images.length > 0
        ? req.body.images
        : (req.body.imageBase64 ? [req.body.imageBase64] : []);
      if (frames.length === 0) return res.status(400).json({ error: 'A face image is required' });

      let embedding, embeddingModel;
      try {
        ({ embedding, model: embeddingModel } = await ml.extractEmbedding(frames[0]));
      } catch (mlErr) {
        if (mlErr && mlErr.isServiceError) return res.status(mlErr.status).json({ error: mlErr.error, code: mlErr.code });
        throw mlErr;
      }

      if (frames.length >= 2) {
        const liveness = await ml.checkLiveness(frames);
        if (!liveness || liveness.is_live !== true) {
          const tooDark = Boolean(liveness && liveness.too_dark);
          return res.status(tooDark ? 400 : 403).json({
            error: tooDark
              ? (liveness.details || 'Too dark to capture clearly — please improve the lighting.')
              : 'Liveness check failed. Capture a live face, not a photo.',
            code: tooDark ? 'TOO_DARK' : 'LIVENESS_FAILED',
          });
        }
      }

      // Excluding this employee is essential — without it they always collide
      // with their own existing enrolment and re-enrolment is impossible.
      // (`excludeEmployeeId` existed in the duplicate checker all along and
      // was never wired up to anything.)
      const result = await withLock('employee-face-enrolment', async () => {
        const duplicate = await findDuplicateFace(embedding, { excludeEmployeeId: employee._id, embeddingModel });
        if (duplicate) {
          throw {
            isServiceError: true,
            status: 409,
            error: `That face already belongs to ${duplicate.employee.name} (${duplicate.employee.employeeId}).`,
            code: 'DUPLICATE_FACE',
          };
        }

        const before = employee.faceEmbeddings.length;
        // Never append a vector from a different model to an existing set —
        // best-of matching across incompatible spaces is meaningless. A model
        // change forces a clean replace.
        const modelChanged = employee.embeddingModel && employee.embeddingModel !== embeddingModel;
        if (req.body.replace || modelChanged) {
          employee.faceEmbeddings = [embedding];
        } else {
          // Keep up to 5 captures per person: different angles and lighting
          // make matching markedly more reliable, and one bad capture stops
          // being fatal. Oldest is dropped first.
          employee.faceEmbeddings = [...employee.faceEmbeddings, embedding].slice(-5);
        }
        employee.embeddingModel = embeddingModel;
        employee.faceEnrolledAt = new Date();
        employee.faceEnrolledBy = req.user.id;
        employee.biometricsErasedAt = null;
        await employee.save();
        return { before, after: employee.faceEmbeddings.length };
      }, { ttlMs: 20000, waitMs: 15000 });

      await audit.record(req, {
        action: audit.ACTIONS.EMPLOYEE_FACE_REENROLLED,
        targetModel: 'Employee',
        targetId: employee._id,
        targetLabel: `${employee.name} (${employee.employeeId})`,
        before: { enrolledCaptures: result.before },
        after: { enrolledCaptures: result.after, replaced: Boolean(req.body.replace) },
      });

      // The set of people who can be matched just changed — push it to the
      // ML service's resident cache. Fire-and-forget; a scan that sees a
      // stale version resyncs on its own.
      rosterCache.invalidate('face re-enrolled');

      res.json({
        success: true,
        enrolledCaptures: result.after,
        message: `Face re-enrolled for ${employee.name}. ${result.after} capture(s) now stored.`,
      });
    } catch (error) {
      if (error && error.isServiceError) return res.status(error.status).json({ error: error.error, code: error.code });
      console.error('[Employees/reenroll]', error.message);
      res.status(500).json({ error: 'Failed to re-enrol face' });
    }
  }
);

// DELETE /api/v1/employees/:id/biometrics
//
// Erases the face data while keeping attendance history for payroll. Required
// to answer a data-deletion request under the DPDP Act, and used by the
// retention job for long-inactive employees.
router.delete('/:id/biometrics', auth, requireAdminOrHr,
  [param('id').isMongoId(), body('reason').optional().isString().trim()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findById(req.params.id);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      const had = employee.faceEmbeddings.length;
      employee.faceEmbeddings = [];
      employee.biometricsErasedAt = new Date();
      employee.consent.withdrawnAt = new Date();
      await employee.save();

      await audit.record(req, {
        action: audit.ACTIONS.EMPLOYEE_BIOMETRICS_ERASED,
        targetModel: 'Employee',
        targetId: employee._id,
        targetLabel: `${employee.name} (${employee.employeeId})`,
        before: { enrolledCaptures: had },
        after: { enrolledCaptures: 0 },
        reason: req.body.reason || 'Manual erasure',
      });

      // The set of people who can be matched just changed — push it to the
      // ML service's resident cache. Fire-and-forget; a scan that sees a
      // stale version resyncs on its own.
      rosterCache.invalidate('biometrics erased');

      res.json({
        success: true,
        message: `Face data erased for ${employee.name}. Attendance history is retained for payroll. ` +
                 'They cannot clock in until re-enrolled.',
      });
    } catch (error) {
      console.error('[Employees/biometrics DELETE]', error.message);
      res.status(500).json({ error: 'Failed to erase biometric data' });
    }
  }
);

// DELETE /api/v1/employees/:id — deactivate (admin/HR only, not supervisors)
router.delete('/:id', auth,
  [param('id').isMongoId().withMessage('Invalid employee ID'), body('reason').optional().isString().trim()],
  async (req, res) => {
    if (req.user.role === 'supervisor') {
      return res.status(403).json({ error: 'Only admins or HR can deactivate employees.' });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const employee = await Employee.findById(req.params.id);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      // Leaving a session open forever would keep accruing on the dashboard
      // as "still clocked in" for someone who has left.
      const openSessions = await AttendanceLog.countDocuments({ employee: employee._id, clockOutTime: null });

      const previousStatus = employee.status;
      employee.status = Employee.STATUS.INACTIVE;
      employee.deactivatedAt = new Date();
      await employee.save();

      await audit.record(req, {
        action: audit.ACTIONS.EMPLOYEE_DEACTIVATED,
        targetModel: 'Employee',
        targetId: employee._id,
        targetLabel: `${employee.name} (${employee.employeeId})`,
        before: { status: previousStatus },
        after: { status: employee.status },
        reason: req.body.reason || null,
      });

      // The set of people who can be matched just changed — push it to the
      // ML service's resident cache. Fire-and-forget; a scan that sees a
      // stale version resyncs on its own.
      rosterCache.invalidate('employee deactivated');

      res.json({
        success: true,
        openSessions,
        message: openSessions > 0
          ? `Employee deactivated. Note: ${openSessions} attendance session(s) are still open and will be auto-closed.`
          : 'Employee deactivated successfully.',
      });
    } catch (error) {
      console.error('[Employees/DELETE]', error.message);
      res.status(500).json({ error: 'Failed to deactivate employee' });
    }
  }
);

module.exports = router;
