// utils/duplicateFaceCheck.js — the check that stops one person holding two
// profiles ("ghost" enrolment, so they can clock in twice).
//
// The property under test is which candidates it compares against. Embeddings
// from different recognition models are not comparable — and the failure is
// silent and in the dangerous direction: an incomparable pair scores low, so a
// real duplicate looks like a new face and the ghost profile gets created.
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/testdb');

let Employee, findDuplicateFace, ml;

const MODEL = 'arcface-mbf-w600k-v1';
const OLD_MODEL = 'sface-v1';
const VEC = () => new Array(512).fill(0.1);

test.before(async () => {
  await db.start();
  Employee = require('../models/Employee');
  ml = require('../utils/mlServiceCall');
  ({ findDuplicateFace } = require('../utils/duplicateFaceCheck'));
});
test.after(async () => db.stop());
test.beforeEach(async () => db.reset());

async function makeEmployee(overrides = {}) {
  return Employee.create({
    name: overrides.name || 'Test Employee',
    phone: overrides.phone || `9${Math.floor(Math.random() * 1e9)}`.padEnd(10, '0').slice(0, 10),
    nationalIdHash: `hash-${Math.random()}`,
    nationalIdLast4: '1234',
    dateOfBirth: new Date('1990-01-01'),
    faceEmbeddings: [VEC()],
    embeddingModel: MODEL,
    status: Employee.STATUS.ACTIVE,
    ...overrides,
  });
}

/** Capture what the matcher was asked to compare against, without a live ML service. */
function stubRecognise(onCall) {
  const original = ml.recognise;
  ml.recognise = async (embedding, candidates, options) => {
    onCall({ embedding, candidates, options });
    return { match: false, matched_id: null, confidence: 0 };
  };
  return () => { ml.recognise = original; };
}

test('only compares against profiles enrolled with the same recognition model', async () => {
  const current = await makeEmployee({ name: 'Current Model', embeddingModel: MODEL });
  const legacy = await makeEmployee({ name: 'Old Model', phone: '9111111111', embeddingModel: OLD_MODEL });

  let seen = null;
  const restore = stubRecognise(({ candidates }) => { seen = Object.keys(candidates); });
  try {
    await findDuplicateFace(VEC(), { embeddingModel: MODEL });
  } finally {
    restore();
  }

  assert.ok(seen.includes(String(current._id)), 'same-model profile is compared');
  assert.ok(
    !seen.includes(String(legacy._id)),
    'a profile from a superseded model must be skipped, not silently mis-compared'
  );
});

test('compares against every model when no model is specified (legacy callers)', async () => {
  await makeEmployee({ embeddingModel: MODEL });
  await makeEmployee({ phone: '9222222222', embeddingModel: OLD_MODEL });

  let count = 0;
  const restore = stubRecognise(({ candidates }) => { count = Object.keys(candidates).length; });
  try {
    await findDuplicateFace(VEC());
  } finally {
    restore();
  }
  assert.equal(count, 2);
});

test('includes deactivated profiles — a returning face is something HR must see', async () => {
  const former = await makeEmployee({
    name: 'Former', phone: '9333333333', status: Employee.STATUS.INACTIVE,
  });

  let seen = null;
  const restore = stubRecognise(({ candidates }) => { seen = Object.keys(candidates); });
  try {
    await findDuplicateFace(VEC(), { embeddingModel: MODEL });
  } finally {
    restore();
  }
  assert.ok(seen.includes(String(former._id)));
});

test('excludes the employee being re-enrolled, or they always collide with themselves', async () => {
  const self = await makeEmployee({ name: 'Re-enrolling' });
  const other = await makeEmployee({ name: 'Other', phone: '9444444444' });

  let seen = null;
  const restore = stubRecognise(({ candidates }) => { seen = Object.keys(candidates); });
  try {
    await findDuplicateFace(VEC(), { excludeEmployeeId: self._id, embeddingModel: MODEL });
  } finally {
    restore();
  }
  assert.ok(!seen.includes(String(self._id)), 'must not match themselves');
  assert.ok(seen.includes(String(other._id)), 'still checks everyone else');
});

test('uses a zero margin — an ambiguous near-match IS the signal here', async () => {
  await makeEmployee();
  let opts = null;
  const restore = stubRecognise(({ options }) => { opts = options; });
  try {
    await findDuplicateFace(VEC(), { embeddingModel: MODEL });
  } finally {
    restore();
  }
  // Clock-in refuses ambiguity; enrolment must catch it instead, so requiring
  // a clear margin here would let the duplicate straight through.
  assert.equal(opts.minMargin, 0);
});

test('returns null without calling the matcher when nothing comparable is enrolled', async () => {
  await makeEmployee({ embeddingModel: OLD_MODEL });

  let called = false;
  const restore = stubRecognise(() => { called = true; });
  try {
    const result = await findDuplicateFace(VEC(), { embeddingModel: MODEL });
    assert.equal(result, null);
  } finally {
    restore();
  }
  assert.equal(called, false, 'no point asking the ML service to compare an empty set');
});
