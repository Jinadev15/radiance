const mongoose = require('mongoose');

// A sub-agency Radiance staffs through, if any — most facility companies run
// a mix of directly-employed staff and contracted labor. Employees without a
// contractor are simply direct hires; this is optional, not a forced model.
const contractorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  contactPhone: { type: String, trim: true },
  workLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkLocation' }, // site this contractor supplies staff to
  headcountCap: { type: Number, min: 1 }, // optional — null means uncapped
  documents: [{
    name: { type: String, required: true, trim: true },
    expiryDate: { type: Date },
  }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Contractor', contractorSchema);
