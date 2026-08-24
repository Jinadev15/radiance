const mongoose = require('mongoose');
const { parseHHMM } = require('../utils/tz');

const shiftTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, // e.g. "Day Shift", "Night Security"
  startTime: { type: String, required: true, match: [/^\d{2}:\d{2}$/, 'Use HH:MM format'] },
  endTime: { type: String, required: true, match: [/^\d{2}:\d{2}$/, 'Use HH:MM format'] },
  graceMinutes: { type: Number, default: 10, min: 0, max: 120 },

  // Payroll parameters. Raw clock-out-minus-clock-in is not a payable number:
  // an unpaid break comes off, hours past the shift length are usually paid at
  // a different rate, and a short attendance is normally settled as a half day
  // rather than as raw hours. Making these explicit per shift is what turns
  // the CSV export from a log dump into something payroll can act on.
  breakMinutes: { type: Number, default: 0, min: 0, max: 240 },
  // Don't deduct the break off a session too short to have contained one —
  // otherwise a 40-minute appearance gets lunch taken off it.
  breakDeductAfterMinutes: { type: Number, default: 300, min: 0 },
  // Null/0 means "derive from the shift's own paid length".
  overtimeAfterMinutes: { type: Number, default: null, min: 0 },
  // Null means "half the shift length".
  halfDayThresholdMinutes: { type: Number, default: null, min: 0 },

  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// A night shift (e.g. 21:00 -> 06:00) crosses midnight when endTime is at or
// before startTime. Computed on read so it can never drift out of sync with
// the actual times. Uses the same parser as the shift-status engine so both
// agree on what a malformed time means.
shiftTemplateSchema.virtual('crossesMidnight').get(function () {
  const start = parseHHMM(this.startTime);
  const end = parseHHMM(this.endTime);
  if (start === null || end === null) return false;
  return end <= start;
});

// Paid-clock length of the shift in minutes, midnight-crossing included.
shiftTemplateSchema.virtual('lengthMinutes').get(function () {
  const start = parseHHMM(this.startTime);
  const end = parseHHMM(this.endTime);
  if (start === null || end === null) return null;
  return end <= start ? (24 * 60 - start + end) : (end - start);
});

shiftTemplateSchema.set('toJSON', { virtuals: true });
shiftTemplateSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('ShiftTemplate', shiftTemplateSchema);
