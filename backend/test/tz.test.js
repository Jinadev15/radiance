// Timezone helpers, run under a UTC process clock — the exact condition that
// made every time in the system wrong by 5h30m before this file existed.
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const tz = require('../utils/tz');

test('businessDate/businessTime treat a UTC-morning instant as the correct IST wall clock', () => {
  // 09:05 IST == 03:35 UTC
  const morning = new Date('2026-08-24T03:35:00Z');
  assert.equal(tz.businessDate(morning), '2026-08-24');
  assert.equal(tz.businessTime(morning), '09:05');
  assert.equal(tz.minutesSinceMidnight(morning), 9 * 60 + 5);
});

test('a pre-dawn IST instant does not fall on the previous UTC calendar day', () => {
  // 04:00 IST on 24 Aug == 22:30 UTC on 23 Aug — the classic off-by-one-day bug.
  const preDawn = new Date('2026-08-23T22:30:00Z');
  assert.equal(tz.businessDate(preDawn), '2026-08-24');
  assert.equal(tz.businessTime(preDawn), '04:00');
});

test('instantFromZonedParts round-trips through businessTime', () => {
  const inst = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 21, minute: 0 });
  assert.equal(inst.toISOString(), '2026-08-24T15:30:00.000Z');
  assert.equal(tz.businessTime(inst), '21:00');
});

test('startOfBusinessDay / endOfBusinessDay bound exactly one IST calendar day', () => {
  assert.equal(tz.startOfBusinessDay('2026-08-24').toISOString(), '2026-08-23T18:30:00.000Z');
  assert.equal(tz.endOfBusinessDay('2026-08-24').toISOString(), '2026-08-24T18:30:00.000Z');
});

test('addBusinessDays crosses month and year boundaries correctly', () => {
  assert.equal(tz.addBusinessDays('2026-08-31', 1), '2026-09-01');
  assert.equal(tz.addBusinessDays('2026-01-01', -1), '2025-12-31');
});

test('parseHHMM validates strictly and rejects garbage without throwing', () => {
  assert.equal(tz.parseHHMM('06:00'), 360);
  assert.equal(tz.parseHHMM('99:99'), null);
  assert.equal(tz.parseHHMM('not-a-time'), null);
  assert.equal(tz.parseHHMM(undefined), null);
});

test('businessDayOfWeek is computed in the business timezone, not the server one', () => {
  const monday0905IST = new Date('2026-08-24T03:35:00Z');
  assert.equal(tz.businessDayOfWeek(monday0905IST), 1); // Monday
});

test('DST-observing zones still round-trip correctly (sanity check for non-IST deployments)', () => {
  const pre = tz.instantFromZonedParts({ year: 2026, month: 3, day: 7, hour: 12, minute: 0 }, 'America/New_York');
  const post = tz.instantFromZonedParts({ year: 2026, month: 3, day: 9, hour: 12, minute: 0 }, 'America/New_York');
  assert.equal(tz.businessTime(pre, 'America/New_York'), '12:00');
  assert.equal(tz.businessTime(post, 'America/New_York'), '12:00');
});
