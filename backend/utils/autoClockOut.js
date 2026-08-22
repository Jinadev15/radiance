// Safety net for forgotten check-outs. Without this, an employee who never
// scans out leaves their AttendanceLog open forever, which (a) makes their
// hours wrong for payroll and (b) — because clock-in look-up matches on "any
// open log in the last 20h" — would eventually stop blocking a fresh clock-in
// only after that window passes anyway. Runs on an interval, no cron needed.
const mongoose = require('mongoose');
const AttendanceLog = require('../models/AttendanceLog');
const Employee = require('../models/Employee');
require('../models/ShiftTemplate'); // registers the model the nested .populate('shiftTemplate') needs

const STALE_AFTER_HOURS = 16; // longer than any realistic single shift + grace

function parseTimeOnDate(hhmm, referenceDate) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(referenceDate);
  d.setHours(h, m, 0, 0);
  return d;
}

async function runAutoClockOutSweep() {
  if (mongoose.connection.readyState !== 1) return { closed: 0 };

  const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000);
  const staleLogs = await AttendanceLog.find({
    clockOutTime: { $exists: false },
    clockInTime: { $lt: cutoff }
  }).populate({ path: 'employee', populate: { path: 'shiftTemplate' } });

  let closed = 0;
  for (const log of staleLogs) {
    try {
      const shift = log.employee?.shiftTemplate;
      let autoClockOut;
      if (shift?.endTime) {
        autoClockOut = parseTimeOnDate(shift.endTime, log.clockInTime);
        const crossesMidnight = shift.crossesMidnight ?? (shift.endTime < shift.startTime);
        if (crossesMidnight) autoClockOut.setDate(autoClockOut.getDate() + 1);
        if (autoClockOut <= log.clockInTime) autoClockOut.setDate(autoClockOut.getDate() + 1);
      } else {
        autoClockOut = new Date(log.clockInTime.getTime() + 12 * 60 * 60 * 1000);
      }

      // Re-check `clockOutTime` doesn't exist at write time (not just at the
      // query above) — an employee could have scanned a real clock-out in
      // the gap between the find() and this save(), and we must not
      // clobber it with the auto-close guess. findOneAndUpdate skips the
      // schema's pre('save') totalHours hook, so it's computed here instead.
      const totalHours = parseFloat(((autoClockOut - log.clockInTime) / (1000 * 60 * 60)).toFixed(2));
      const updated = await AttendanceLog.findOneAndUpdate(
        { _id: log._id, clockOutTime: { $exists: false } },
        {
          clockOutTime: autoClockOut,
          totalHours,
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

  if (closed > 0) console.log(`[AutoClockOut] Closed ${closed} stale attendance log(s).`);
  return { closed };
}

module.exports = { runAutoClockOutSweep };
