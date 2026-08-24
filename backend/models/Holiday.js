const mongoose = require('mongoose');

// Public and client-specific holidays.
//
// Site-scoped rather than company-wide on purpose: a facility company's
// client sites keep different calendars — a corporate office closes for
// Diwali while a hospital or a residential complex does not. An empty
// `workLocations` array means "applies to every site".
const holidaySchema = new mongoose.Schema({
  // 'YYYY-MM-DD' business date, same convention as AttendanceLog.date.
  date: { type: String, required: true, match: [/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'], index: true },
  name: { type: String, required: true, trim: true },
  workLocations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'WorkLocation' }],
  isPaid: { type: Boolean, default: true },
}, { timestamps: true });

// Same date can carry different entries for different sites, but not a
// duplicate of the same name on the same day.
holidaySchema.index({ date: 1, name: 1 }, { unique: true });

// Site ids (as strings) that are on holiday on `dateStr`, plus a flag for a
// company-wide one. Returned as a Set so the caller can test per employee
// without another round trip.
holidaySchema.statics.onDate = async function (dateStr) {
  const rows = await this.find({ date: dateStr }).select('workLocations').lean();
  const siteIds = new Set();
  let companyWide = false;
  for (const row of rows) {
    if (!row.workLocations || row.workLocations.length === 0) {
      companyWide = true;
    } else {
      row.workLocations.forEach(id => siteIds.add(String(id)));
    }
  }
  return { companyWide, siteIds };
};

module.exports = mongoose.model('Holiday', holidaySchema);
