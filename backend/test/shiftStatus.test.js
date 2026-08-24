// Late/early-departure detection and payroll hour splitting, run under a UTC
// process clock — the condition under which the previous implementation
// (built on setHours()) silently marked nobody late and every full night
// shift as an early departure.
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../utils/shiftStatus');
const tz = require('../utils/tz');

const ist = (d, h, m) => tz.instantFromZonedParts({ year: 2026, month: 8, day: d, hour: h, minute: m });
const day = { startTime: '09:00', endTime: '17:00', graceMinutes: 10, breakMinutes: 30 };
const night = { startTime: '21:00', endTime: '06:00', graceMinutes: 10 };

test('day shift: on-time within grace, late just past it', () => {
  assert.equal(s.computeClockInStatus(ist(24, 8, 55), day), 'VALID');
  assert.equal(s.computeClockInStatus(ist(24, 9, 5), day), 'VALID');
  assert.equal(s.computeClockInStatus(ist(24, 9, 10), day), 'VALID');
  assert.equal(s.computeClockInStatus(ist(24, 9, 11), day), 'LATE');
  assert.equal(s.computeClockInStatus(ist(24, 14, 0), day), 'LATE');
});

test('night shift: late detection accounts for the shift starting in the evening', () => {
  assert.equal(s.computeClockInStatus(ist(23, 21, 5), night), 'VALID');
  assert.equal(s.computeClockInStatus(ist(23, 21, 20), night), 'LATE');
  // 4 hours into a shift that started the previous evening — must still read LATE.
  assert.equal(s.computeClockInStatus(ist(24, 1, 0), night), 'LATE');
});

test('night shift clock-out is never flagged early for a full shift', () => {
  const clockIn = ist(23, 21, 0);
  assert.equal(s.expectedShiftEnd(clockIn, night).toISOString(), ist(24, 6, 0).toISOString());
  assert.equal(s.computeClockOutStatus(ist(24, 6, 0), clockIn, night), 'VALID');
  assert.equal(s.computeClockOutStatus(ist(24, 6, 30), clockIn, night), 'VALID');
  assert.equal(s.computeClockOutStatus(ist(24, 3, 0), clockIn, night), 'EARLY_DEPARTURE');
});

test('a night-shift clock-in already after midnight still ends the same morning', () => {
  assert.equal(s.expectedShiftEnd(ist(24, 1, 0), night).toISOString(), ist(24, 6, 0).toISOString());
});

test('day shift clock-out', () => {
  assert.equal(s.computeClockOutStatus(ist(24, 17, 0), ist(24, 9, 0), day), 'VALID');
  assert.equal(s.computeClockOutStatus(ist(24, 16, 0), ist(24, 9, 0), day), 'EARLY_DEPARTURE');
});

test('computeWorkedHours: break deducted only past the threshold, overtime split correctly', () => {
  const full = s.computeWorkedHours({ clockInTime: ist(24, 9, 0), clockOutTime: ist(24, 17, 0), shift: day });
  assert.equal(full.grossMinutes, 480);
  assert.equal(full.breakMinutes, 30);
  assert.equal(full.totalHours, 7.5);
  assert.equal(full.overtimeHours, 0);
  assert.equal(full.isHalfDay, false);

  const overtime = s.computeWorkedHours({ clockInTime: ist(24, 9, 0), clockOutTime: ist(24, 19, 0), shift: day });
  assert.equal(overtime.regularHours, 7.5);
  assert.equal(overtime.overtimeHours, 2);

  const short = s.computeWorkedHours({ clockInTime: ist(24, 9, 0), clockOutTime: ist(24, 11, 0), shift: day });
  assert.equal(short.breakMinutes, 0, 'no break deducted from a session too short to contain one');
  assert.equal(short.isHalfDay, true);
});

test('computeWorkedHours with no shift assigned: all hours regular, no overtime invented', () => {
  const noShift = s.computeWorkedHours({ clockInTime: ist(24, 9, 0), clockOutTime: ist(24, 20, 0), shift: null });
  assert.equal(noShift.regularHours, 11);
  assert.equal(noShift.overtimeHours, 0);
});
