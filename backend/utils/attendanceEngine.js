// Attendance write path, shared by clock-in and clock-out.
//
// Pulled out of the route handlers because the session rules are subtle and
// were previously duplicated (and subtly different) between the two routes:
// how an open session is found, how a night shift spanning midnight is
// treated, what happens on a second scan of the same day, and how a
// replayed offline scan is timestamped.
const AttendanceLog = require('../models/AttendanceLog');
const Employee = require('../models/Employee');
const { isWithinGeofence } = require('./geofence');
const { computeClockInStatus, computeClockOutStatus, computeWorkedHours } = require('./shiftStatus');
const { businessDate, DEFAULT_TZ } = require('./tz');

// How far back to look for a session that is still open. Comfortably longer
// than any real shift plus overtime, so a night shift that began yesterday
// evening is still recognised as the same ongoing session after midnight
// rather than starting a second one.
const OPEN_SESSION_LOOKBACK_HOURS = 20;
// How far back a clock-out may attach to a session, open or already closed —
// wide enough to still report "you already clocked out" helpfully afterwards.
const CLOCK_OUT_LOOKBACK_HOURS = 30;

// Guard against a genuine double-tap being recorded as two sessions. Someone
// who taps Clock Out and immediately taps Clock In almost certainly made a
// mistake rather than starting a second shift 30 seconds later.
const MIN_SECONDS_BETWEEN_SESSIONS = Number(process.env.MIN_SECONDS_BETWEEN_SESSIONS || 120);

// Bounds on a client-supplied capture time (offline replay). A kiosk tablet
// with a wrong system clock would otherwise write nonsense straight into
// payroll, so the value is validated and rejected rather than trusted.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;         // tolerate a slightly fast device clock
const MAX_OFFLINE_AGE_MS = 36 * 60 * 60 * 1000;  // a queue older than this is stale, not late

const DUPLICATE_KEY = 11000;

function engineError(status, error, code) {
  return { status, error, code, isServiceError: true };
}

/**
 * Decide what instant a scan actually happened at.
 *
 * Offline scans are queued on the kiosk and replayed when the network
 * returns. Previously the queued body carried no timestamp, so the backend
 * used the *sync* time: a site whose Wi-Fi dropped from 08:45 to 13:00
 * recorded forty people as arriving at 13:00, and once late detection worked
 * they were all marked late. The kiosk now stamps `capturedAt` at scan time
 * and this validates it.
 */
function resolveCaptureTime(capturedAt, now = new Date()) {
  if (!capturedAt) return { at: now, source: 'AUTO' };

  const parsed = new Date(capturedAt);
  if (Number.isNaN(parsed.getTime())) {
    throw engineError(400, 'Invalid capture time on the scan.', 'BAD_CAPTURED_AT');
  }

  const age = now.getTime() - parsed.getTime();
  if (age < -MAX_CLOCK_SKEW_MS) {
    // A future timestamp means the device clock is wrong. Accepting it would
    // put a clock-in ahead of a clock-out and produce negative hours.
    throw engineError(
      400,
      'This device\'s clock is ahead of the server. Please correct the date and time on the tablet.',
      'DEVICE_CLOCK_AHEAD'
    );
  }
  if (age > MAX_OFFLINE_AGE_MS) {
    throw engineError(
      400,
      'This scan is more than 36 hours old and can no longer be recorded automatically. ' +
      'Please ask HR to add it manually.',
      'CAPTURE_TOO_OLD'
    );
  }

  // Small negative skew (device a minute or two fast) is clamped rather than
  // rejected — it is harmless and rejecting it would be needlessly brittle.
  const at = parsed > now ? now : parsed;
  // Anything meaningfully older than "now" arrived via the offline queue;
  // flagging it lets HR spot-check replayed records.
  const wasQueued = age > 2 * 60 * 1000;
  return { at, source: wasQueued ? 'OFFLINE_SYNC' : 'AUTO' };
}

/** The employee's still-open session, if any. */
async function findOpenSession(employeeId, now = new Date()) {
  const lookback = new Date(now.getTime() - OPEN_SESSION_LOOKBACK_HOURS * 60 * 60 * 1000);
  return AttendanceLog.findOne({
    employee: employeeId,
    clockInTime: { $gte: lookback },
    clockOutTime: null,
  }).sort({ clockInTime: -1 });
}

