// User model: password strength, lockout after repeated failures.
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/testdb');

let User;

test.before(async () => {
  await db.start();
  User = require('../models/User');
});
test.after(async () => db.stop());
test.beforeEach(async () => db.reset());

test('password strength rejects short, common, and email/name-containing passwords', () => {
  assert.ok(User.validatePasswordStrength('short1'));
  assert.ok(User.validatePasswordStrength('password123'));
  assert.equal(User.validatePasswordStrength('correcthorsebattery9', { email: 'user@example.com', name: 'A' }), null);
  assert.ok(User.validatePasswordStrength('jinadev12345678', { email: 'jinadev@example.com' }));
});

test('an account locks after MAX_FAILED_ATTEMPTS and reports remaining lock time', async () => {
  const user = await User.create({
    name: 'Test Admin', email: 'lock-test@example.com',
    password: 'a-strong-password-99', role: 'admin',
  });

  for (let i = 0; i < User.MAX_FAILED_ATTEMPTS - 1; i++) {
    await user.registerFailedLogin();
  }
  let reloaded = await User.findById(user._id);
  assert.equal(reloaded.isLocked(), false, 'should not be locked before the threshold');

  await reloaded.registerFailedLogin();
  reloaded = await User.findById(user._id);
  assert.equal(reloaded.isLocked(), true, 'should be locked exactly at the threshold');
  assert.ok(reloaded.lockedUntil > new Date());
});

test('a successful login clears the failure counter and any lock', async () => {
  const user = await User.create({
    name: 'Test Admin 2', email: 'lock-test-2@example.com',
    password: 'another-strong-password-1', role: 'admin',
  });
  for (let i = 0; i < User.MAX_FAILED_ATTEMPTS; i++) {
    const fresh = await User.findById(user._id);
    await fresh.registerFailedLogin();
  }
  let locked = await User.findById(user._id);
  assert.equal(locked.isLocked(), true);

  await locked.registerSuccessfulLogin();
  const cleared = await User.findById(user._id);
  assert.equal(cleared.isLocked(), false);
  assert.equal(cleared.failedLoginAttempts, 0);
});

test('password is hashed, never stored in plaintext, and comparePassword works', async () => {
  const user = await User.create({
    name: 'Hash Test', email: 'hash-test@example.com',
    password: 'a-genuinely-strong-pw-1', role: 'hr',
  });
  assert.notEqual(user.password, 'a-genuinely-strong-pw-1');
  assert.ok(await user.comparePassword('a-genuinely-strong-pw-1'));
  assert.equal(await user.comparePassword('wrong-password'), false);
});
