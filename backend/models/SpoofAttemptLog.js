const mongoose = require('mongoose');

// Audit trail for failed liveness checks. Deliberately separate from
// AttendanceLog — it has no unique-per-day constraint and never blocks a
// legitimate clock-in, it just gives admins visibility into who's being
// impersonated and how often.
const spoofAttemptLogSchema = new mongoose.Schema({
  targetedEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  workLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkLocation' },
  action: { type: String, enum: ['CLOCK_IN', 'CLOCK_OUT'], required: true },
  confidence: { type: Number, min: 0, max: 1 },
  livenessDetails: { type: String },
  latitude: { type: Number },
  longitude: { type: Number },
}, { timestamps: true });

spoofAttemptLogSchema.index({ targetedEmployee: 1, createdAt: -1 });

module.exports = mongoose.model('SpoofAttemptLog', spoofAttemptLogSchema);
