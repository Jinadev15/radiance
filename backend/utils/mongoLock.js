// Cross-process mutual exclusion, backed by MongoDB.
//
// Replaces the previous in-process promise-chain mutex. That version was
// honest about its own limitation: it serialises only within a single Node
// process, so the moment the backend runs two instances (any horizontal
// scale, or a rolling deploy where old and new overlap) two simultaneous
// registrations of the same face can both pass the duplicate-face check
// before either has saved — producing exactly the two-profiles-one-person
// setup that check exists to prevent.
//
// Implementation: acquire by inserting a uniquely-keyed document, release by
// deleting it. A TTL index reaps locks orphaned by a crashed process, so a
// hard kill mid-critical-section can't wedge registration permanently.
const mongoose = require('mongoose');

const lockSchema = new mongoose.Schema({
  _id: { type: String, required: true },        // the lock name
  owner: { type: String, required: true },       // for diagnosing a stuck lock
  expiresAt: { type: Date, required: true },
}, { versionKey: false });

// Mongo's TTL monitor runs about once a minute, so a lock can outlive its
// expiry by up to that long. acquire() also deletes expired rows explicitly
// (below) so waiting callers never have to sit through that window.
lockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Lock = mongoose.models.Lock || mongoose.model('Lock', lockSchema);

const DUPLICATE_KEY = 11000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function ownerTag() {
  return `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run `fn` while holding a named lock.
 *
 * @param {string} name          lock key, e.g. 'employee-face-enrolment'
 * @param {Function} fn          the critical section
 * @param {object}  [options]
 * @param {number}  [options.ttlMs=15000]     how long the lock may be held before
 *                                            it is considered abandoned. Must
 *                                            exceed the worst-case runtime of
 *                                            `fn` (here: two ML round trips).
 * @param {number}  [options.waitMs=12000]    how long to wait to acquire it.
 * @param {number}  [options.pollMs=120]      retry interval while waiting.
 */
async function withLock(name, fn, { ttlMs = 15000, waitMs = 12000, pollMs = 120 } = {}) {
  // Without a database there is nothing to serialise against — and the
  // callers that use this lock all bail out on a disconnected database
  // anyway, so run the section rather than failing on the lock itself.
  if (mongoose.connection.readyState !== 1) return fn();

  const owner = ownerTag();
  const deadline = Date.now() + waitMs;
  let held = false;

  while (!held) {
    try {
      await Lock.create({ _id: name, owner, expiresAt: new Date(Date.now() + ttlMs) });
      held = true;
    } catch (err) {
      if (err && err.code === DUPLICATE_KEY) {
        // Someone holds it. Clear it if it has expired (don't wait on the TTL
        // monitor), then retry. The `expiresAt` condition makes this safe
        // against deleting a live holder's lock.
        await Lock.deleteOne({ _id: name, expiresAt: { $lte: new Date() } }).catch(() => {});
        if (Date.now() >= deadline) {
          const timeout = new Error(`Timed out acquiring lock "${name}"`);
          timeout.code = 'LOCK_TIMEOUT';
          throw timeout;
        }
        await sleep(pollMs);
        continue;
      }
      throw err;
    }
  }

  try {
    return await fn();
  } finally {
    // Scoped to this owner so a slow section that overran its TTL — and was
    // therefore reaped and re-acquired by someone else — cannot release the
    // new holder's lock on its way out.
    await Lock.deleteOne({ _id: name, owner }).catch(() => {});
  }
}

module.exports = { withLock, Lock };
