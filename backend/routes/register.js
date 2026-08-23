const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Employee = require('../models/Employee');
const Contractor = require('../models/Contractor');
const { findDuplicateFace } = require('../utils/duplicateFaceCheck');
const { withLock } = require('../utils/asyncMutex');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';


// POST /api/v1/register — New employee self-registration via scanner app
router.post('/',
  [
    body('name').notEmpty().trim().withMessage('Full name is required'),
    body('phone').matches(/^\d{10}$/).withMessage('Phone must be 10 digits'),
    body('nationalId').custom((val, { req }) => {
      const id = val || req.body.aadhaar;
      if (!id || !/^\d{12}$/.test(id)) throw new Error('Aadhaar number must be 12 digits');
      return true;
    }),
    body('dateOfBirth').isISO8601().withMessage('Valid date of birth required'),
    // The kiosk sends a 2-frame `images` capture (enables a real liveness
    // check on enrollment, same as clock-in); the dashboard's admin-upload
    // form sends a single `imageBase64` photo, which liveness can't apply
    // to (no motion data from a static upload) — that path is trusted
    // because it's an authenticated operator action, not a public one.
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
      const { name, phone, dateOfBirth, workLocation, shiftTemplate, serviceTag, contractor } = req.body;
      const nationalId = req.body.nationalId || req.body.aadhaar;
      // Kiosk sends `images` (2 frames, enables liveness below); dashboard's
      // admin photo-upload sends a single `imageBase64` (no motion data
      // possible, so no liveness check applies to that trusted path).
      const frames = Array.isArray(req.body.images) && req.body.images.length > 0
        ? req.body.images
        : (req.body.imageBase64 ? [req.body.imageBase64] : []);

      if (mongoose.connection.readyState === 1 && contractor) {
        const contractorDoc = await Contractor.findById(contractor);
        if (contractorDoc && contractorDoc.headcountCap) {
          const currentCount = await Employee.countDocuments({ contractor, isActive: true });
          if (currentCount >= contractorDoc.headcountCap) {
            return res.status(400).json({
              error: `${contractorDoc.name} is at its staffing cap (${contractorDoc.headcountCap}). Contact your admin to raise the limit.`
            });
          }
        }
      }

      if (mongoose.connection.readyState === 1) {
        const existing = await Employee.findOne({ $or: [{ phone }, { nationalId }] });
        if (existing) {
          return res.status(400).json({ error: 'An employee with this phone or Aadhaar number already exists.' });
        }
      }

      let faceEmbedding = [];
      try {
        const mlRes = await axios.post(`${ML_SERVICE_URL}/extract-embedding`, { image: frames[0] }, { timeout: 5000 });
        faceEmbedding = mlRes.data.embedding || [];
        if (!mlRes.data.face_detected || faceEmbedding.length === 0) {
          return res.status(400).json({ error: 'No face detected in the image. Please align face clearly.' });
        }
      } catch (mlErr) {
        if (mlErr.response && mlErr.response.status === 422) {
          return res.status(400).json({ error: mlErr.response.data?.detail || 'No face detected in the image. Please align your face clearly in good lighting.' });
        }
        return res.status(503).json({ error: 'Face recognition service unavailable. Cannot register without biometric data.' });
      }

      // Liveness check — only possible (and only run) when 2+ frames came
      // in, i.e. the kiosk's own capture flow. Without this, someone could
      // enroll a "ghost" identity from a printed photo of a person who
      // isn't registered yet — the duplicate-face check below only catches
      // faces that already have a profile, so it doesn't cover this case.
      if (frames.length >= 2) {
        try {
          const livenessRes = await axios.post(`${ML_SERVICE_URL}/liveness-check`, { images: frames }, { timeout: 4000 });
          if (!livenessRes.data || livenessRes.data.is_live !== true) {
            return res.status(403).json({ error: 'Liveness check failed. Please face the camera directly in good lighting and try again.' });
          }
        } catch (livenessErr) {
          return res.status(503).json({ error: 'Face recognition service unavailable. Please try again.' });
        }
      }

      // Block duplicate enrollment — the same face registering under a second
      // identity is the classic buddy-punching setup (one person clocks in
      // for two "employees"). The check-then-insert has to be serialized
      // (see utils/asyncMutex.js) — otherwise two concurrent registrations
      // for the same face can both pass the check before either has saved.
      let employeeId = null;
      if (mongoose.connection.readyState === 1) {
        employeeId = await withLock(async () => {
          try {
            const duplicate = await findDuplicateFace(faceEmbedding);
            if (duplicate) {
              throw { status: 409, error: `This face is already registered as ${duplicate.name} (${duplicate.employeeId}). Each person can only have one attendance profile.` };
            }
          } catch (dupErr) {
            // Same fix as identifyAndVerify.js — don't let a raw axios
            // error (which also carries a `.status` property in newer
            // axios versions) get mistaken for one of our own throws.
            if (dupErr.status && !dupErr.isAxiosError) throw dupErr;
            console.error('[Register] Duplicate-face check failed:', dupErr.message);
            throw { status: 503, error: 'Face verification service unavailable. Please try again.' };
          }

          const newEmployee = new Employee({
            name,
            phone,
            nationalId,
            dateOfBirth,
            faceEmbedding,
            workLocation: workLocation || null,
            shiftTemplate: shiftTemplate || null,
            serviceTag: serviceTag || null,
            contractor: contractor || null,
            consent: { consentedAt: new Date() },
          });
          await newEmployee.save();
          return newEmployee.employeeId; // real, atomically-assigned ID — matches what's stored
        });
      }

      res.status(201).json({
        success: true,
        employeeId,
        name: name,
        message: `Welcome ${name}! Your biometric profile has been registered. You can now clock in.`
      });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ error: error.error });
      }
      if (error.code === 11000) {
        return res.status(400).json({ error: 'Phone or Aadhaar number already registered.' });
      }
      console.error('[Register]', error.message);
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  }
);

module.exports = router;
