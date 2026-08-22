const mongoose = require('mongoose');

// Counter schema for atomic ID generation
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

const employeeSchema = new mongoose.Schema({
  employeeId: { type: String, unique: true },
  name: { type: String, required: true, trim: true },
  phone: { 
    type: String, 
    required: true, 
    unique: true, 
    match: [/^\d{10}$/, 'Phone must be 10 digits'] 
  },
  nationalId: { 
    type: String, 
    required: true, 
    unique: true, 
    match: [/^\d{12}$/, 'Aadhaar must be exactly 12 digits'] 
  },
  dateOfBirth: { type: Date, required: true },
  faceEmbedding: { 
    type: [Number],
    validate: {
      validator: function(v) {
        return v.length === 0 || v.length === 128 || v.length === 512;
      },
      message: 'Face embedding must be 128 or 512 dimensions'
    }
  },
  workLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkLocation' },
  shiftTemplate: { type: mongoose.Schema.Types.ObjectId, ref: 'ShiftTemplate', default: null },
  serviceTag: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceTag', default: null }, // what's billed for their hours
  contractor: { type: mongoose.Schema.Types.ObjectId, ref: 'Contractor', default: null }, // null = direct hire
  documents: [{
    name: { type: String, required: true, trim: true }, // e.g. "Police Verification", "ID Proof"
    expiryDate: { type: Date },
  }],
  consent: {
    consentedAt: { type: Date },
    purpose: { type: String, default: 'Biometric attendance tracking (face recognition, GPS clock-in/out)' },
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

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

// Mask Aadhaar — show only last 4 digits
employeeSchema.methods.getMaskedNationalId = function() {
  return `XXXX-XXXX-${this.nationalId.slice(-4)}`;
};

module.exports = mongoose.model('Employee', employeeSchema);