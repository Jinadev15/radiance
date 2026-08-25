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
const rosterCache = require('./rosterCache');
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
 * @param {ObjectId[]} [options.workLocationIds]  restrict candidates to these
 *        sites, nearest first. Derived from the scan's GPS — overlapping
 *        geofences mean a point can legitimately belong to more than one.
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
  const { workLocationIds = null, requireLiveness = true } = options;

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
  const { embedding } = await ml.extractEmbedding(images[0]);

  // 2. Identify against the ML service's resident roster cache.
  //
  //    This used to load every matchable employee (with embeddings) from
  //    MongoDB and ship them to the ML service on *every scan*. At this
  //    deployment's real size that was a 13.6 MB payload per scan and a
  //    guaranteed out-of-memory crash at a shift change. The roster now lives
  //    in the ML service (see utils/rosterCache.js) and a scan carries only
  //    the probe vector.
  const matchResult = await identifyAgainstCache(embedding, workLocationIds);

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

  // Load only the one person who matched — a single indexed lookup, rather
  // than the whole roster. This also re-checks matchability against the
  // database rather than trusting the cache: the cache is refreshed
  // asynchronously, so for a moment after someone is deactivated it can still
  // hold them. The database is the authority on who is allowed to clock in.
  const matchedEmployee = await Employee.findOne(
    Employee.matchableFilter({ _id: matchResult.matched_id })
  )
    .select(CANDIDATE_FIELDS)
    .populate('workLocation')
    .populate('shiftTemplate')
    .populate('serviceTag');

  if (!matchedEmployee) {
    console.warn(
      '[IdentifyAndVerify] Cache matched %s but they are no longer matchable — resyncing.',
      matchResult.matched_id
    );
    // Self-heal: the cache is out of date, so push the real roster.
    rosterCache.invalidate('cache returned a non-matchable employee');
    throw ml.serviceError(404, 'Face not recognized. Please register first.', 'NO_MATCH');
  }

  // Someone whose profile belongs to a different site must never be clocked
  // in here, even if the cache's site index somehow disagreed with the
  // database. `workLocationIds` is the set of sites this GPS position falls
  // inside — legitimately more than one where sites overlap on a campus.
  const scoped = workLocationIds ? workLocationIds.map(String) : null;
  if (scoped && !scoped.includes(String(matchedEmployee.workLocation?._id))) {
    console.warn(
      '[IdentifyAndVerify] %s matched at a site they are not assigned to — refusing.',
      matchedEmployee.employeeId
    );
    throw ml.serviceError(
      403,
      'You are not assigned to this site. Please scan at your own site, or ask HR to reassign you.',
      'WRONG_SITE'
    );
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

/**
 * Match a probe against the ML service's resident roster cache, resyncing once
 * if the cache is missing or stale.
 *
 * The ML service deliberately refuses to match against a roster whose version
 * it can't confirm, so "stale" is never silently treated as "no match" — that
 * would let a deactivated employee keep clocking in after an ML restart.
 */
async function identifyAgainstCache(embedding, workLocationIds) {
  // The cache indexes one site at a time. Where a position falls inside
  // several overlapping sites, each is tried in turn (nearest first) rather
  // than silently widening to the whole company.
  const siteIds = workLocationIds && workLocationIds.length ? workLocationIds.map(String) : [null];

  let result = null;
  for (const siteId of siteIds) {
    result = await ml.recogniseCached(embedding, { siteId, version: rosterCache.version() });
    if (result && result.cache_stale) break;      // handled below
    if (result && result.match) return result;    // found them
  }

  if (result && result.cache_stale) {
    // Either the ML service restarted (cold start wipes its memory) or the
    // roster changed. Push it and retry exactly once — a retry loop here would
    // turn one bad sync into an outage at a shift change.
    await rosterCache.sync({ force: true });
    for (const siteId of siteIds) {
      result = await ml.recogniseCached(embedding, { siteId, version: rosterCache.version() });
      if (result && (result.cache_stale || result.match)) break;
    }

    if (result && result.cache_stale) {
      throw ml.serviceError(
        503,
        'Face recognition is still starting up. Please try again in a moment.',
        'CACHE_SYNC_FAILED'
      );
    }
  }

  // An empty roster is a setup problem, not a failed match, and the two need
  // very different messages for the person standing at the kiosk.
  if (result && (result.reason === 'cache_empty' || result.reason === 'no_candidates_at_site')) {
    throw ml.serviceError(
      404,
      siteIds[0]
        ? 'No approved employees are enrolled at this site yet. Please ask HR.'
        : 'No registered employees found. Please register first.',
      'NO_CANDIDATES'
    );
  }

  return result;
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
