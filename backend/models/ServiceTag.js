const mongoose = require('mongoose');

// What a clock-in's hours get billed against — housekeeping, security,
// maintenance, etc. This is the field a facility company's client invoice
// is actually built from.
const serviceTagSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('ServiceTag', serviceTagSchema);
