const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Employee = require('../models/Employee');
const Contractor = require('../models/Contractor');
const WorkLocation = require('../models/WorkLocation');
const { findDuplicateFace } = require('../utils/duplicateFaceCheck');
const { withLock } = require('../utils/mongoLock');
const ml = require('../utils/mlServiceCall');
const { validateNationalId, hashNationalId, last4 } = require('../utils/nationalId');
const { requireKioskDevice } = require('../middleware/kiosk');
const { sitesAtLocation } = require('../utils/siteResolver');
const audit = require('../utils/audit');
const rosterCache = require('../utils/rosterCache');
const { notifyAdmins } = require('../utils/notify');

// Self-registrations land in PENDING_APPROVAL, not straight into the roster.
//
// The kiosk is a public page: without an approval step, anyone who reaches
// the URL can add themselves as an employee and start accumulating paid
// hours. A pending profile cannot clock in (see Employee.matchableFilter)
// until a human in HR confirms the person actually works here — which is
// also precisely the "HR concurrence" the owner asked for.
//
// Registrations created by an authenticated HR/admin user through the
// dashboard are approved immediately; the operator *is* the approval.

// Whether a face may be re-used for a new profile depends on why it collided,
// so the duplicate check reports which case it hit rather than a bare boolean.
function duplicateMessage(duplicate) {
  const { employee } = duplicate;
  if (employee.status === Employee.STATUS.INACTIVE) {
    return {
      status: 409,
      error: `This face matches a former employee profile (${employee.name}, ${employee.employeeId}). ` +
             'Please ask HR to reactivate that profile instead of registering again.',
      code: 'DUPLICATE_FACE_INACTIVE',
    };
  }
  if (employee.status === Employee.STATUS.PENDING) {
    return {
      status: 409,
      error: `You have already registered as ${employee.name} (${employee.employeeId}) and are waiting for HR approval.`,
      code: 'ALREADY_PENDING',
    };
  }
  return {
    status: 409,
    error: `This face is already registered as ${employee.name} (${employee.employeeId}). ` +
           'Each person can only have one attendance profile.',
    code: 'DUPLICATE_FACE',
  };
}

