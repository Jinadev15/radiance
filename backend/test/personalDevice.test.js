// Covers the move from a fixed tablet per site to employees scanning on their
// own phones. Three things replaced what the tablet used to provide:
//   - the site came from the device       -> now derived from GPS
//   - the device was physically at a site -> now only a self-reported fix
//   - one queue, one person at a time     -> now one phone per open session
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/testdb');

let Employee, WorkLocation, AttendanceLog, engine, tz, siteResolver, locationTrust, deviceAnomalies;

test.before(async () => {
  await db.start();
  Employee = require('../models/Employee');
  WorkLocation = require('../models/WorkLocation');
  AttendanceLog = require('../models/AttendanceLog');
  engine = require('../utils/attendanceEngine');
  tz = require('../utils/tz');
  siteResolver = require('../utils/siteResolver');
  locationTrust = require('../utils/locationTrust');
  deviceAnomalies = require('../utils/deviceAnomalies');
  await db.ensureIndexes(AttendanceLog, Employee, WorkLocation);
});

test.after(async () => db.stop());
test.beforeEach(async () => db.reset());

const ANNA_NAGAR = { latitude: 13.0850, longitude: 80.2101 };

async function makeSite(overrides = {}) {
  return WorkLocation.create({
    name: 'Anna Nagar Site',
    address: '123 Test Street',
    latitude: ANNA_NAGAR.latitude,
    longitude: ANNA_NAGAR.longitude,
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
    faceEmbeddings: [new Array(512).fill(0.1)],
    status: Employee.STATUS.ACTIVE,
    approvedAt: new Date(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// GPS -> site
// ---------------------------------------------------------------------------

test('a scan inside a fence resolves to that site', async () => {
  const site = await makeSite();
  await makeSite({ name: 'Velachery Site', latitude: 12.9756, longitude: 80.2207 });

  const here = await siteResolver.sitesAtLocation(ANNA_NAGAR.latitude, ANNA_NAGAR.longitude);
  assert.equal(here.length, 1);
  assert.equal(String(here[0]._id), String(site._id));
  assert.equal(here[0].distanceMeters, 0);
});

test('overlapping fences both resolve, nearest first', async () => {
  // Two client buildings on one campus, ~33 m apart with generous radii — a
  // real arrangement, and the reason this returns a list rather than a guess.
  await makeSite({ name: 'Campus Block A', radiusMeters: 200 });
  await makeSite({
    name: 'Campus Block B',
    latitude: ANNA_NAGAR.latitude + 0.0003,
    longitude: ANNA_NAGAR.longitude,
    radiusMeters: 200,
  });

  const here = await siteResolver.sitesAtLocation(ANNA_NAGAR.latitude, ANNA_NAGAR.longitude);
  assert.equal(here.length, 2, 'both overlapping sites must be offered, not one guessed');
  assert.equal(here[0].name, 'Campus Block A');
  assert.ok(here[0].distanceMeters <= here[1].distanceMeters);
});

test('standing outside every fence resolves to no site, but names the closest', async () => {
  await makeSite();

  // ~1.1 km north — well outside the 150 m radius.
  const far = { latitude: ANNA_NAGAR.latitude + 0.01, longitude: ANNA_NAGAR.longitude };
  assert.deepEqual(await siteResolver.sitesAtLocation(far.latitude, far.longitude), []);

  const closest = await siteResolver.nearestSite(far.latitude, far.longitude);
  assert.equal(closest.name, 'Anna Nagar Site');
  assert.ok(closest.distanceMeters > 1000 && closest.distanceMeters < 1200,
    `expected ~1.1km, got ${closest.distanceMeters}m`);
});

test('an inactive site is never resolved to', async () => {
  await makeSite({ isActive: false });
  assert.deepEqual(await siteResolver.sitesAtLocation(ANNA_NAGAR.latitude, ANNA_NAGAR.longitude), []);
  assert.equal(await siteResolver.nearestSite(ANNA_NAGAR.latitude, ANNA_NAGAR.longitude), null);
});

test('a missing or malformed fix resolves to nothing rather than throwing', async () => {
  await makeSite();
  assert.deepEqual(await siteResolver.sitesAtLocation(undefined, undefined), []);
  assert.deepEqual(await siteResolver.sitesAtLocation(null, 80.21), []);
  assert.deepEqual(await siteResolver.sitesAtLocation('not-a-number', 80.21), []);
  assert.equal(await siteResolver.nearestSite(undefined, undefined), null);
});

test('resolving a site is one query no matter how many sites exist', async () => {
  for (let i = 0; i < 40; i += 1) {
    await makeSite({ name: `Site ${i}`, latitude: 13 + i * 0.01, longitude: 80.2 });
  }
  const { count } = await db.countQueries(() =>
    siteResolver.sitesAtLocation(ANNA_NAGAR.latitude, ANNA_NAGAR.longitude));
  assert.equal(count, 1, 'must not fan out one query per site');
});

// ---------------------------------------------------------------------------
// One phone, one open session
// ---------------------------------------------------------------------------

test('a second person cannot clock in on a phone that still holds an open session', async () => {
  const site = await makeSite();
  const alice = await makeEmployee({ name: 'Alice', workLocation: site._id });
  const bob = await makeEmployee({ name: 'Bob', workLocation: site._id });
  alice.workLocation = site;

  const at = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const geo = engine.enforceGeofence(alice, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  await engine.openSession({ employee: alice, at, geo, confidence: 0.9, source: 'AUTO', deviceId: 'phone-abc123' });

  const bobArrives = new Date(at.getTime() + 60 * 1000);
  await assert.rejects(
    () => engine.assertDeviceFree('phone-abc123', bob._id, bobArrives),
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'DEVICE_IN_USE');
      assert.match(err.error, /Alice/, 'the message must name who is holding the phone');
      return true;
    }
  );
});

test('the same person may re-scan on their own phone', async () => {
  const site = await makeSite();
  const alice = await makeEmployee({ name: 'Alice', workLocation: site._id });
  alice.workLocation = site;

  const at = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const geo = engine.enforceGeofence(alice, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  await engine.openSession({ employee: alice, at, geo, confidence: 0.9, source: 'AUTO', deviceId: 'phone-abc123' });

  await engine.assertDeviceFree('phone-abc123', alice._id, new Date(at.getTime() + 60 * 1000));
});

test('once the first person clocks out, the phone frees up for the next', async () => {
  const site = await makeSite();
  const alice = await makeEmployee({ name: 'Alice', workLocation: site._id });
  const bob = await makeEmployee({ name: 'Bob', workLocation: site._id });
  alice.workLocation = site;

  const at = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const geo = engine.enforceGeofence(alice, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  const session = await engine.openSession({
    employee: alice, at, geo, confidence: 0.9, source: 'AUTO', deviceId: 'phone-abc123',
  });

  // The exact sequence the owner asked for: Bob is refused, Alice clocks out,
  // Bob is then accepted on the same handset.
  await assert.rejects(() => engine.assertDeviceFree('phone-abc123', bob._id, at));

  const out = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 17, minute: 0 });
  await engine.closeSession({ session, employee: alice, at: out, geo });

  await engine.assertDeviceFree('phone-abc123', bob._id, new Date(out.getTime() + 60 * 1000));
});

test('a different phone is always free', async () => {
  const site = await makeSite();
  const alice = await makeEmployee({ name: 'Alice', workLocation: site._id });
  const bob = await makeEmployee({ name: 'Bob', workLocation: site._id });
  alice.workLocation = site;

  const at = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const geo = engine.enforceGeofence(alice, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  await engine.openSession({ employee: alice, at, geo, confidence: 0.9, source: 'AUTO', deviceId: 'alice-phone' });

  await engine.assertDeviceFree('bob-phone', bob._id, at);
});

test('a phone with storage disabled sends no id, and is not blocked by it', async () => {
  const bob = await makeEmployee({ name: 'Bob' });
  // Must not throw, and must not treat "no id" as one device everybody
  // shares — that would lock out every private-browsing phone at once.
  await engine.assertDeviceFree(null, bob._id, new Date());
  await engine.assertDeviceFree(undefined, bob._id, new Date());
});

test('a forgotten session from days ago does not hold a phone hostage forever', async () => {
  const site = await makeSite();
  const alice = await makeEmployee({ name: 'Alice', workLocation: site._id });
  const bob = await makeEmployee({ name: 'Bob', workLocation: site._id });
  alice.workLocation = site;

  const longAgo = tz.instantFromZonedParts({ year: 2026, month: 8, day: 20, hour: 9, minute: 0 });
  const geo = engine.enforceGeofence(alice, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  await engine.openSession({ employee: alice, at: longAgo, geo, confidence: 0.9, source: 'AUTO', deviceId: 'phone-abc123' });

  // Four days later. Alice never clocked out (auto-clock-out would normally
  // have closed this), but Bob must not be stuck because of it.
  const muchLater = new Date(longAgo.getTime() + 4 * 24 * 3600 * 1000);
  await engine.assertDeviceFree('phone-abc123', bob._id, muchLater);
});

// ---------------------------------------------------------------------------
// Location trust signals
// ---------------------------------------------------------------------------

test('a normal fix from a phone raises no flags', async () => {
  const employee = await makeEmployee();
  const { flags, notes } = await locationTrust.assessLocation({
    latitude: ANNA_NAGAR.latitude, longitude: ANNA_NAGAR.longitude,
    accuracy: 18, employeeId: employee._id, at: new Date(),
  });
  assert.deepEqual(flags, []);
  assert.equal(notes, null);
});

test('a sub-metre accuracy reading is flagged as implausible for a phone', async () => {
  const employee = await makeEmployee();
  const { flags } = await locationTrust.assessLocation({
    latitude: ANNA_NAGAR.latitude, longitude: ANNA_NAGAR.longitude,
    accuracy: 0.5, employeeId: employee._id, at: new Date(),
  });
  assert.ok(flags.includes('IMPLAUSIBLE_ACCURACY'));
});

test('a missing accuracy reading is recorded, not ignored', async () => {
  const employee = await makeEmployee();
  const { flags } = await locationTrust.assessLocation({
    latitude: ANNA_NAGAR.latitude, longitude: ANNA_NAGAR.longitude,
    employeeId: employee._id, at: new Date(),
  });
  assert.ok(flags.includes('NO_ACCURACY_REPORTED'));
});

test('byte-identical coordinates hours apart look hardcoded', async () => {
  const site = await makeSite();
  const employee = await makeEmployee({ workLocation: site._id });
  employee.workLocation = site;

  const yesterday = tz.instantFromZonedParts({ year: 2026, month: 8, day: 23, hour: 9, minute: 0 });
  const geo = engine.enforceGeofence(employee, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  await engine.openSession({ employee, at: yesterday, geo, confidence: 0.9, source: 'AUTO' });

  const today = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const { flags, notes } = await locationTrust.assessLocation({
    latitude: ANNA_NAGAR.latitude, longitude: ANNA_NAGAR.longitude,
    accuracy: 15, employeeId: employee._id, at: today,
  });
  assert.ok(flags.includes('IDENTICAL_TO_PREVIOUS_FIX'));
  assert.match(notes, /IDENTICAL_TO_PREVIOUS_FIX/);
});

test('normal GPS jitter between two days does not trip the identical-fix flag', async () => {
  const site = await makeSite();
  const employee = await makeEmployee({ workLocation: site._id });
  employee.workLocation = site;

  const yesterday = tz.instantFromZonedParts({ year: 2026, month: 8, day: 23, hour: 9, minute: 0 });
  const geo = engine.enforceGeofence(employee, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  await engine.openSession({ employee, at: yesterday, geo, confidence: 0.9, source: 'AUTO' });

  const today = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const { flags } = await locationTrust.assessLocation({
    latitude: ANNA_NAGAR.latitude + 0.00008, // ~9 m of ordinary drift
    longitude: ANNA_NAGAR.longitude,
    accuracy: 15, employeeId: employee._id, at: today,
  });
  assert.ok(!flags.includes('IDENTICAL_TO_PREVIOUS_FIX'));
});

test('two scans too far apart to have travelled between are flagged', async () => {
  const site = await makeSite();
  const employee = await makeEmployee({ workLocation: site._id });
  employee.workLocation = site;

  const earlier = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const geo = engine.enforceGeofence(employee, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  await engine.openSession({ employee, at: earlier, geo, confidence: 0.9, source: 'AUTO' });

  // Bengaluru, ~290 km away, half an hour later.
  const { flags } = await locationTrust.assessLocation({
    latitude: 12.9716, longitude: 77.5946,
    accuracy: 15, employeeId: employee._id,
    at: new Date(earlier.getTime() + 30 * 60 * 1000),
  });
  assert.ok(flags.includes('IMPOSSIBLE_TRAVEL'));
});

test('a genuine commute between two sites is not called impossible travel', async () => {
  const site = await makeSite();
  const employee = await makeEmployee({ workLocation: site._id });
  employee.workLocation = site;

  const earlier = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const geo = engine.enforceGeofence(employee, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  await engine.openSession({ employee, at: earlier, geo, confidence: 0.9, source: 'AUTO' });

  // Velachery, ~13 km across Chennai, two hours later — an ordinary trip.
  const { flags } = await locationTrust.assessLocation({
    latitude: 12.9756, longitude: 80.2207,
    accuracy: 15, employeeId: employee._id,
    at: new Date(earlier.getTime() + 2 * 3600 * 1000),
  });
  assert.ok(!flags.includes('IMPOSSIBLE_TRAVEL'), `unexpected flags: ${flags.join(', ')}`);
});

test('an employee with no scan history is judged on the current fix alone', async () => {
  const employee = await makeEmployee();
  const { flags } = await locationTrust.assessLocation({
    latitude: ANNA_NAGAR.latitude, longitude: ANNA_NAGAR.longitude,
    accuracy: 20, employeeId: employee._id, at: new Date(),
  });
  assert.deepEqual(flags, []);
});

// ---------------------------------------------------------------------------
// The signals reach the record HR actually reads
// ---------------------------------------------------------------------------

test('device, accuracy and location flags are persisted on the attendance row', async () => {
  const site = await makeSite();
  const employee = await makeEmployee({ workLocation: site._id });
  employee.workLocation = site;

  const at = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour: 9, minute: 0 });
  const geo = engine.enforceGeofence(employee, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  const log = await engine.openSession({
    employee, at, geo, confidence: 0.9, source: 'AUTO',
    deviceId: 'phone-abc123',
    accuracy: 22,
    locationFlags: ['IMPLAUSIBLE_ACCURACY'],
  });

  const saved = await AttendanceLog.findById(log._id).lean();
  assert.equal(saved.deviceId, 'phone-abc123');
  assert.equal(saved.clockInAccuracyMeters, 22);
  assert.deepEqual(saved.locationFlags, ['IMPLAUSIBLE_ACCURACY']);
});

// ---------------------------------------------------------------------------
// What HR is shown
// ---------------------------------------------------------------------------

async function scanOn(employee, site, deviceId, hour, extra = {}) {
  const at = tz.instantFromZonedParts({ year: 2026, month: 8, day: 24, hour, minute: 0 });
  const geo = engine.enforceGeofence(employee, ANNA_NAGAR.latitude, ANNA_NAGAR.longitude, 'clock in');
  const session = await engine.openSession({
    employee, at, geo, confidence: 0.9, source: 'AUTO', deviceId, ...extra,
  });
  // Closed straight away so the next person is not blocked by assertDeviceFree
  // — this exercises the reporting query, not the live device rule.
  await engine.closeSession({
    session, employee, at: new Date(at.getTime() + 30 * 60 * 1000), geo,
  });
  return session;
}

test('a phone used by three different people surfaces as a shared device', async () => {
  const site = await makeSite();
  const people = [];
  for (const name of ['Alice', 'Bob', 'Chandra']) {
    const e = await makeEmployee({ name, workLocation: site._id });
    e.workLocation = site;
    people.push(e);
  }
  for (let i = 0; i < people.length; i += 1) {
    await scanOn(people[i], site, 'one-phone', 9 + i);
  }

  const rows = await deviceAnomalies.sharedDevices({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deviceId, 'one-phone');
  assert.equal(rows[0].peopleCount, 3);
  assert.equal(rows[0].scans, 3);
  // Names, not raw ids — the report is read by a human.
  assert.deepEqual(rows[0].employees.map(e => e.name).sort(), ['Alice', 'Bob', 'Chandra']);
});

test('one colleague borrowing a phone is below the threshold and stays quiet', async () => {
  const site = await makeSite();
  const alice = await makeEmployee({ name: 'Alice', workLocation: site._id });
  const bob = await makeEmployee({ name: 'Bob', workLocation: site._id });
  alice.workLocation = site; bob.workLocation = site;

  await scanOn(alice, site, 'alice-phone', 9);
  await scanOn(bob, site, 'alice-phone', 10); // dead battery, borrowed a phone

  assert.deepEqual(await deviceAnomalies.sharedDevices({}), []);
});

test('one person scanning repeatedly on their own phone is never a shared device', async () => {
  const site = await makeSite();
  const alice = await makeEmployee({ name: 'Alice', workLocation: site._id });
  alice.workLocation = site;

  for (const hour of [9, 12, 15]) await scanOn(alice, site, 'alice-phone', hour);

  assert.deepEqual(await deviceAnomalies.sharedDevices({}), []);
});

test('phones that reported no id are not grouped into one fictional shared device', async () => {
  const site = await makeSite();
  // Three unrelated people in private browsing. Grouping them on deviceId:null
  // would invent a ring of colleagues sharing a handset that does not exist.
  for (const name of ['Alice', 'Bob', 'Chandra']) {
    const e = await makeEmployee({ name, workLocation: site._id });
    e.workLocation = site;
    await scanOn(e, site, null, 9);
  }

  assert.deepEqual(await deviceAnomalies.sharedDevices({}), []);
});

test('the shared-device report respects the caller scope it is given', async () => {
  const chennai = await makeSite();
  const other = await makeSite({ name: 'Other Site', latitude: 12.9756, longitude: 80.2207 });
  for (const name of ['Alice', 'Bob', 'Chandra']) {
    const e = await makeEmployee({ name, workLocation: chennai._id });
    e.workLocation = chennai;
    await scanOn(e, chennai, 'one-phone', 9);
  }

  // A supervisor scoped to another site must not see this.
  assert.deepEqual(await deviceAnomalies.sharedDevices({ workLocation: other._id }), []);
  assert.equal((await deviceAnomalies.sharedDevices({ workLocation: chennai._id })).length, 1);
});

test('flagged scans are listed for review, unflagged ones are not', async () => {
  const site = await makeSite();
  const alice = await makeEmployee({ name: 'Alice', workLocation: site._id });
  const bob = await makeEmployee({ name: 'Bob', workLocation: site._id });
  alice.workLocation = site; bob.workLocation = site;

  await scanOn(alice, site, 'alice-phone', 9, {
    locationFlags: ['IMPLAUSIBLE_ACCURACY'], accuracy: 0.4,
  });
  await scanOn(bob, site, 'bob-phone', 10); // clean scan

  const rows = await deviceAnomalies.flaggedLocations({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employee.name, 'Alice');
  assert.deepEqual(rows[0].locationFlags, ['IMPLAUSIBLE_ACCURACY']);
  assert.equal(rows[0].clockInAccuracyMeters, 0.4);
});
