const mongoose = require('mongoose');

// An employee's self-reported "I forgot to scan" / "wrong time" flag, filed
// from the kiosk. Doesn't touch AttendanceLog on its own — an admin reviews
// it, then makes the actual correction (see PUT /api/v1/attendance/:id/manual).
const regularizationRequestSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: String, required: true }, // 'YYYY-MM-DD', the day being disputed
  reason: { type: String, required: true, trim: true },
  requestedClockIn: { type: String }, // free-text "what time I actually arrived", HH:MM
  requestedClockOut: { type: String },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewNote: { type: String },
  reviewedAt: { type: Date },
}, { timestamps: true });

regularizationRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('RegularizationRequest', regularizationRequestSchema);
