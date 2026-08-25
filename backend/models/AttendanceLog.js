const mongoose = require('mongoose');

// One row per *work session*, not per day.
//
// This used to carry a unique index on { employee, date }, i.e. one row per
// person per day. That made three ordinary things impossible: clocking back
// in after a lunch break, working a second shift or overtime block, and
// recovering from tapping "Clock Out" by mistake — all of which surfaced to
// the employee as a bare "Internal server error" from a duplicate-key
// rejection. Sessions are numbered within a business date instead, and the
// uniqueness constraint moved to { employee, date, sessionNumber } so a race
// still can't create two session #2s.
const attendanceLogSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  // 'YYYY-MM-DD' in the *business* timezone (see utils/tz.js) — the day the
  // work happened as the people doing it would name it, not the UTC date.
  date: { type: String, required: true },
  // 1 for the first session of that business date, 2 for the next, etc.
  sessionNumber: { type: Number, required: true, default: 1, min: 1 },

  clockInTime: { type: Date, required: true },
  // Explicitly `null` when open rather than absent, so "still clocked in" is
  // a single queryable value ({ clockOutTime: null }) and the partial index
  // at the bottom of this file actually matches those rows — a
  // partialFilterExpression on null does not match a missing field.
  clockOutTime: { type: Date, default: null },

  // Nullable, not 0. Storing a missing coordinate as 0 put the record in the
  // Atlantic Ocean and made "was this person on site?" unanswerable.
  clockInLatitude: { type: Number, default: null },
  clockInLongitude: { type: Number, default: null },
  clockOutLatitude: { type: Number, default: null },
  clockOutLongitude: { type: Number, default: null },
  // Distance from the assigned site at scan time. Kept even when inside the
  // geofence so HR can review near-boundary patterns rather than only
  // hard blocks.
  clockInDistanceMeters: { type: Number, default: null },
  clockOutDistanceMeters: { type: Number, default: null },
  // The browser's own accuracy estimate for the fix, in metres. Recorded
  // because it is one of the few signals that distinguishes a real GPS
  // reading from a mocked one.
  clockInAccuracyMeters: { type: Number, default: null },
  clockOutAccuracyMeters: { type: Number, default: null },

  // Which phone the scan came from. NOT a security credential — it is a
  // random id the browser stores and anyone can clear. It exists so one
  // handset cannot hold several people clocked in at once, and so "twelve
  // employees scanned from one device today" is visible to HR.
  deviceId: { type: String, default: null, index: true },

  // Advisory signals that the reported position may not be genuine (see
  // utils/locationTrust.js). Never blocks a scan on its own: a false fraud
  // accusation against an honest worker is worse than a missed one, and GPS
  // is genuinely erratic indoors.
  locationFlags: { type: [String], default: [] },

  status: {
    type: String,
    enum: ['VALID', 'LATE', 'EARLY_DEPARTURE', 'LOCATION_MISMATCH', 'SPOOF_ATTEMPT'],
    required: true,
  },

  // Face-match quality, kept per session so recognition drift is visible.
  confidence: { type: Number, min: 0, max: 1 },
  // Gap between the best and second-best candidate. A small margin means the
  // match was nearly a coin flip between two people — the signal that
  // matters most for catching a wrong-person match after the fact.
  matchMargin: { type: Number, default: null },
  livenessScore: { type: Number },

  markedBy: {
    type: String,
    enum: ['AUTO', 'MANUAL', 'OFFLINE_SYNC', 'SUPERVISOR_OVERRIDE', 'AUTO_CLOSED'],
    default: 'AUTO',
  },
  notes: { type: String },

  // Denormalised at clock-in so billing and site scoping stay accurate even
  // if the employee is reassigned later. `workLocation` (the id) is here as
  // well as `siteName` so supervisor scoping can filter on this collection
  // directly instead of first resolving a list of employee ids.
  workLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkLocation', default: null },
  siteName: { type: String },
  service: { type: String },

  // Payroll breakdown, computed once at clock-out (see utils/shiftStatus.js).
  // Frozen onto the row deliberately: editing a shift template next month
  // must not silently rewrite last month's payroll.
  grossMinutes: { type: Number, default: 0 },
  breakMinutes: { type: Number, default: 0 },
  netMinutes: { type: Number, default: 0 },
  regularMinutes: { type: Number, default: 0 },
  overtimeMinutes: { type: Number, default: 0 },
  totalHours: { type: Number, default: 0 },
  regularHours: { type: Number, default: 0 },
  overtimeHours: { type: Number, default: 0 },
  isHalfDay: { type: Boolean, default: false },

  // Which timezone the `date` and the shift decisions were computed in.
  // Without this, a future timezone-policy change makes historic rows
  // impossible to interpret.
  timezone: { type: String, default: null },

  // Set when a human edited this row — the audit trail also records it, but
  // having it inline is what lets the UI flag corrected rows at a glance.
  correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  correctedAt: { type: Date, default: null },
}, { timestamps: true });

// Multiple sessions per day are expected; two rows claiming the *same*
// session number are not.
attendanceLogSchema.index({ employee: 1, date: 1, sessionNumber: 1 }, { unique: true });
// Newest-session-first lookup for an employee (clock-out, kiosk history).
attendanceLogSchema.index({ employee: 1, clockInTime: -1 });
// Dashboard filtering.
attendanceLogSchema.index({ date: 1, status: 1 });
// Supervisor-scoped queries, straight off this collection.
attendanceLogSchema.index({ workLocation: 1, date: 1 });
// The auto-clock-out sweep scans for open sessions; a partial index keeps it
// proportional to the number of *open* rows rather than the whole table.
attendanceLogSchema.index(
  { clockInTime: 1 },
  { partialFilterExpression: { clockOutTime: null } }
);

module.exports = mongoose.model('AttendanceLog', attendanceLogSchema);
