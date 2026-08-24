// Shift-status and worked-hours computation.
//
// Every comparison in here is done in "minutes since local midnight, in the
// business timezone" — two plain integers on the same scale. The previous
// implementation built Date objects with `setHours()`, which resolves in the
// *server's* timezone: on a UTC host a "09:00" shift became 09:00 UTC
// (14:30 IST), so nobody was marked late until mid-afternoon and every
// night-shift worker who completed a full shift was flagged EARLY_DEPARTURE.
// Integer minutes remove any opportunity for a timezone to leak in.
const {
  DEFAULT_TZ,
  businessDate,
  minutesSinceMidnight,
  parseHHMM,
  instantFromZonedParts,
  addBusinessDays,
} = require('./tz');

const DEFAULT_GRACE_MINUTES = 10;
const MINUTES_PER_DAY = 24 * 60;
// Fallback shift length when no template is assigned, used only to bound an
// auto-close. Deliberately generous — it should never truncate real hours.
const NO_SHIFT_FALLBACK_MINUTES = 12 * 60;

// A shift whose end time is at or before its start time runs past midnight
// (e.g. 21:00 -> 06:00). Derived from the times rather than trusting the
// model's `crossesMidnight` virtual, which is absent on lean/aggregated docs.
function shiftBounds(shift) {
  if (!shift) return null;
  const startMin = parseHHMM(shift.startTime);
  const endMin = parseHHMM(shift.endTime);
  if (startMin === null || endMin === null) return null;
  const crossesMidnight = endMin <= startMin;
  const lengthMinutes = crossesMidnight
    ? MINUTES_PER_DAY - startMin + endMin
    : endMin - startMin;
  return { startMin, endMin, crossesMidnight, lengthMinutes };
}

// Normalises a clock-in that happened *after* midnight on a night shift onto
// the same continuous scale as the shift start.
//
// Night shift 21:00-06:00, worker turns up at 01:00 — four hours late. Raw
// minutes (60) compare as "well before 21:10", so they'd be marked on time.
// Adding a day's worth of minutes (1500) puts them correctly past the cutoff.
function normaliseClockInMinutes(clockInMin, bounds) {
  if (bounds.crossesMidnight && clockInMin < bounds.endMin) {
    return clockInMin + MINUTES_PER_DAY;
  }
  return clockInMin;
}

function computeClockInStatus(clockInTime, shift, timeZone = DEFAULT_TZ) {
  const bounds = shiftBounds(shift);
  if (!bounds) return 'VALID'; // no shift assigned, or a malformed template
  const grace = Number.isFinite(shift.graceMinutes) ? shift.graceMinutes : DEFAULT_GRACE_MINUTES;
  const clockInMin = normaliseClockInMinutes(
    minutesSinceMidnight(clockInTime, timeZone),
    bounds
  );
  return clockInMin > bounds.startMin + grace ? 'LATE' : 'VALID';
}

// The real instant this shift was due to end, anchored on the clock-in.
//
// For a night shift the end falls on the next calendar day *unless* the
// clock-in itself already happened after midnight (someone starting late
// into a 21:00-06:00 shift at 01:00 still ends at 06:00 that same morning,
// not 06:00 the following one).
function expectedShiftEnd(clockInTime, shift, timeZone = DEFAULT_TZ) {
  const bounds = shiftBounds(shift);
  const clockIn = new Date(clockInTime);

  if (!bounds) {
    return new Date(clockIn.getTime() + NO_SHIFT_FALLBACK_MINUTES * 60 * 1000);
  }

  const clockInMin = minutesSinceMidnight(clockIn, timeZone);
  let endDateStr = businessDate(clockIn, timeZone);
  if (bounds.crossesMidnight && clockInMin >= bounds.endMin) {
    endDateStr = addBusinessDays(endDateStr, 1, timeZone);
  }

  const [year, month, day] = endDateStr.split('-').map(Number);
  const end = instantFromZonedParts(
    { year, month, day, hour: Math.floor(bounds.endMin / 60), minute: bounds.endMin % 60 },
    timeZone
  );

  // Guard against a template/clock-in combination that puts the end at or
  // before the start (e.g. a day-shift worker who clocked in after their
  // own shift end). Roll forward a day so the window is always positive.
  if (end <= clockIn) {
    const rolled = addBusinessDays(endDateStr, 1, timeZone).split('-').map(Number);
    return instantFromZonedParts(
      { year: rolled[0], month: rolled[1], day: rolled[2], hour: Math.floor(bounds.endMin / 60), minute: bounds.endMin % 60 },
      timeZone
    );
  }
  return end;
}

