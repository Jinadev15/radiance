// Shared identify-then-verify pipeline for clock-in, clock-out and the
// kiosk's self-service screens.
//
// Order matters: identify who the face might be *before* checking liveness,
// so a failed liveness check can be logged against the identity it targeted
// instead of being an anonymous and useless data point.
const Employee = require('../models/Employee');
const SpoofAttemptLog = require('../models/SpoofAttemptLog');
const { notifySecurityEvent } = require('./notify');
const ml = require('./mlServiceCall');
// Registers the models .populate('workLocation'|'shiftTemplate'|'serviceTag') needs.
require('../models/WorkLocation');
require('../models/ShiftTemplate');
require('../models/ServiceTag');

// Minimum frames required to run the real anti-spoof check. The motion check
// — the one that actually distinguishes a live face from a held-up printed
// photo — needs two frames; with one, only the much weaker per-frame
// texture/glare heuristic applies. These endpoints are unauthenticated, so a
// direct API caller could otherwise submit a single frame and skip the real
// check entirely. Enforced server-side so no client can opt out.
const MIN_LIVENESS_FRAMES = 2;

// Fields the matcher and the downstream routes need. Selecting explicitly
// keeps the per-scan payload proportional to what is used, rather than
// dragging every document field into memory for the whole roster.
const CANDIDATE_FIELDS = 'name employeeId faceEmbeddings workLocation shiftTemplate serviceTag status';

/**
 * Identify a face and verify it is live.
 *
 * @param {string[]} images   1..3 base64 frames (2 required for a real liveness check)
 * @param {'CLOCK_IN'|'CLOCK_OUT'} action  used only to label a spoof log entry
 * @param {object} [options]
 * @param {string} [options.workLocationId]  restrict candidates to one site.
 *        This is both an accuracy and a speed win: a worker at one site only
 *        ever needs matching against that site's roster, which cuts the
 *        candidate pool (and therefore the chance of a false match) by however
 *        many sites the company runs.
 * @param {boolean} [options.requireLiveness=true]
 *
 * Throws { status, error, code } on any failure so routes can respond straight
 * from the catch block.
 */
async function identifyAndVerify(images, action, options = {}) {
  const { workLocationId = null, requireLiveness = true } = options;

  if (!Array.isArray(images) || images.length === 0) {
    throw ml.serviceError(400, 'Face image is required', 'NO_IMAGE');
  }
  if (requireLiveness && images.length < MIN_LIVENESS_FRAMES) {
    throw ml.serviceError(
      400,
      'At least two frames are required to verify liveness. Please try scanning again.',
      'TOO_FEW_FRAMES'
    );
  }

  // 1. Turn the probe frame into an embedding. Throws NO_FACE with a
  //    user-facing message if the frame has no detectable face.
  const embedding = await ml.extractEmbedding(images[0]);

  // 2. Load candidates — active and actually enrolled, scoped to the site
  //    when the kiosk told us which one it is.
  const filter = Employee.matchableFilter(
    workLocationId ? { workLocation: workLocationId } : {}
  );
  const employees = await Employee.find(filter)
    .select(CANDIDATE_FIELDS)
    .populate('workLocation')
    .populate('shiftTemplate')
    .populate('serviceTag');

  if (employees.length === 0) {
    // Distinguish "this site has nobody enrolled" from "nobody anywhere is
    // enrolled" — the first is a setup mistake worth naming precisely.
    throw ml.serviceError(
      404,
      workLocationId
        ? 'No approved employees are enrolled at this site yet. Please ask HR.'
        : 'No registered employees found. Please register first.',
      'NO_CANDIDATES'
    );
  }

  const candidates = {};
  for (const emp of employees) {
    candidates[emp._id.toString()] = emp.faceEmbeddings;
  }

  // 3. Identify.
  const matchResult = await ml.recognise(embedding, candidates);

  if (!matchResult || !matchResult.match || !matchResult.matched_id) {
    // An ambiguous result is a different problem from an unknown face, and
    // the person standing at the kiosk needs different advice for each.
    if (matchResult && matchResult.reason === 'ambiguous_margin') {
      throw ml.serviceError(
        409,
        'Could not confirm your identity clearly — two profiles look too similar. ' +
        'Please try again facing the camera directly, or ask your supervisor.',
        'AMBIGUOUS_MATCH'
      );
    }
    throw ml.serviceError(404, 'Face not recognized. Please register first.', 'NO_MATCH');
  }

  const matchedEmployee = employees.find(emp => emp._id.toString() === matchResult.matched_id);
  if (!matchedEmployee) {
    // The matcher returned an id that isn't in the set we sent — treat as
    // no match rather than trusting it.
    console.error('[IdentifyAndVerify] Matcher returned unknown id:', matchResult.matched_id);
    throw ml.serviceError(404, 'Face not recognized. Please register first.', 'NO_MATCH');
  }

  // 4. Liveness — checked last, now that a failure can be attributed.
  let liveness = null;
  if (requireLiveness) {
    liveness = await ml.checkLiveness(images);

    if (!liveness || liveness.is_live !== true) {
      // A frame too dark to judge is a lighting problem, not a spoof attempt.
      // Logging it as one produced false security alerts every winter morning
      // and told an honest worker they looked like a printed photo.
      if (liveness && liveness.too_dark) {
        throw ml.serviceError(
          400,
          liveness.details || 'Too dark to scan clearly — please move to better light and try again.',
          'TOO_DARK'
        );
      }

      await recordSpoofAttempt(matchedEmployee, action, matchResult, liveness);
      throw ml.serviceError(
        403,
        'Liveness check failed. Please face the camera directly in good lighting.',
        'LIVENESS_FAILED'
      );
    }
  }

  return {
    matchedEmployee,
    confidence: matchResult.confidence,
    margin: matchResult.margin === undefined ? null : matchResult.margin,
    livenessScore: liveness ? liveness.motion_score : null,
    candidatesCompared: matchResult.candidates_compared,
  };
}

// Never allowed to break a scan: a failure to write the security log must not
// turn into a 500 for the person at the kiosk.
async function recordSpoofAttempt(employee, action, matchResult, liveness) {
  try {
    await SpoofAttemptLog.create({
      targetedEmployee: employee._id,
      workLocation: (employee.workLocation && employee.workLocation._id) || null,
      action,
      confidence: matchResult.confidence,
      livenessDetails: (liveness && liveness.details) || 'unknown',
    });
  } catch (logErr) {
    console.error('[SpoofAttemptLog]', logErr.message);
  }

  // Throttled inside notify.js — an unthrottled alert per failure meant one
  // site having a bad morning could exhaust the daily mail quota and bury the
  // one alert that mattered.
  notifySecurityEvent({
    key: `liveness:${employee._id}`,
    subject: `Security alert: liveness check failed for ${employee.name} (${employee.employeeId})`,
    body: [
      `Action: ${action}`,
      `Site: ${(employee.workLocation && employee.workLocation.name) || 'unassigned'}`,
      `Reason: ${(liveness && liveness.details) || 'unknown'}`,
      `Match confidence: ${matchResult.confidence}`,
    ].join('\n'),
  }).catch(() => {});
}

module.exports = { identifyAndVerify, MIN_LIVENESS_FRAMES };
