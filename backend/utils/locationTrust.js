// Signals that a reported GPS position may not be genuine.
//
// This matters far more now that employees scan from their own phones. A
// tablet bolted to a wall proved its own location: being at the kiosk *was*
// being at the site. A personal phone reports whatever its owner's software
// says, and mock-location apps are a two-minute install on Android.
//
// None of this can *prove* a location is real — a web page cannot detect a
// mock provider the way a native app can via Play Integrity. What it can do
// is notice the patterns a spoofed reading tends to leave, record them on
// the attendance row, and surface the ones worth a human look. Face
// recognition still proves *who* scanned; this is only about *where*.
//
// Deliberately advisory, not blocking: a false accusation of fraud against an
// honest worker is worse than a missed one, and GPS is genuinely erratic
// indoors. Findings are attached to the record for HR to review.
const AttendanceLog = require('../models/AttendanceLog');
const { calculateDistance } = require('./geofence');

// A real fix carries an accuracy estimate in metres. Phones report anywhere
// from ~5 m outdoors to 50 m+ indoors. Several mock providers report a
// suspiciously perfect value, or none at all.
const IMPLAUSIBLE_ACCURACY_M = 1;
// Faster than a car on Indian roads over a meaningful distance: the same
// person cannot have been at both places.
const IMPOSSIBLE_SPEED_KMH = 200;
const MIN_TRAVEL_DISTANCE_M = 500;   // ignore GPS jitter between nearby scans
// Consecutive scans landing on *exactly* the same coordinates is the
// signature of a hardcoded mock location; real GPS always jitters a little.
const IDENTICAL_COORD_TOLERANCE_M = 1;

/**
 * @param {object} params
 * @param {number} params.latitude
 * @param {number} params.longitude
 * @param {number} [params.accuracy]   coords.accuracy from the browser, in metres
 * @param {*}      params.employeeId
 * @param {Date}   params.at
 * @returns {Promise<{flags: string[], notes: string|null}>}
 */
async function assessLocation({ latitude, longitude, accuracy, employeeId, at }) {
  const flags = [];

  // 1. A missing or impossibly precise accuracy reading.
  if (accuracy === undefined || accuracy === null) {
    flags.push('NO_ACCURACY_REPORTED');
  } else if (Number(accuracy) <= IMPLAUSIBLE_ACCURACY_M) {
    flags.push('IMPLAUSIBLE_ACCURACY');
  }

  // 2. Compare against this employee's own previous scan.
  const previous = await AttendanceLog.findOne({
    employee: employeeId,
    clockInLatitude: { $ne: null },
    clockInLongitude: { $ne: null },
  })
    .sort({ clockInTime: -1 })
    .select('clockInTime clockInLatitude clockInLongitude')
    .lean();

  if (previous && previous.clockInTime) {
    const metres = calculateDistance(
      Number(latitude), Number(longitude),
      previous.clockInLatitude, previous.clockInLongitude
    );
    const hours = (new Date(at) - new Date(previous.clockInTime)) / 3600000;

    if (metres <= IDENTICAL_COORD_TOLERANCE_M && hours > 0.5) {
      // Byte-identical coordinates across hours apart. A phone left on a desk
      // still drifts; a hardcoded value does not.
      flags.push('IDENTICAL_TO_PREVIOUS_FIX');
    }

    if (hours > 0 && metres >= MIN_TRAVEL_DISTANCE_M) {
      const speed = (metres / 1000) / hours;
      if (speed > IMPOSSIBLE_SPEED_KMH) {
        flags.push('IMPOSSIBLE_TRAVEL');
      }
    }
  }

  const notes = flags.length
    ? `Location review: ${flags.join(', ')}`
    : null;

  return { flags, notes };
}

module.exports = {
  assessLocation,
  IMPOSSIBLE_SPEED_KMH,
  MIN_TRAVEL_DISTANCE_M,
};
