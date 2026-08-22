// Shift-status computation against a populated ShiftTemplate document (or null,
// meaning "no shift assigned" — always VALID). Handles cross-day (night) shifts:
// a shift whose endTime is numerically before its startTime is treated as
// spanning into the next calendar day when checking clock-out.
const DEFAULT_GRACE_MINUTES = 10;

function parseTimeOnDate(hhmm, referenceDate) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(referenceDate);
  d.setHours(h, m, 0, 0);
  return d;
}

function computeClockInStatus(clockInTime, shift) {
  if (!shift || !shift.startTime) return 'VALID';
  const grace = shift.graceMinutes ?? DEFAULT_GRACE_MINUTES;
  const cutoff = parseTimeOnDate(shift.startTime, clockInTime);
  cutoff.setMinutes(cutoff.getMinutes() + grace);
  return clockInTime > cutoff ? 'LATE' : 'VALID';
}

// clockInTime anchors the expected shift-end date — for a night shift, the
// end time falls on the day AFTER clock-in, not the day of clock-out itself.
function computeClockOutStatus(clockOutTime, clockInTime, shift) {
  if (!shift || !shift.endTime) return 'VALID';
  const crossesMidnight = shift.crossesMidnight ?? (shift.endTime < shift.startTime);
  const cutoff = parseTimeOnDate(shift.endTime, clockInTime);
  if (crossesMidnight) cutoff.setDate(cutoff.getDate() + 1);
  return clockOutTime < cutoff ? 'EARLY_DEPARTURE' : 'VALID';
}

module.exports = { computeClockInStatus, computeClockOutStatus };
