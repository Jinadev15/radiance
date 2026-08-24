const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Minimum 10, not 6. These accounts can read every employee's record and
// edit payroll; a six-character password is not a meaningful barrier.
const MIN_PASSWORD_LENGTH = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  password: { type: String, required: true, minlength: MIN_PASSWORD_LENGTH },
  role: { type: String, enum: ['admin', 'hr', 'supervisor'], default: 'hr' },
  // Only meaningful for 'supervisor' — scopes their dashboard view to one site.
  workLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkLocation', default: null },
  isActive: { type: Boolean, default: true },

  // Set on any admin-created or admin-reset account. The login still
  // succeeds, but the dashboard forces a change before anything else — which
  // is what makes it safe to hand someone an initial password at all, and
  // what stops a shared starter credential quietly becoming permanent.
  mustChangePassword: { type: Boolean, default: false },
  passwordChangedAt: { type: Date, default: null },

  // Per-account lockout. The route-level rate limiter is per-IP, so it does
  // nothing against attempts spread across many addresses at one known email.
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
}, { timestamps: true });

// Hash password before saving — ONLY if modified
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    this.passwordChangedAt = new Date();
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isLocked = function () {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
};

// A true atomic $inc, not read-this.failedLoginAttempts-then-write. Two
// failed attempts arriving close together (the exact shape of a real
// credential-stuffing attempt) must both be counted — computing the new
// value from the in-memory document would let a second concurrent request
// silently overwrite the first's increment with the same stale count.
userSchema.methods.registerFailedLogin = async function () {
  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    { $inc: { failedLoginAttempts: 1 } },
    { new: true }
  );
  if (updated && updated.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    await this.constructor.updateOne(
      { _id: this._id },
      { $set: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000), failedLoginAttempts: 0 } }
    );
  }
};

userSchema.methods.registerSuccessfulLogin = async function () {
  await this.constructor.updateOne(
    { _id: this._id },
    { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } }
  );
};

// Never return password in JSON
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.failedLoginAttempts;
  delete obj.lockedUntil;
  return obj;
};

// Rejects the passwords that actually show up in breach lists, not just short
// ones. Returns null when acceptable, or a message to show the user.
userSchema.statics.validatePasswordStrength = function (password, { email, name } = {}) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return 'Password is too long.';
  const lower = password.toLowerCase();
  const banned = [
    'password', '123456', 'qwerty', 'admin', 'welcome', 'letmein',
    'radiance', 'attendance', 'iloveyou', 'abc123', '111111', 'changeme',
  ];
  if (banned.some(b => lower.includes(b))) {
    return 'That password is too easy to guess. Please choose something less predictable.';
  }
  // Guard the minimum length: a one- or two-character local part (e.g.
  // "a@b.com" -> "a") would match almost any password containing that
  // letter and reject good passwords for no real reason.
  const localPart = email ? String(email).split('@')[0].toLowerCase() : '';
  if (localPart.length >= 3 && lower.includes(localPart)) {
    return 'Password must not contain your email address.';
  }
  if (name && String(name).trim().length > 2 && lower.includes(String(name).trim().toLowerCase())) {
    return 'Password must not contain your name.';
  }
  if (/^(.)\1+$/.test(password)) return 'Password must not be a single repeated character.';
  return null;
};

userSchema.statics.MIN_PASSWORD_LENGTH = MIN_PASSWORD_LENGTH;
userSchema.statics.LOCK_MINUTES = LOCK_MINUTES;
userSchema.statics.MAX_FAILED_ATTEMPTS = MAX_FAILED_ATTEMPTS;

module.exports = mongoose.model('User', userSchema);
