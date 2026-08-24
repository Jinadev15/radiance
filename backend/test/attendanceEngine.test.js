// Exercises the session engine against a real MongoDB (mongodb-memory-server)
// so the unique-index and concurrency behaviour is genuinely tested, not
// mocked away. Covers the three bugs this rewrite exists to fix:
//   - clocking out then back in used to 500 (one-row-per-day unique index)
//   - an employee with no site used to skip the geofence entirely
//   - an offline-replayed scan used to record the sync time, not the scan time
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/testdb');

let Employee, WorkLocation, ShiftTemplate, AttendanceLog, engine, tz;

test.before(async () => {
  await db.start();
  Employee = require('../models/Employee');
  WorkLocation = require('../models/WorkLocation');
  ShiftTemplate = require('../models/ShiftTemplate');
  AttendanceLog = require('../models/AttendanceLog');
  engine = require('../utils/attendanceEngine');
  tz = require('../utils/tz');
  // The session-uniqueness test relies on the { employee, date, sessionNumber }
  // index actually existing before the concurrent-open race runs.
  await db.ensureIndexes(AttendanceLog, Employee);
});

test.after(async () => db.stop());
test.beforeEach(async () => db.reset());

async function makeSite(overrides = {}) {
  return WorkLocation.create({
    name: 'Anna Nagar Site',
    address: '123 Test Street',
    latitude: 13.0850,
    longitude: 80.2101,
    radiusMeters: 150,
    shiftStart: '09:00',
    shiftEnd: '17:00',
    ...overrides,
  });
}

async function makeEmployee(overrides = {}) {
  return Employee.create({
    name: 'Test Employee',
    phone: '9876543210',
    nationalIdHash: `hash-${Math.random()}`,
    nationalIdLast4: '1234',
    dateOfBirth: new Date('1990-01-01'),
    faceEmbeddings: [new Array(128).fill(0.1)],
    status: Employee.STATUS.ACTIVE,
    approvedAt: new Date(),
    ...overrides,
  });
}

test('clocking out, then clocking back in, opens a second session instead of 500ing', async () => {
  const site = await makeSite();
  const employee = await makeEmployee({ workLocation: site._id });
  employee.workLocation = site; // populate-shaped for the engine

  const at1 = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const geo1 = engine.enforceGeofence(employee, 13.0850, 80.2101, 'clock in');
  const session1 = await engine.openSession({ employee, at: at1, geo: geo1, confidence: 0.9, margin: 0.1, source: 'AUTO' });
  assert.equal(session1.sessionNumber, 1);

  const at1out = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 13, minute: 0 });
  const geoOut = engine.enforceGeofence(employee, 13.0850, 80.2101, 'clock out');
  await engine.closeSession({ session: session1, employee, at: at1out, geo: geoOut });
  assert.ok(session1.clockOutTime);

  // Well past the double-tap window — a genuine second session (lunch break).
  const at2 = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 14, minute: 0 });
  const latest = await engine.findLatestSession(employee._id, at2);
  engine.assertNotDoubleTap(latest, at2); // must not throw

  const geo2 = engine.enforceGeofence(employee, 13.0850, 80.2101, 'clock in');
  const session2 = await engine.openSession({ employee, at: at2, geo: geo2, confidence: 0.9, margin: 0.1, source: 'AUTO' });
  assert.equal(session2.sessionNumber, 2, 'second session on the same day must not collide with the first');

  const totals = await engine.dayTotals(employee._id, session1.date);
  assert.equal(totals.sessions, 2);
});

test('a mistaken double-tap within the cooldown window is refused, not recorded as a new shift', async () => {
  const site = await makeSite();
  const employee = await makeEmployee({ workLocation: site._id });
  employee.workLocation = site;

  const at1 = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const geo1 = engine.enforceGeofence(employee, 13.0850, 80.2101, 'clock in');
  const session1 = await engine.openSession({ employee, at: at1, geo: geo1, confidence: 0.9, source: 'AUTO' });
  const outAt = new Date(at1.getTime() + 60 * 1000);
  await engine.closeSession({ session: session1, employee, at: outAt, geo: geo1 });

  const secondsLater = new Date(outAt.getTime() + 30 * 1000); // 30s after clock-out
  const latest = await engine.findLatestSession(employee._id, secondsLater);
  assert.throws(
    () => engine.assertNotDoubleTap(latest, secondsLater),
    (err) => err.code === 'TOO_SOON_AFTER_CLOCK_OUT'
  );
});

test('an employee with no assigned site is refused, not silently waved through the geofence', async () => {
  const employee = await makeEmployee({ workLocation: null });
  assert.throws(
    () => engine.enforceGeofence(employee, 13.0850, 80.2101, 'clock in'),
    (err) => err.code === 'NO_SITE_ASSIGNED'
  );
});

test('an employee outside the geofence radius is rejected with the distance', async () => {
  const site = await makeSite({ radiusMeters: 100 });
  const employee = await makeEmployee({ workLocation: site._id });
  employee.workLocation = site;
  // ~1.1km away
  assert.throws(
    () => engine.enforceGeofence(employee, 13.0950, 80.2101, 'clock in'),
    (err) => err.code === 'OUTSIDE_GEOFENCE'
  );
});

test('resolveCaptureTime accepts a valid offline-queued timestamp and flags it as OFFLINE_SYNC', () => {
  const now = new Date('2026-08-24T13:00:00Z');
  const capturedAt = new Date('2026-08-24T09:05:00Z').toISOString(); // queued ~4h earlier
  const { at, source } = engine.resolveCaptureTime(capturedAt, now);
  assert.equal(at.toISOString(), '2026-08-24T09:05:00.000Z');
  assert.equal(source, 'OFFLINE_SYNC');
});

test('resolveCaptureTime rejects a capture time in the future (bad device clock)', () => {
  const now = new Date('2026-08-24T13:00:00Z');
  const future = new Date('2026-08-24T14:00:00Z').toISOString();
  assert.throws(() => engine.resolveCaptureTime(future, now), (err) => err.code === 'DEVICE_CLOCK_AHEAD');
});

test('resolveCaptureTime rejects a capture time far too old to be a real offline queue entry', () => {
  const now = new Date('2026-08-24T13:00:00Z');
  const stale = new Date('2026-08-20T09:00:00Z').toISOString();
  assert.throws(() => engine.resolveCaptureTime(stale, now), (err) => err.code === 'CAPTURE_TOO_OLD');
});

test('opening two sessions concurrently for the same employee never collides on sessionNumber', async () => {
  const site = await makeSite();
  const employee = await makeEmployee({ workLocation: site._id });
  employee.workLocation = site;
  const geo = engine.enforceGeofence(employee, 13.0850, 80.2101, 'clock in');

  // Simulate a race: two "clock-in" calls landing at nearly the same instant.
  const at = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const [s1, s2] = await Promise.all([
    engine.openSession({ employee, at, geo, confidence: 0.9, source: 'AUTO' }),
    engine.openSession({ employee, at: new Date(at.getTime() + 1), geo, confidence: 0.9, source: 'AUTO' }),
  ]);
  const numbers = [s1.sessionNumber, s2.sessionNumber].sort();
  assert.deepEqual(numbers, [1, 2], 'concurrent opens must be assigned distinct session numbers');

  const count = await AttendanceLog.countDocuments({ employee: employee._id });
  assert.equal(count, 2);
});