function computeClockOutStatus(clockOutTime, clockInTime, shift, timeZone = DEFAULT_TZ) {
  const bounds = shiftBounds(shift);
  if (!bounds) return 'VALID';
  const expectedEnd = expectedShiftEnd(clockInTime, shift, timeZone);
  return new Date(clockOutTime) < expectedEnd ? 'EARLY_DEPARTURE' : 'VALID';
}

// Splits a worked session into the numbers payroll actually needs.
//
// Raw clock-out-minus-clock-in isn't payable: an unpaid break has to come
// off, hours past the shift length are overtime (usually at a different
// rate), and a short attendance is normally paid as a half day rather than
// as raw hours. Computed once at clock-out and stored on the log so a later
// edit to the shift template can't retroactively change historic payroll.
function computeWorkedHours({ clockInTime, clockOutTime, shift }) {
  const empty = {
    grossMinutes: 0, breakMinutes: 0, netMinutes: 0,
    regularMinutes: 0, overtimeMinutes: 0,
    totalHours: 0, regularHours: 0, overtimeHours: 0,
    isHalfDay: false,
  };
  if (!clockInTime || !clockOutTime) return empty;

  const grossMinutes = Math.max(0, Math.round((new Date(clockOutTime) - new Date(clockInTime)) / 60000));
  if (grossMinutes === 0) return empty;

  const bounds = shiftBounds(shift);

  // Only deduct the unpaid break once the session is long enough to have
  // actually contained one — otherwise a 40-minute appearance would have
  // lunch taken off it.
  const configuredBreak = Math.max(0, Number(shift?.breakMinutes) || 0);
  const breakAfter = Number.isFinite(shift?.breakDeductAfterMinutes)
    ? shift.breakDeductAfterMinutes
    : 300;
  const breakMinutes = configuredBreak > 0 && grossMinutes > breakAfter ? configuredBreak : 0;

  const netMinutes = Math.max(0, grossMinutes - breakMinutes);

  // Overtime threshold: explicit if configured, otherwise the paid length of
  // the assigned shift. With no shift assigned there is no basis for calling
  // anything overtime, so it all counts as regular.
  let overtimeAfter = Number(shift?.overtimeAfterMinutes);
  if (!Number.isFinite(overtimeAfter) || overtimeAfter <= 0) {
    overtimeAfter = bounds ? Math.max(0, bounds.lengthMinutes - configuredBreak) : Infinity;
  }
  const overtimeMinutes = Number.isFinite(overtimeAfter) ? Math.max(0, netMinutes - overtimeAfter) : 0;
  const regularMinutes = netMinutes - overtimeMinutes;

  const halfDayThreshold = Number.isFinite(shift?.halfDayThresholdMinutes)
    ? shift.halfDayThresholdMinutes
    : (bounds ? Math.round(bounds.lengthMinutes / 2) : 240);
  const isHalfDay = netMinutes > 0 && netMinutes < halfDayThreshold;

  const toHours = (m) => parseFloat((m / 60).toFixed(2));
  return {
    grossMinutes,
    breakMinutes,
    netMinutes,
    regularMinutes,
    overtimeMinutes,
    totalHours: toHours(netMinutes),
    regularHours: toHours(regularMinutes),
    overtimeHours: toHours(overtimeMinutes),
    isHalfDay,
  };
}

module.exports = {
  computeClockInStatus,
  computeClockOutStatus,
  expectedShiftEnd,
  computeWorkedHours,
  shiftBounds,
  DEFAULT_GRACE_MINUTES,
};
