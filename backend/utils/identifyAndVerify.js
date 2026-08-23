// Shared identify-then-verify pipeline for clock-in and clock-out. Order
// matters: we identify who the face might be *before* checking liveness, so
// a failed liveness check can be logged against the identity it targeted
// (SpoofAttemptLog) instead of being an anonymous, useless data point.
const axios = require('axios');
const Employee = require('../models/Employee');
const SpoofAttemptLog = require('../models/SpoofAttemptLog');
const { notifyAdmins } = require('./notify');
// Registers the models .populate('workLocation'|'shiftTemplate'|'serviceTag') needs.
require('../models/WorkLocation');
require('../models/ShiftTemplate');
require('../models/ServiceTag');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Throws a { status, error } object on any failure so routes can respond
// directly from the catch block without re-deriving status codes.
// Minimum frames required to run the real anti-spoof check. The ML
// service's motion-detection (the check that actually distinguishes a live
// face from a held-up printed photo) only runs when it receives 2+ frames —
// with fewer than that, only the much weaker per-frame texture/glare
// heuristic applies. Since these endpoints are unauthenticated, a direct
// API caller (not just the kiosk app) could otherwise submit a single
// frame and skip the real check entirely; this is enforced server-side so
// the client can't opt out of it.
const MIN_LIVENESS_FRAMES = 2;

async function identifyAndVerify(images, action) {
  if (!images || images.length === 0) {
    throw { status: 400, error: 'Face image is required' };
  }
  if (images.length < MIN_LIVENESS_FRAMES) {
    throw { status: 400, error: 'At least two frames are required to verify liveness. Please try scanning again.' };
  }

  // 1. Extract embedding from the first frame
  let embedding;
  try {
    const extractRes = await axios.post(`${ML_SERVICE_URL}/extract-embedding`, { image: images[0] }, { timeout: 5000 });
    embedding = extractRes.data.embedding;
    if (!extractRes.data.face_detected || !embedding) {
      throw { status: 400, error: 'No face detected in the image.' };
    }
  } catch (err) {
    // Distinguish "one of our own already-formed { status, error } throws"
    // from a raw axios error — newer axios versions add a `.status`
    // shortcut property directly onto AxiosError, which made this check
    // (originally just `if (err.status)`) accidentally match real axios
    // errors too, letting them leak through unpacked instead of being
    // translated below. `isAxiosError` is the reliable discriminator axios
    // itself sets on every error it throws.
    if (err.status && !err.isAxiosError) throw err;
    if (err.response && err.response.status === 422) {
      throw { status: 400, error: err.response.data?.detail || 'No face detected in the image. Please align face clearly.' };
    }
    throw { status: 503, error: 'Face recognition service unavailable' };
  }

  // 2. Load candidates
  const employees = await Employee.find({ isActive: true, faceEmbedding: { $exists: true, $not: { $size: 0 } } })
    .populate('workLocation')
    .populate('shiftTemplate')
    .populate('serviceTag');
  if (employees.length === 0) {
    throw { status: 404, error: 'No registered employees found. Please register first.' };
  }
  const candidates = {};
  employees.forEach(emp => { candidates[emp._id.toString()] = emp.faceEmbedding; });

  // 3. Recognize
  let matchResult;
  try {
    const recognizeRes = await axios.post(`${ML_SERVICE_URL}/recognize-face`, { embedding, candidates }, { timeout: 5000 });
    matchResult = recognizeRes.data;
  } catch (err) {
    throw { status: 503, error: 'Face recognition service unavailable' };
  }
  if (!matchResult || !matchResult.match) {
    throw { status: 404, error: 'Face not recognized. Please register first.' };
  }
  const matchedEmployee = employees.find(emp => emp._id.toString() === matchResult.matched_id);
  if (!matchedEmployee) {
    throw { status: 404, error: 'Face not recognized. Please register first.' };
  }

  // 4. Liveness — checked last, now that a failure can be attributed to someone
  let liveness;
  try {
    const livenessRes = await axios.post(`${ML_SERVICE_URL}/liveness-check`, { images }, { timeout: 4000 });
    liveness = livenessRes.data;
  } catch (err) {
    throw { status: 503, error: 'Face recognition service unavailable' };
  }

  if (!liveness || liveness.is_live !== true) {
    try {
      await SpoofAttemptLog.create({
        targetedEmployee: matchedEmployee._id,
        workLocation: matchedEmployee.workLocation?._id || null,
        action,
        confidence: matchResult.confidence,
        livenessDetails: liveness?.details || 'unknown',
      });
    } catch (logErr) {
      console.error('[SpoofAttemptLog]', logErr.message);
    }
    notifyAdmins(
      `Security alert: liveness check failed for ${matchedEmployee.name} (${matchedEmployee.employeeId})`,
      `Action: ${action}\nSite: ${matchedEmployee.workLocation?.name || 'unassigned'}\nReason: ${liveness?.details || 'unknown'}\nTime: ${new Date().toLocaleString()}`
    ).catch(() => {});
    throw { status: 403, error: 'Liveness check failed. Please face the camera directly in good lighting.' };
  }

  return { matchedEmployee, confidence: matchResult.confidence };
}

module.exports = { identifyAndVerify };
