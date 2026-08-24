// utils/mongoLock.js — replaces the process-local promise-chain mutex, which
// was honest about only serialising within one Node process. This is what
// actually stops two concurrent registrations of the same face both passing
// the duplicate check before either has saved.
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/testdb');

let withLock;

test.before(async () => {
  await db.start();
  ({ withLock } = require('../utils/mongoLock'));
});
test.after(async () => db.stop());

test('two concurrent withLock calls on the same name run one at a time', async () => {
  const order = [];
  const task = (id, delayMs) => withLock('test-lock', async () => {
    order.push(`${id}-start`);
    await new Promise(r => setTimeout(r, delayMs));
    order.push(`${id}-end`);
  });

  await Promise.all([task('A', 50), task('B', 10)]);

  // If they ran concurrently, B (shorter delay) would finish before A starts
  // its own end — i.e. we'd see A-start, B-start, B-end, A-end. Serialised,
  // whichever acquires first must fully finish before the other starts.
  const aStart = order.indexOf('A-start');
  const aEnd = order.indexOf('A-end');
  const bStart = order.indexOf('B-start');
  const bEnd = order.indexOf('B-end');

  const aFullyBeforeB = aEnd < bStart;
  const bFullyBeforeA = bEnd < aStart;
  assert.ok(aFullyBeforeB || bFullyBeforeA, `expected non-overlapping execution, got: ${order.join(', ')}`);
});

test('the lock is released even if the critical section throws', async () => {
  await assert.rejects(
    withLock('failing-lock', async () => { throw new Error('boom'); }),
    /boom/
  );
  // If the lock weren't released, this would time out instead of resolving.
  let ran = false;
  await withLock('failing-lock', async () => { ran = true; }, { waitMs: 2000 });
  assert.equal(ran, true);
});

test('different lock names do not block each other', async () => {
  const start = Date.now();
  await Promise.all([
    withLock('lock-a', async () => new Promise(r => setTimeout(r, 60))),
    withLock('lock-b', async () => new Promise(r => setTimeout(r, 60))),
  ]);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 150, `expected concurrent locks to overlap, took ${elapsed}ms`);
});
