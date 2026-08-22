const mongoose = require('mongoose');

const attendanceLogSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { 
    type: String,  // Store as 'YYYY-MM-DD' string — guaranteed uniqueness per day
    required: true 
  },
  clockInTime: { type: Date, required: true },
  clockOutTime: { type: Date },
  clockInLatitude: { type: Number },
  clockInLongitude: { type: Number },
  clockOutLatitude: { type: Number },
  clockOutLongitude: { type: Number },
  totalHours: { type: Number },
  status: { 
    type: String, 
    enum: ['VALID', 'LATE', 'EARLY_DEPARTURE', 'LOCATION_MISMATCH', 'SPOOF_ATTEMPT'],
    required: true 
  },
  confidence: { type: Number, min: 0, max: 1 },
  livenessScore: { type: Number },
  markedBy: { type: String, enum: ['AUTO', 'MANUAL'], default: 'AUTO' },
  notes: { type: String },
  // Denormalized at clock-in time so billing reports stay accurate even if
  // the employee's site/service assignment changes later.
  siteName: { type: String },
  service: { type: String },
}, { timestamps: true });

// Unique: one record per employee per day (date is 'YYYY-MM-DD' string)
attendanceLogSchema.index({ employee: 1, date: 1 }, { unique: true });
// Index for date queries (dashboard filtering)
attendanceLogSchema.index({ date: 1, status: 1 });

// Auto-calculate total hours when clockOut is set
attendanceLogSchema.pre('save', function(next) {
  if (this.clockOutTime && this.clockInTime) {
    const diffMs = this.clockOutTime - this.clockInTime;
    this.totalHours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
  }
  next();
});

module.exports = mongoose.model('AttendanceLog', attendanceLogSchema);