// Safety net for forgotten check-outs. Without this, an employee who never
// scans out leaves their AttendanceLog session open forever, which makes
// their hours wrong for payroll and leaves "still clocked in" showing on the
// dashboard indefinitely.
const mongoose = require('mongoose');
const AttendanceLog = require('../models/AttendanceLog');
require('../models/ShiftTemplate'); // registers the model the nested .populate('shiftTemplate') needs
const { expectedShiftEnd, computeWorkedHours } = require('./shiftStatus');
const { DEFAULT_TZ } = require('./tz');

const STALE_AFTER_HOURS = 16; // longer than any realistic single shift + grace

async function runAutoClockOutSweep() {
  if (mongoose.connection.readyState !== 1) return { closed: 0 };

  const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000);
  // Uses the partial index on { clockOutTime: null } (AttendanceLog.js) —
  // proportional to the number of currently-open sessions, not the whole
  // collection.
  const staleLogs = await AttendanceLog.find({
    clockOutTime: null,
    clockInTime: { $lt: cutoff },
  }).populate({ path: 'employee', populate: { path: 'shiftTemplate' } });

  let closed = 0;
  for (const log of staleLogs) {
    try {
      const shift = log.employee?.shiftTemplate || null;
      // Same timezone-correct shift-end calculation clock-out uses, so an
      // auto-closed night-shift session lands on the right day and doesn't
      // get flagged early. expectedShiftEnd() already falls back to
      // clock-in + 12h when no shift is assigned.
      const autoClockOut = expectedShiftEnd(log.clockInTime, shift, DEFAULT_TZ);

      const hours = computeWorkedHours({
        clockInTime: log.clockInTime,
        clockOutTime: autoClockOut,
        shift,
      });

      // Re-check `clockOutTime` is still null at write time (not just at the
      // query above) — an employee could have scanned a real clock-out in the
      // gap between find() and this update, and that must not be clobbered by
      // the auto-close guess.
      const updated = await AttendanceLog.findOneAndUpdate(
        { _id: log._id, clockOutTime: null },
        {
          clockOutTime: autoClockOut,
          markedBy: 'AUTO_CLOSED',
          grossMinutes: hours.grossMinutes,
          breakMinutes: hours.breakMinutes,
          netMinutes: hours.netMinutes,
          regularMinutes: hours.regularMinutes,
          overtimeMinutes: hours.overtimeMinutes,
          totalHours: hours.totalHours,
          regularHours: hours.regularHours,
          overtimeHours: hours.overtimeHours,
          isHalfDay: hours.isHalfDay,
          notes: [log.notes, 'Auto clocked-out — no check-out scan recorded.'].filter(Boolean).join(' '),
        },
        { new: true }
      );
      if (updated) closed += 1;
    } catch (err) {
      console.error(`[AutoClockOut] Failed to close log ${log._id}:`, err.message);
      // Continue the sweep — one bad record shouldn't stop the rest from closing.
    }
  }

  if (closed > 0) console.log(`[AutoClockOut] Closed ${closed} stale attendance session(s).`);
  return { closed };
}

module.exports = { runAutoClockOutSweep };
