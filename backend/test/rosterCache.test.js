// utils/rosterCache.js — the version identity that decides when the ML
// service's resident embedding cache must be rebuilt.
//
// Two failure modes this guards, both of which are silent rather than loud:
//   * a roster or model change that does NOT bump the version would leave the
//     ML service matching against stale data — letting a deactivated employee
//     keep clocking in, or comparing vectors from an incompatible model
//   * a version that changes when nothing meaningful did would re-push
//     megabytes of embeddings on every reconcile
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeVersion } = require('../utils/rosterCache');

const MODEL = 'arcface-mbf-w600k-v1';

function row(id, overrides = {}) {
  return {
    _id: id,
    workLocation: 'site-1',
    faceEmbeddings: [[0.1, 0.2]],
    faceEnrolledAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const BASE = [row('a'), row('b'), row('c')];

test('the same roster and model always produce the same version', () => {
  assert.equal(computeVersion(BASE, MODEL), computeVersion(BASE, MODEL));
});

test('query ordering does not change the version', () => {
  // Mongo makes no ordering promise; a spurious version change here would
  // re-push the whole roster on every reconcile.
  assert.equal(computeVersion([...BASE].reverse(), MODEL), computeVersion(BASE, MODEL));
});

test('a different recognition model produces a different version', () => {
  // Embeddings are not comparable across models, so a model change must
  // rebuild the cache rather than silently reuse vectors from another space.
  assert.notEqual(computeVersion(BASE, 'sface-v1'), computeVersion(BASE, MODEL));
});

test('removing an employee changes the version', () => {
  // The case that matters most: a deactivated employee must stop matching.
  assert.notEqual(computeVersion(BASE.slice(1), MODEL), computeVersion(BASE, MODEL));
});

test('adding an employee changes the version', () => {
  assert.notEqual(computeVersion([...BASE, row('d')], MODEL), computeVersion(BASE, MODEL));
});

test('re-enrolling a face changes the version', () => {
  const reEnrolled = [row('a', { faceEnrolledAt: new Date('2026-06-01T00:00:00Z') }), BASE[1], BASE[2]];
  assert.notEqual(computeVersion(reEnrolled, MODEL), computeVersion(BASE, MODEL));
});

test('adding a second capture to one employee changes the version', () => {
  const extraCapture = [row('a', { faceEmbeddings: [[0.1, 0.2], [0.3, 0.4]] }), BASE[1], BASE[2]];
  assert.notEqual(computeVersion(extraCapture, MODEL), computeVersion(BASE, MODEL));
});

test('reassigning someone to another site changes the version', () => {
  // The per-site index inside the cache is built from this, so a stale one
  // would scope a scan against the wrong site's roster.
  const moved = [row('a', { workLocation: 'site-2' }), BASE[1], BASE[2]];
  assert.notEqual(computeVersion(moved, MODEL), computeVersion(BASE, MODEL));
});

test('the version encodes the roster size, so an emptied roster is obvious', () => {
  assert.match(computeVersion(BASE, MODEL), /^3-[0-9a-f]{16}$/);
  assert.match(computeVersion([], MODEL), /^0-[0-9a-f]{16}$/);
});
