const mongoose = require('mongoose');

const shiftTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, // e.g. "Day Shift", "Night Security"
  startTime: { type: String, required: true, match: [/^\d{2}:\d{2}$/, 'Use HH:MM format'] },
  endTime: { type: String, required: true, match: [/^\d{2}:\d{2}$/, 'Use HH:MM format'] },
  graceMinutes: { type: Number, default: 10, min: 0, max: 120 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// A night shift (e.g. 21:00 -> 06:00) crosses midnight when endTime is
// numerically before startTime. Computed on read so it's never out of sync
// with the actual times.
shiftTemplateSchema.virtual('crossesMidnight').get(function () {
  return this.endTime < this.startTime;
});
shiftTemplateSchema.set('toJSON', { virtuals: true });
shiftTemplateSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('ShiftTemplate', shiftTemplateSchema);
