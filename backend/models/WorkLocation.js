const mongoose = require('mongoose');

const workLocationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  address: { type: String, required: true },
  latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 },
  radiusMeters: { type: Number, default: 150, min: 50, max: 5000 },
  shiftStart: { type: String, required: true, default: '09:00' },
  shiftEnd: { type: String, required: true, default: '17:00' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('WorkLocation', workLocationSchema);