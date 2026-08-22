// Minimal process-wide async mutex. Used to close the TOCTOU gap in
// registration's duplicate-face check: without it, two concurrent
// registrations for the same face (different phone/Aadhaar numbers) can
// both pass findDuplicateFace() before either has saved, producing two
// active profiles for one face — exactly the "buddy punching" setup the
// check exists to prevent. Mongo has no easy uniqueness constraint over
// face embeddings, so the check-then-insert sequence is serialized here
// instead. Scoped to a single Node process — a multi-instance deployment
// would need a distributed lock (e.g. a Mongo-backed one) instead, but a
// single-process deployment is the realistic case at this scale.
let tail = Promise.resolve();

function withLock(fn) {
  const run = tail.then(fn, fn);
  // Swallow rejections in the chain itself so one failed call doesn't wedge
  // the queue for everyone after it — the caller still sees the real error
  // via the returned promise.
  tail = run.then(() => {}, () => {});
  return run;
}

module.exports = { withLock };
