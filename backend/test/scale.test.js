// Guards the scale properties that matter at this deployment's real size
// (126 sites, 4,000 employees). These are the paths that were measured to
// break: the per-scan candidate payload, the per-site dashboard fan-out, and
// the approved-only filter's id array.
//
// Each test asserts a *bound*, not a timing — timings vary by machine, but
// "this must not grow with headcount" is a real invariant worth locking in.
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/testdb');

let Employee, WorkLocation, AttendanceLog, ShiftTemplate, roster, rosterCache, engine;

// Big enough to expose an O(n) or O(sites) mistake, small enough to seed fast.
const SITES = 40;
const EMPLOYEES = 800;

test.before(async () => {
  await db.start();
  Employee = require('../models/Employee');
  WorkLocation = require('../models/WorkLocation');
  AttendanceLog = require('../models/AttendanceLog');
  ShiftTemplate = require('../models/ShiftTemplate');
  require('../models/ServiceTag');
  require('../models/LeaveRequest');
  require('../models/Holiday');
  roster = require('../utils/roster');
  rosterCache = require('../utils/rosterCache');
  engine = require('../utils/attendanceEngine');

  const shift = await ShiftTemplate.create({
    name: 'Day', startTime: '09:00', endTime: '17:00', graceMinutes: 10,
  });
  const sites = await WorkLocation.insertMany(
    Array.from({ length: SITES }, (_, i) => ({
      name: `Site ${i + 1}`, address: `Addr ${i}`,
      latitude: 13 + i * 0.001, longitude: 80 + i * 0.001,
      radiusMeters: 150, shiftStart: '09:00', shiftEnd: '17:00',
    }))
  );

  const embedding = () => Array.from({ length: 128 }, (_, k) => Math.sin(k) * 0.1);
  const rows = Array.from({ length: EMPLOYEES }, (_, i) => ({
    employeeId: `EMP-${String(i + 1).padStart(5, '0')}`,
    name: `Employee ${i + 1}`,
    phone: String(9000000000 + i),
    nationalIdHash: `hash-${i}`,
    nationalIdLast4: String(1000 + (i % 9000)),
    dateOfBirth: new Date('1990-01-01'),
    faceEmbeddings: [embedding()],
    workLocation: sites[i % SITES]._id,
    shiftTemplate: shift._id,
    // A realistic minority awaiting approval / deactivated.
    status: i % 40 === 0
      ? Employee.STATUS.PENDING
      : (i % 97 === 0 ? Employee.STATUS.INACTIVE : Employee.STATUS.ACTIVE),
    weeklyOff: [0],
  }));
  for (let i = 0; i < rows.length; i += 400) {
    await Employee.insertMany(rows.slice(i, i + 400), { ordered: false });
  }
});

test.after(async () => db.stop());

test('the dashboard per-site breakdown does not fan out one query per site', async () => {
  const employees = await Employee.find(Employee.rosterFilter())
    .select('_id workLocation weeklyOff').lean();

  // Count the queries this actually issues. The previous implementation ran
  // resolveDay() once per site — ~3 queries x 40 sites here, and ~380 at the
  // real 126 sites, for a single dashboard load.
  const { count: queries, result } = await db.countQueries(() =>
    roster.resolveDayBySite('2026-08-24', employees, 'Asia/Kolkata')
  );
  const { totals, bySite } = result;

  assert.equal(totals.totalEmployees, employees.length, 'every employee is accounted for');
  assert.ok(Object.keys(bySite).length > 1, 'produces a real per-site breakdown');
  assert.ok(
    queries <= 8,
    `expected a constant handful of queries regardless of site count, got ${queries} for ${SITES} sites`
  );
});

test('per-site totals sum to the global totals', async () => {
  const employees = await Employee.find(Employee.rosterFilter())
    .select('_id workLocation weeklyOff').lean();
  const { totals, bySite } = await roster.resolveDayBySite('2026-08-24', employees, 'Asia/Kolkata');

  const summed = Object.values(bySite).reduce((acc, b) => ({
    totalEmployees: acc.totalEmployees + b.totalEmployees,
    present: acc.present + b.present,
    absent: acc.absent + b.absent,
    onLeave: acc.onLeave + b.onLeave,
    weeklyOff: acc.weeklyOff + b.weeklyOff,
    holiday: acc.holiday + b.holiday,
  }), { totalEmployees: 0, present: 0, absent: 0, onLeave: 0, weeklyOff: 0, holiday: 0 });

  assert.equal(summed.totalEmployees, totals.totalEmployees);
  assert.equal(summed.present, totals.present);
  assert.equal(summed.absent, totals.absent);
  assert.equal(summed.onLeave, totals.onLeave);
  assert.equal(summed.weeklyOff, totals.weeklyOff);
  assert.equal(summed.holiday, totals.holiday);
});

