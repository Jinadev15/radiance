const mongoose = require('mongoose');

// Approved leave, so "absent" can stop meaning four different things.
//
// Without this, `absent = totalEmployees - presentToday` counted approved
// leave, weekly offs and public holidays as absence — which meant the daily
// digest emailed HR a list of people who were legitimately off, and Sunday
// reported the entire workforce as missing. Leave is also most of what an HR
// team actually spends its day on, so a system with no concept of it is not
// one they can adopt.
const LEAVE_TYPES = ['CASUAL', 'SICK', 'UNPAID', 'COMP_OFF', 'MATERNITY', 'OTHER'];

const leaveRequestSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  leaveType: { type: String, enum: LEAVE_TYPES, required: true },
  // Inclusive 'YYYY-MM-DD' business dates. Stored as strings for the same
  // reason AttendanceLog.date is: a Date would reintroduce the timezone
  // ambiguity this whole change set exists to remove.
  fromDate: { type: String, required: true, match: [/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'] },
  toDate: { type: String, required: true, match: [/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'] },
  isHalfDay: { type: Boolean, default: false },
  reason: { type: String, required: true, trim: true, maxlength: 500 },

  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], default: 'PENDING', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewNote: { type: String, default: null },
  reviewedAt: { type: Date, default: null },

  // How it arrived: a kiosk face-scan by the employee, or entered by HR.
  source: { type: String, enum: ['KIOSK', 'DASHBOARD'], default: 'KIOSK' },
}, { timestamps: true });

leaveRequestSchema.index({ status: 1, createdAt: -1 });
// The "is this person on approved leave on date X?" lookup, which runs for
// every employee on every dashboard stats call.
leaveRequestSchema.index({ employee: 1, status: 1, fromDate: 1, toDate: 1 });

leaveRequestSchema.statics.LEAVE_TYPES = LEAVE_TYPES;

// Employees on approved leave covering `dateStr`, as a Set of id strings.
// One query for the whole roster rather than one per employee.
leaveRequestSchema.statics.approvedOnDate = async function (dateStr, employeeIds = null) {
  const filter = {
    status: 'APPROVED',
    fromDate: { $lte: dateStr },
    toDate: { $gte: dateStr },
  };
  if (employeeIds) filter.employee = { $in: employeeIds };
  const rows = await this.find(filter).select('employee').lean();
  return new Set(rows.map(r => String(r.employee)));
};

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
