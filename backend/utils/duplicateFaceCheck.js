// Checks a newly-captured face embedding against every already-registered
// employee, using the same cosine-similarity matcher as clock-in recognition.
// This is what stops the classic buddy-punching setup: registering a second
// "ghost" identity using a photo of someone who already has an account.
const axios = require('axios');
const Employee = require('../models/Employee');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Returns the colliding Employee document if this face already matches
// someone registered, or null if it's a genuinely new face.
async function findDuplicateFace(newEmbedding, { excludeEmployeeId } = {}) {
  const filter = { isActive: true, faceEmbedding: { $exists: true, $not: { $size: 0 } } };
  if (excludeEmployeeId) filter._id = { $ne: excludeEmployeeId };

  const existingEmployees = await Employee.find(filter).select('faceEmbedding name employeeId');
  if (existingEmployees.length === 0) return null;

  const candidates = {};
  existingEmployees.forEach(emp => { candidates[emp._id.toString()] = emp.faceEmbedding; });

  const { data } = await axios.post(`${ML_SERVICE_URL}/recognize-face`, { embedding: newEmbedding, candidates }, { timeout: 5000 });
  if (!data.match) return null;

  return existingEmployees.find(emp => emp._id.toString() === data.matched_id) || null;
}

module.exports = { findDuplicateFace };