/** Most recent session, open or closed, within the clock-out window. */
async function findLatestSession(employeeId, now = new Date()) {
  const lookback = new Date(now.getTime() - CLOCK_OUT_LOOKBACK_HOURS * 60 * 60 * 1000);
  return AttendanceLog.findOne({
    employee: employeeId,
    clockInTime: { $gte: lookback },
  }).sort({ clockInTime: -1 });
}

/**
 * Enforce the site geofence.
 *
 * Fails **closed**: an employee with no assigned site is refused rather than
 * waved through. Previously the check was wrapped in
 * `if (employee.workLocation)`, and because kiosk self-registration never
 * captured a site, every self-registered employee had `workLocation: null`
 * and therefore no location check at all — the flagship anti-fraud control
 * was silently inert for exactly the people who enrolled themselves.
 */
function enforceGeofence(employee, latitude, longitude, verb) {
  const site = employee.workLocation;
  if (!site) {
    throw engineError(
      409,
      'Your profile is not assigned to a work site yet, so attendance cannot be recorded. Please ask HR to assign your site.',
      'NO_SITE_ASSIGNED'
    );
  }

  const lat = latitude === undefined || latitude === null ? null : parseFloat(latitude);
  const lon = longitude === undefined || longitude === null ? null : parseFloat(longitude);
  if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) {
    throw engineError(
      403,
      `Location access is required to ${verb}. Please enable location and try again.`,
      'LOCATION_REQUIRED'
    );
  }

  const geo = isWithinGeofence(lat, lon, site);
  if (!geo.within) {
    throw engineError(
      403,
      `You're ${geo.distanceMeters}m from ${site.name}. Move within ${site.radiusMeters}m of the site to ${verb}.`,
      'OUTSIDE_GEOFENCE'
    );
  }
  return { latitude: lat, longitude: lon, distanceMeters: geo.distanceMeters };
}

/**
 * Open a new session.
 *
 * Session numbers are allocated optimistically: read the current maximum for
 * that employee and business date, add one, and let the unique index on
 * { employee, date, sessionNumber } reject a collision so a concurrent scan
 * retries rather than silently overwriting. This replaces the previous
 * one-row-per-day unique index, which made clocking back in after a break
 * (or recovering from a mistaken clock-out) fail with a bare
 * "Internal server error".
 */
async function openSession({
  employee, at, geo, confidence, margin, livenessScore, source, timeZone = DEFAULT_TZ, notes = null,
}) {
  const date = businessDate(at, timeZone);
  const status = computeClockInStatus(at, employee.shiftTemplate, timeZone);

  for (let attempt = 0; attempt < 4; attempt++) {
    const latest = await AttendanceLog.findOne({ employee: employee._id, date })
      .sort({ sessionNumber: -1 })
      .select('sessionNumber');
    const sessionNumber = (latest ? latest.sessionNumber : 0) + 1;

    try {
      const log = new AttendanceLog({
        employee: employee._id,
        date,
        sessionNumber,
        clockInTime: at,
        clockInLatitude: geo ? geo.latitude : null,
        clockInLongitude: geo ? geo.longitude : null,
        clockInDistanceMeters: geo ? geo.distanceMeters : null,
        status,
        confidence,
        matchMargin: margin,
        livenessScore,
        markedBy: source,
        notes,
        workLocation: (employee.workLocation && employee.workLocation._id) || employee.workLocation || null,
        siteName: (employee.workLocation && employee.workLocation.name) || null,
        service: (employee.serviceTag && employee.serviceTag.name) || null,
        timezone: timeZone,
      });
      await log.save();
      return log;
    } catch (err) {
      if (err && err.code === DUPLICATE_KEY && attempt < 3) continue; // lost the race, re-read and retry
      throw err;
    }
  }
  throw engineError(
    503,
    'Could not record your scan because of heavy traffic at this moment. Please try again.',
    'SESSION_CONTENTION'
  );
}

