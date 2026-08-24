// Audit-trail writer.
//
// Deliberately never throws and never blocks the caller's response: failing
// to write an audit row must not fail the operation the user asked for. The
// tradeoff is accepted knowingly — a lost audit row is bad, a payroll
// correction that 500s because the audit collection hiccuped is worse. Write
// failures are logged loudly so they don't pass unnoticed.
const AuditLog = require('../models/AuditLog');

// Keys that must never be copied into an audit row, even if a caller passes a
// whole document by mistake. Biometric templates and ID hashes have no place
// in a trail that more people can read than can read the employee record.
const REDACTED_KEYS = new Set([
  'faceEmbedding', 'faceEmbeddings', 'nationalId', 'nationalIdHash',
  'password', 'token', 'images', 'image', 'imageBase64',
]);

function sanitise(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[nested]';
  if (Array.isArray(value)) {
    if (value.length > 20) return `[${value.length} items]`;
    return value.map(v => sanitise(v, depth + 1));
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Mongoose documents / ObjectIds — keep the readable form, not internals.
    if (typeof value.toHexString === 'function') return value.toHexString();
    const source = typeof value.toObject === 'function' ? value.toObject() : value;
    const out = {};
    for (const [key, val] of Object.entries(source)) {
      if (REDACTED_KEYS.has(key)) continue;
      if (key.startsWith('_') && key !== '_id') continue;
      out[key] = sanitise(val, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

// Pulls the actor from the JWT payload the auth middleware attached, plus the
// request metadata worth having when investigating a disputed change.
function actorFrom(req) {
  const user = req && req.user ? req.user : null;
  return {
    actor: user && user.id ? user.id : null,
    actorName: (user && (user.name || null)) || null,
    actorEmail: (user && (user.email || null)) || null,
    actorRole: (user && user.role) || null,
    ip: req ? (req.ip || (req.headers && req.headers['x-forwarded-for']) || null) : null,
    userAgent: req && req.headers ? String(req.headers['user-agent'] || '').slice(0, 300) : null,
  };
}

/**
 * Record one audited change.
 *
 * @param {object} req                 the Express request (for actor + IP), or null for system actions
 * @param {object} entry
 * @param {string} entry.action        stable slug, e.g. 'attendance.manual_correction'
 * @param {string} [entry.targetModel]
 * @param {*}      [entry.targetId]
 * @param {string} [entry.targetLabel] human-readable name of the thing changed
 * @param {object} [entry.before]      only the fields that changed
 * @param {object} [entry.after]
 * @param {string} [entry.reason]
 */
async function record(req, entry) {
  try {
    const meta = actorFrom(req);
    await AuditLog.create({
      ...meta,
      action: entry.action,
      targetModel: entry.targetModel || null,
      targetId: entry.targetId || null,
      targetLabel: entry.targetLabel || null,
      before: entry.before === undefined ? null : sanitise(entry.before),
      after: entry.after === undefined ? null : sanitise(entry.after),
      reason: entry.reason || null,
    });
  } catch (err) {
    console.error('[Audit] Failed to write audit entry:', entry && entry.action, err.message);
  }
}

// For scheduled jobs and other server-side actors with no request context.
async function recordSystem(entry) {
  return record({ user: { id: null, name: 'system', role: 'system' } }, entry);
}

// Returns only the keys whose value actually changed, so an audit row shows
// the diff rather than a wall of unchanged fields.
//
// `afterDoc` is typically a partial "updates" object built from only the
// fields a PUT request actually supplied (see routes/employees.js) — a field
// simply absent from it means "not part of this edit", not "cleared to
// null". Only a field that is an *own key* of afterDoc is treated as a
// candidate value; a field present nowhere in the update payload is skipped
// entirely rather than reported as changed.
function diff(beforeDoc, afterDoc, fields) {
  const before = {};
  const after = {};
  for (const field of fields) {
    const touched = afterDoc && Object.prototype.hasOwnProperty.call(afterDoc, field);
    if (!touched) continue;

    const b = beforeDoc ? beforeDoc[field] : undefined;
    const a = afterDoc[field];
    const bKey = b instanceof Date ? b.getTime() : String(b);
    const aKey = a instanceof Date ? a.getTime() : String(a);
    if (bKey !== aKey) {
      before[field] = b === undefined ? null : b;
      after[field] = a === undefined ? null : a;
    }
  }
  return Object.keys(after).length ? { before, after } : null;
}

module.exports = { record, recordSystem, diff, ACTIONS: {
  EMPLOYEE_APPROVED: 'employee.approved',
  EMPLOYEE_REJECTED: 'employee.rejected',
  EMPLOYEE_UPDATED: 'employee.updated',
  EMPLOYEE_DEACTIVATED: 'employee.deactivated',
  EMPLOYEE_REACTIVATED: 'employee.reactivated',
  EMPLOYEE_FACE_REENROLLED: 'employee.face_reenrolled',
  EMPLOYEE_BIOMETRICS_ERASED: 'employee.biometrics_erased',
  EMPLOYEE_REGISTERED: 'employee.registered',
  ATTENDANCE_MANUAL: 'attendance.manual_correction',
  ATTENDANCE_OVERRIDE: 'attendance.supervisor_override',
  REGULARIZATION_REVIEWED: 'regularization.reviewed',
  LEAVE_REVIEWED: 'leave.reviewed',
  USER_CREATED: 'user.created',
  USER_DEACTIVATED: 'user.deactivated',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_PASSWORD_RESET: 'user.password_reset',
  SITE_CREATED: 'site.created',
  SITE_UPDATED: 'site.updated',
  SITE_DELETED: 'site.deleted',
  SHIFT_UPDATED: 'shift.updated',
  HOLIDAY_CHANGED: 'holiday.changed',
} };
