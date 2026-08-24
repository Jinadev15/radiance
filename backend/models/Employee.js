const mongoose = require('mongoose');
const { hashNationalId, last4 } = require('../utils/nationalId');

// Counter schema for atomic ID generation
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

// Employee lifecycle. Replaces a bare `isActive` boolean because "waiting for
// HR to approve this kiosk self-registration" is a genuinely different state
// from "used to work here". Anyone can walk up to a public kiosk URL and
// register, so a self-registration must not be able to clock in until a
// human has confirmed the person actually works for the company.
const STATUS = {
  PENDING: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  REJECTED: 'REJECTED',
};

const employeeSchema = new mongoose.Schema({
  employeeId: { type: String, unique: true },
  name: { type: String, required: true, trim: true },

  // Deliberately NOT unique. Low-wage and contract workers routinely share a
  // household phone, and a unique constraint here blocked the second genuine
  // employee on that number from registering at all — with an error that read
  // like an accusation of duplication. Uniqueness belongs on the national ID.
  phone: {
    type: String,
    required: true,
    index: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits']
  },

  // Aadhaar and equivalents are never stored in full.
  //
  // The Aadhaar Act restricts storing Aadhaar numbers, and the DPDP Act 2023
  // treats them (and face biometrics) as personal data requiring purpose
  // limitation and safeguards. A plaintext 12-digit number sitting in the
  // database, in every backup, and in any dump is a liability with no
  // upside: uniqueness works just as well on a keyed hash, and HR only ever
  // needs the last four digits to eyeball a record.
  idType: { type: String, enum: ['AADHAAR', 'VOTER_ID', 'PAN', 'DRIVING_LICENCE', 'OTHER'], default: 'AADHAAR' },
  nationalIdHash: { type: String, required: true, unique: true, index: true },
  nationalIdLast4: { type: String, required: true, match: [/^\d{4}$/, 'Last 4 digits required'] },

  dateOfBirth: { type: Date, required: true },

  // Several embeddings per person, not one.
  //
  // A single enrolment capture bakes in one angle and one lighting condition.
  // Matching against the best of a handful is markedly more reliable, and it
  // means one poor capture is no longer permanently fatal for that employee.
  faceEmbeddings: {
    type: [[Number]],
    default: [],
    validate: {
      validator: function (v) {
        if (!Array.isArray(v)) return false;
        if (v.length > 10) return false; // bound the payload sent to the matcher
        return v.every(e => Array.isArray(e) && (e.length === 128 || e.length === 512));
      },
      message: 'Each face embedding must be 128 or 512 dimensions (max 10 per employee)'
    }
  },
  faceEnrolledAt: { type: Date, default: null },
  faceEnrolledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  workLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkLocation', default: null, index: true },
  shiftTemplate: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftTemplate', default: null },
  serviceTag: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceTag', default: null }, // what's billed for their hours
  contractor: { type: mongoose.Schema.Types.ObjectId, ref: 'Contractor', default: null }, // null = direct hire

  // Days this employee is not expected in. 0 = Sunday … 6 = Saturday.
  // Without this, every Sunday reported the entire workforce as absent and
  // the daily digest emailed HR a list of people who were legitimately off.
  weeklyOff: {
    type: [Number],
    default: [0],
    validate: {
      validator: v => Array.isArray(v) && v.every(d => Number.isInteger(d) && d >= 0 && d <= 6),
      message: 'weeklyOff must be day numbers 0 (Sunday) to 6 (Saturday)'
    }
  },

  documents: [{
    name: { type: String, required: true, trim: true }, // e.g. "Police Verification", "ID Proof"
    expiryDate: { type: Date },
  }],

  consent: {
    consentedAt: { type: Date },
    purpose: { type: String, default: 'Biometric attendance tracking (face recognition, GPS clock-in/out)' },
    policyVersion: { type: String, default: null },
    withdrawnAt: { type: Date, default: null },
  },

  status: {
    type: String,
    enum: Object.values(STATUS),
    default: STATUS.PENDING,
    index: true,
  },
  // Who let this person in, and when — the approval is a payroll-relevant
  // decision, so it is attributable.
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null },
  deactivatedAt: { type: Date, default: null },
  // Set when biometrics are erased under a deletion request or the retention
  // policy, while attendance history is kept for payroll.
  biometricsErasedAt: { type: Date, default: null },
}, { timestamps: true });

