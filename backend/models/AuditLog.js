const mongoose = require('mongoose');

// Who changed what, when.
//
// Attendance records decide what people get paid, so every human edit has to
// be attributable. The previous implementation stamped corrections with the
// actor's *role* ("manually corrected by admin"), which made every
// administrator indistinguishable — when a worker disputed their hours there
// was no way to say who had changed the record or what it said before.
//
// Append-only by convention: nothing in the app updates or deletes these.
const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Denormalised so the trail stays readable after a user is deactivated or
  // renamed — the whole point is to be legible months later.
  actorName: { type: String, default: null },
  actorEmail: { type: String, default: null },
  actorRole: { type: String, default: null },

  action: { type: String, required: true, index: true },

  targetModel: { type: String, default: null },
  targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // Human-readable identifier for the thing touched (employee name + code,
  // site name) so a reader doesn't have to resolve ObjectIds by hand.
  targetLabel: { type: String, default: null },

  // Only the fields that actually changed, not whole documents — keeps these
  // rows small and stops biometric/ID data leaking into the audit trail.
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },

  reason: { type: String, default: null },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetModel: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