router.post('/',
  requireKioskDevice,
  [
    body('name').notEmpty().trim().isLength({ min: 3, max: 100 }).withMessage('Full name is required'),
    body('phone').matches(/^\d{10}$/).withMessage('Phone must be 10 digits'),
    body('idType').optional().isIn(['AADHAAR', 'VOTER_ID', 'PAN', 'DRIVING_LICENCE', 'OTHER']),
    body('dateOfBirth').isISO8601().withMessage('Valid date of birth required'),
    // The kiosk sends a 2-frame `images` capture (which enables a real
    // liveness check on enrolment, same as clock-in); the dashboard's
    // admin-upload form sends a single `imageBase64` photo, which liveness
    // cannot apply to (no motion data from a static upload) — that path is
    // trusted because it is an authenticated operator action, not a public one.
    body().custom((_, { req }) => {
      const hasImages = Array.isArray(req.body.images) && req.body.images.length > 0;
      const hasSingle = typeof req.body.imageBase64 === 'string' && req.body.imageBase64.length > 0;
      if (!hasImages && !hasSingle) throw new Error('Face image is required');
      return true;
    }),
    body('workLocation').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid site selected'),
    body('shiftTemplate').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid shift selected'),
    body('serviceTag').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid service selected'),
    body('contractor').optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Invalid contractor selected'),
    body('consent').custom(v => v === true || v === 'true').withMessage('Consent to biometric data collection is required to register'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const { name, phone, dateOfBirth, shiftTemplate, serviceTag, contractor } = req.body;
      const idType = req.body.idType || 'AADHAAR';

      // Validate the ID properly rather than only checking its length. A
      // mistyped Aadhaar creates a permanently wrong record *and* — because
      // the ID is the uniqueness key — locks the real owner of that number
      // out of ever registering. Aadhaar carries a Verhoeff check digit
      // specifically so this is detectable.
      const rawId = req.body.nationalId || req.body.aadhaar;
      const idCheck = validateNationalId(rawId, idType);
      if (!idCheck.ok) return res.status(400).json({ error: idCheck.reason, code: 'INVALID_NATIONAL_ID' });

      const nationalIdHash = hashNationalId(idCheck.value);
      const nationalIdLast4 = last4(idCheck.value);

      const frames = Array.isArray(req.body.images) && req.body.images.length > 0
        ? req.body.images
        : (req.body.imageBase64 ? [req.body.imageBase64] : []);

      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database unavailable. Please try again shortly.' });
      }

      // Site resolution. The explicit choice wins: registration happens once,
      // usually with a supervisor standing there, and the person knows which
      // site they were hired for better than a GPS fix taken indoors does.
      //
      // GPS is only a fallback for the phone form, and only when the
      // coordinates land inside exactly one site — an ambiguous fix between
      // two overlapping fences is worse than asking.
      let workLocation = req.body.workLocation || null;
      if (!workLocation) {
        const { latitude, longitude } = req.body;
        if (latitude !== undefined && latitude !== null && longitude !== undefined && longitude !== null) {
          const here = await sitesAtLocation(latitude, longitude);
          if (here.length === 1) workLocation = here[0]._id;
        }
      }

      // Fail closed on the site. Without one, the employee has no geofence
      // and can never be marked late — the two controls that make this
      // system worth having. Previously the kiosk form never collected a
      // site at all, so every self-registration silently had neither.
      if (!workLocation) {
        return res.status(400).json({
          error: 'Please select the site where you work before registering.',
          code: 'SITE_REQUIRED',
        });
      }
      const site = await WorkLocation.findOne({ _id: workLocation, isActive: true }).select('name');
      if (!site) {
        return res.status(400).json({ error: 'That site is not available. Please choose another.', code: 'INVALID_SITE' });
      }

      if (contractor) {
        const contractorDoc = await Contractor.findById(contractor);
        if (contractorDoc && contractorDoc.headcountCap) {
          const currentCount = await Employee.countDocuments({
            contractor,
            status: { $in: [Employee.STATUS.ACTIVE, Employee.STATUS.PENDING] },
          });
          if (currentCount >= contractorDoc.headcountCap) {
            return res.status(400).json({
              error: `${contractorDoc.name} is at its staffing cap (${contractorDoc.headcountCap}). Contact your admin to raise the limit.`,
              code: 'CONTRACTOR_CAP',
            });
          }
        }
      }

      // ID collision. Scoped by status so the message is actionable: a
      // *former* employee's ID must lead to "ask HR to reactivate", not the
      // dead end the previous unscoped check produced — it refused the
      // registration and offered no way forward, so a rejoining employee
      // could never be re-enrolled at all.
      const existingById = await Employee.findOne({ nationalIdHash }).select('name employeeId status');
      if (existingById) {
        if (existingById.status === Employee.STATUS.INACTIVE) {
          return res.status(409).json({
            error: `This ID belongs to a former employee profile (${existingById.name}, ${existingById.employeeId}). ` +
                   'Please ask HR to reactivate it rather than registering again.',
            code: 'ID_BELONGS_TO_INACTIVE',
            employeeId: existingById.employeeId,
          });
        }
        if (existingById.status === Employee.STATUS.PENDING) {
          return res.status(409).json({
            error: 'You have already registered and are waiting for HR approval.',
            code: 'ALREADY_PENDING',
          });
        }
        return res.status(409).json({
          error: 'An employee with this ID number is already registered.',
          code: 'DUPLICATE_ID',
        });
      }

      // Extract the enrolment embedding.
      let faceEmbedding, embeddingModel;
      try {
        ({ embedding: faceEmbedding, model: embeddingModel } = await ml.extractEmbedding(frames[0]));
      } catch (mlErr) {
        if (mlErr && mlErr.isServiceError) {
          return res.status(mlErr.status).json({ error: mlErr.error, code: mlErr.code });
        }
        return res.status(503).json({ error: 'Face recognition service unavailable. Cannot register without biometric data.' });
      }

      // Liveness on enrolment — only possible with 2+ frames, i.e. the
      // kiosk's own capture flow. Without it, someone could enrol a "ghost"
      // identity from a printed photo of a person who has no profile yet;
      // the duplicate-face check below only catches faces that *already*
      // have one, so it does not cover that case.
      if (frames.length >= 2) {
        try {
          const liveness = await ml.checkLiveness(frames);
          if (!liveness || liveness.is_live !== true) {
            const tooDark = Boolean(liveness && liveness.too_dark);
            return res.status(tooDark ? 400 : 403).json({
              error: tooDark
                ? (liveness.details || 'Too dark to scan clearly — please move to better light and try again.')
                : 'Liveness check failed. Please face the camera directly in good lighting and try again.',
              code: tooDark ? 'TOO_DARK' : 'LIVENESS_FAILED',
            });
          }
        } catch (livenessErr) {
          if (livenessErr && livenessErr.isServiceError) {
            return res.status(livenessErr.status).json({ error: livenessErr.error, code: livenessErr.code });
          }
          return res.status(503).json({ error: 'Face recognition service unavailable. Please try again.' });
        }
      }

      // Duplicate-face enrolment is the classic buddy-punching setup: one
      // person holding two profiles so they can clock in twice. The
      // check-then-insert must be serialised, or two concurrent
      // registrations of the same face both pass before either has saved.
      //
      // The lock is now MongoDB-backed rather than in-process — the previous
      // promise-chain mutex only served a single Node process, so any
      // horizontal scale (or a rolling deploy where two instances overlap)
      // reopened exactly the hole it was there to close.
      const createdBy = req.user && req.user.id ? req.user.id : null;
      const selfRegistered = !createdBy;

      let created;
      try {
        created = await withLock('employee-face-enrolment', async () => {
          const duplicate = await findDuplicateFace(faceEmbedding, { embeddingModel });
          if (duplicate) throw { isServiceError: true, ...duplicateMessage(duplicate) };

          const employee = new Employee({
            name,
            phone,
            idType,
            nationalIdHash,
            nationalIdLast4,
            dateOfBirth,
            faceEmbeddings: [faceEmbedding],
            embeddingModel,
            faceEnrolledAt: new Date(),
            faceEnrolledBy: createdBy,
            workLocation,
            shiftTemplate: shiftTemplate || null,
            serviceTag: serviceTag || null,
            contractor: contractor || null,
            consent: {
              consentedAt: new Date(),
              policyVersion: process.env.PRIVACY_POLICY_VERSION || '1.0',
            },
            // An operator-created record is approved by definition; a public
            // self-registration waits for a human.
            status: selfRegistered ? Employee.STATUS.PENDING : Employee.STATUS.ACTIVE,
            approvedBy: selfRegistered ? null : createdBy,
            approvedAt: selfRegistered ? null : new Date(),
          });
          await employee.save();
          return employee;
        }, { ttlMs: 20000, waitMs: 15000 });
      } catch (lockErr) {
        if (lockErr && lockErr.isServiceError) {
          return res.status(lockErr.status).json({ error: lockErr.error, code: lockErr.code });
        }
        if (lockErr && lockErr.code === 'LOCK_TIMEOUT') {
          return res.status(503).json({
            error: 'Too many registrations happening at once. Please wait a moment and try again.',
            code: 'ENROLMENT_BUSY',
          });
        }
        throw lockErr;
      }

      await audit.record(req, {
        action: audit.ACTIONS.EMPLOYEE_REGISTERED,
        targetModel: 'Employee',
        targetId: created._id,
        targetLabel: `${created.name} (${created.employeeId})`,
        after: { status: created.status, workLocation: site.name, selfRegistered },
      });

      // A new enrolment is immediately matchable (pending employees can
      // clock in), so the ML cache needs it now, not at the next restart.
      rosterCache.invalidate('employee registered');

      if (selfRegistered) {
        // HR has to know a profile is waiting, or approvals sit for days and
        // the employee assumes the system is broken.
        notifyAdmins(
          `New employee registration awaiting approval: ${created.name}`,
          [
            `${created.name} (${created.employeeId}) registered at ${site.name} and is waiting for approval.`,
            '',
            'They cannot clock in until approved. Review pending registrations in the dashboard under Employees → Pending.',
          ].join('\n')
        ).catch(() => {});
      }

      return res.status(201).json({
        success: true,
        employeeId: created.employeeId,
        name: created.name,
        status: created.status,
        pendingApproval: selfRegistered,
        message: selfRegistered
          ? `Thanks ${created.name}! Your details are registered as ${created.employeeId}. ` +
            'Your supervisor or HR needs to approve your profile before you can clock in — ' +
            'this usually happens the same day.'
          : `${created.name} registered as ${created.employeeId} and can clock in now.`,
      });

    } catch (error) {
      if (error && error.isServiceError) {
        return res.status(error.status).json({ error: error.error, code: error.code });
      }
      if (error && error.code === 11000) {
        return res.status(409).json({ error: 'An employee with this ID number is already registered.', code: 'DUPLICATE_ID' });
      }
      console.error('[Register]', error.message);
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  }
);

module.exports = router;
