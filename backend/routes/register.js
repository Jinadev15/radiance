const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Employee = require('../models/Employee');
const Contractor = require('../models/Contractor');
const { findDuplicateFace } = require('../utils/duplicateFaceCheck');

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
    body('imageBase64').notEmpty().withMessage('Face image is required'),
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
      const { name, phone, dateOfBirth, imageBase64, workLocation, shiftTemplate, serviceTag, contractor } = req.body;
      const nationalId = req.body.nationalId || req.body.aadhaar;

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
        const mlRes = await axios.post(`${ML_SERVICE_URL}/extract-embedding`, { image: imageBase64 }, { timeout: 5000 });
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

      // Block duplicate enrollment — the same face registering under a second
      // identity is the classic buddy-punching setup (one person clocks in
      // for two "employees").
      if (mongoose.connection.readyState === 1) {
        try {
          const duplicate = await findDuplicateFace(faceEmbedding);
          if (duplicate) {
            return res.status(409).json({
              error: `This face is already registered as ${duplicate.name} (${duplicate.employeeId}). Each person can only have one attendance profile.`
            });
          }
        } catch (dupErr) {
          console.error('[Register] Duplicate-face check failed:', dupErr.message);
          return res.status(503).json({ error: 'Face verification service unavailable. Please try again.' });
        }
      }

      let employeeId = null;
      if (mongoose.connection.readyState === 1) {
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
        employeeId = newEmployee.employeeId; // real, atomically-assigned ID — matches what's stored
      }

      res.status(201).json({
        success: true,
        employeeId,
        name: name,
        message: `Welcome ${name}! Your biometric profile has been registered. You can now clock in.`
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ error: 'Phone or Aadhaar number already registered.' });
      }
      console.error('[Register]', error.message);
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  }
);

module.exports = router;