/** Close an open session, computing the payroll breakdown once. */
async function closeSession({ session, employee, at, geo, timeZone = DEFAULT_TZ }) {
  const hours = computeWorkedHours({
    clockInTime: session.clockInTime,
    clockOutTime: at,
    shift: employee.shiftTemplate,
  });
  const outStatus = computeClockOutStatus(at, session.clockInTime, employee.shiftTemplate, timeZone);

  session.clockOutTime = at;
  session.clockOutLatitude = geo ? geo.latitude : null;
  session.clockOutLongitude = geo ? geo.longitude : null;
  session.clockOutDistanceMeters = geo ? geo.distanceMeters : null;

  // A LATE clock-in stays LATE — leaving early doesn't undo arriving late,
  // and overwriting it would lose the more important fact.
  if (outStatus === 'EARLY_DEPARTURE' && session.status === 'VALID') {
    session.status = outStatus;
  }

  Object.assign(session, {
    grossMinutes: hours.grossMinutes,
    breakMinutes: hours.breakMinutes,
    netMinutes: hours.netMinutes,
    regularMinutes: hours.regularMinutes,
    overtimeMinutes: hours.overtimeMinutes,
    totalHours: hours.totalHours,
    regularHours: hours.regularHours,
    overtimeHours: hours.overtimeHours,
    isHalfDay: hours.isHalfDay,
  });

  await session.save();
  return session;
}

/**
 * Refuse a new session that starts suspiciously soon after the last one
 * closed — almost always a mis-tap rather than a genuine second shift.
 */
function assertNotDoubleTap(latestSession, at) {
  if (!latestSession || !latestSession.clockOutTime) return;
  const gapSeconds = (at.getTime() - new Date(latestSession.clockOutTime).getTime()) / 1000;
  if (gapSeconds >= 0 && gapSeconds < MIN_SECONDS_BETWEEN_SESSIONS) {
    throw engineError(
      409,
      `You just clocked out moments ago. If you meant to start a new session, please wait ` +
      `${Math.ceil((MIN_SECONDS_BETWEEN_SESSIONS - gapSeconds) / 60)} minute(s) and scan again.`,
      'TOO_SOON_AFTER_CLOCK_OUT'
    );
  }
}

/**
 * Restrict an attendance query filter to employees HR has actually approved.
 *
 * A self-registered employee can clock in and appear as present before HR
 * ever reviews them (see Employee.matchableFilter) — attendance is never
 * gated on approval, only payroll is. `approvedOnly` is the query-time
 * switch that makes approval status matter, for the export/summary a real
 * payroll run is built from. Combines correctly with an existing single
 * `filter.employee` (verifies that one employee is approved) or an existing
 * `$in` (intersects the two id sets) rather than clobbering either.
 */
async function restrictToApproved(filter, approvedOnly) {
  if (!approvedOnly) return filter;
  const approvedRows = await Employee.find(Employee.activeFilter()).select('_id').lean();
  const approvedSet = new Set(approvedRows.map(e => String(e._id)));

  if (filter.employee && typeof filter.employee === 'object' && filter.employee.$in) {
    filter.employee.$in = filter.employee.$in.filter(id => approvedSet.has(String(id)));
  } else if (filter.employee) {
    const mongoose = require('mongoose');
    filter.employee = approvedSet.has(String(filter.employee))
      ? filter.employee
      : new mongoose.Types.ObjectId(); // matches nothing real — an empty result, not an error
  } else {
    filter.employee = { $in: Array.from(approvedSet) };
  }
  return filter;
}

/** Sum of a day's sessions for one employee — the number payroll needs. */
async function dayTotals(employeeId, date) {
  const rows = await AttendanceLog.find({ employee: employeeId, date })
    .select('totalHours regularHours overtimeHours sessionNumber')
    .lean();
  return rows.reduce((acc, r) => ({
    sessions: acc.sessions + 1,
    totalHours: parseFloat((acc.totalHours + (r.totalHours || 0)).toFixed(2)),
    regularHours: parseFloat((acc.regularHours + (r.regularHours || 0)).toFixed(2)),
    overtimeHours: parseFloat((acc.overtimeHours + (r.overtimeHours || 0)).toFixed(2)),
  }), { sessions: 0, totalHours: 0, regularHours: 0, overtimeHours: 0 });
}

module.exports = {
  resolveCaptureTime,
  findOpenSession,
  findLatestSession,
  enforceGeofence,
  openSession,
  closeSession,
  assertNotDoubleTap,
  dayTotals,
  restrictToApproved,
  engineError,
  MIN_SECONDS_BETWEEN_SESSIONS,
  OPEN_SESSION_LOOKBACK_HOURS,
};