// Roster lookups almost always want "the people who can clock in right now".
employeeSchema.index({ status: 1, workLocation: 1 });

// Atomic auto-increment using a counter document — race-condition safe
employeeSchema.pre('save', async function(next) {
  if (this.isNew && !this.employeeId) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'employeeId' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      this.employeeId = `EMP-${counter.seq.toString().padStart(3, '0')}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

// Only ever shows the stored last four — the full number no longer exists.
employeeSchema.methods.getMaskedNationalId = function() {
  return `XXXX-XXXX-${this.nationalIdLast4 || '????'}`;
};

employeeSchema.methods.hasBiometrics = function () {
  return Array.isArray(this.faceEmbeddings) && this.faceEmbeddings.length > 0;
};

// Convenience for templates/JSON without exposing the status enum everywhere.
employeeSchema.virtual('isActive').get(function () {
  return this.status === STATUS.ACTIVE;
});
employeeSchema.set('toJSON', { virtuals: true });
employeeSchema.set('toObject', { virtuals: true });

// Never let raw embeddings or the id hash leave the API, whatever a route
// forgets to `.select('-...')`. Defence in depth against accidental exposure
// of biometric data through a new endpoint.
employeeSchema.methods.toSafeJSON = function () {
  const obj = this.toObject();
  delete obj.faceEmbeddings;
  delete obj.nationalIdHash;
  obj.nationalId = this.getMaskedNationalId();
  obj.hasBiometrics = this.hasBiometrics();
  return obj;
};

// Three distinct filters, deliberately not one — "can this person clock in",
// "should this person count in today's roster", and "is this a confirmed
// employee" are three different questions once PENDING_APPROVAL is allowed
// to work.
//
// A self-registered employee can clock in and appear as present from day
// one — HR reviewing the registration is a payroll gate (approval is what's
// needed "before putting salary"), not an attendance gate. REJECTED is the
// one status that means a human looked at this and said no; it's excluded
// everywhere below.
employeeSchema.statics.STATUS = STATUS;

// "Confirmed employee" lists — the default Employees view, contractor
// headcount caps, anything that means "this person is a settled member of
// staff", not "anyone currently allowed to badge in".
employeeSchema.statics.activeFilter = function (extra = {}) {
  return { status: STATUS.ACTIVE, ...extra };
};

// Candidates the face matcher should consider at clock-in/out: active OR
// still-pending-approval, as long as they're actually enrolled. This is what
// lets a newly self-registered employee clock in again the next day without
// waiting on HR.
employeeSchema.statics.matchableFilter = function (extra = {}) {
  return {
    status: { $in: [STATUS.ACTIVE, STATUS.PENDING] },
    faceEmbeddings: { $exists: true, $not: { $size: 0 } },
    ...extra,
  };
};

// The roster attendance/stats/the daily digest are computed against — anyone
// currently expected to be able to show up, active or pending. Using
// activeFilter here instead would make a pending employee's attendance
// exist in AttendanceLog while being invisible on the dashboard: their scan
// recorded, but nothing counting them as present.
employeeSchema.statics.rosterFilter = function (extra = {}) {
  return { status: { $in: [STATUS.ACTIVE, STATUS.PENDING] }, ...extra };
};

// Re-exported so callers can hash a submitted ID without importing the util
// separately (keeps the "how do we look this person up" logic in one place).
employeeSchema.statics.hashNationalId = hashNationalId;
employeeSchema.statics.last4 = last4;

module.exports = mongoose.model('Employee', employeeSchema);