test('resolveDayBySite agrees with resolveDay on the same roster', async () => {
  const employees = await Employee.find(Employee.rosterFilter())
    .select('_id workLocation weeklyOff').lean();

  const [oneShot, grouped] = await Promise.all([
    roster.resolveDay('2026-08-24', employees, 'Asia/Kolkata'),
    roster.resolveDayBySite('2026-08-24', employees, 'Asia/Kolkata'),
  ]);

  // The fast path must never disagree with the reference implementation —
  // that's the whole risk of having two of them.
  assert.equal(grouped.totals.totalEmployees, oneShot.totalEmployees);
  assert.equal(grouped.totals.present, oneShot.present);
  assert.equal(grouped.totals.absent, oneShot.absent);
  assert.equal(grouped.totals.expected, oneShot.expected);
  assert.equal(grouped.totals.weeklyOff, oneShot.weeklyOff);
});

test('approvedOnly excludes the minority rather than enumerating everyone', async () => {
  const filter = await engine.restrictToApproved({ date: '2026-08-24' }, true);

  // $nin over the small not-approved set, never $in over the whole workforce:
  // the id array must stay proportional to the exceptions, not the headcount.
  assert.ok(filter.employee, 'an employee constraint is applied');
  assert.ok(filter.employee.$nin, 'uses $nin (exclude the exceptions)');
  assert.equal(filter.employee.$in, undefined, 'must not enumerate every approved id');

  const activeCount = await Employee.countDocuments({ status: Employee.STATUS.ACTIVE });
  assert.ok(
    filter.employee.$nin.length < activeCount / 4,
    `excluded set (${filter.employee.$nin.length}) should be far smaller than the approved set (${activeCount})`
  );
});

test('approvedOnly still actually excludes a pending employee\'s attendance', async () => {
  const pending = await Employee.findOne({ status: Employee.STATUS.PENDING });
  const active = await Employee.findOne({ status: Employee.STATUS.ACTIVE });
  await AttendanceLog.deleteMany({});
  await AttendanceLog.create([
    { employee: pending._id, date: '2026-09-01', sessionNumber: 1, clockInTime: new Date(), status: 'VALID' },
    { employee: active._id, date: '2026-09-01', sessionNumber: 1, clockInTime: new Date(), status: 'VALID' },
  ]);

  const filter = await engine.restrictToApproved({ date: '2026-09-01' }, true);
  const logs = await AttendanceLog.find(filter);
  const ids = logs.map(l => String(l.employee));

  assert.ok(!ids.includes(String(pending._id)), 'pending employee excluded from a payroll query');
  assert.ok(ids.includes(String(active._id)), 'approved employee included');
  await AttendanceLog.deleteMany({});
});

test('the roster sync payload carries embeddings once, not per scan', async () => {
  const rows = await Employee.find(Employee.matchableFilter())
    .select('_id workLocation faceEmbeddings faceEnrolledAt').lean();

  const version = rosterCache.computeVersion(rows);
  assert.match(version, /^\d+-[0-9a-f]{16}$/, 'version encodes the roster size and a content hash');

  // Same roster must produce the same version — otherwise every call would
  // look like a change and resync the whole thing.
  assert.equal(rosterCache.computeVersion(rows), version, 'version is stable for an unchanged roster');

  // Reordering must not change it either: query order is not a roster change.
  const shuffled = [...rows].reverse();
  assert.equal(rosterCache.computeVersion(shuffled), version, 'version is order-independent');
});

test('the roster version changes when someone is enrolled or removed', async () => {
  const rows = await Employee.find(Employee.matchableFilter())
    .select('_id workLocation faceEmbeddings faceEnrolledAt').lean();
  const before = rosterCache.computeVersion(rows);

  // Dropping one person must invalidate — otherwise a deactivated employee
  // would keep matching against a cache nobody knew was stale.
  const withoutOne = rows.slice(1);
  assert.notEqual(rosterCache.computeVersion(withoutOne), before);

  // So must a re-enrolment that changes someone's embedding count.
  const reEnrolled = rows.map((r, i) =>
    i === 0 ? { ...r, faceEmbeddings: [...r.faceEmbeddings, r.faceEmbeddings[0]] } : r
  );
  assert.notEqual(rosterCache.computeVersion(reEnrolled), before);
});

test('a site-scoped scan compares against only that site, not the whole company', async () => {
  const site = await WorkLocation.findOne();
  const scoped = await Employee.countDocuments(
    Employee.matchableFilter({ workLocation: site._id })
  );
  const everyone = await Employee.countDocuments(Employee.matchableFilter());

  assert.ok(scoped > 0, 'the test site has enrolled employees');
  assert.ok(
    scoped < everyone / 5,
    `site scoping should shrink the candidate pool substantially (${scoped} vs ${everyone})`
  );
});
