// Covers the "pending employees can clock in" design: a self-registered
// employee is matchable (can clock in) and counted in the roster (shows as
// present, not invisible) from day one, while payroll-facing queries can
// still be restricted to employees HR has actually confirmed via
// `approvedOnly`. Only REJECTED is excluded everywhere — that's the one
// status a human has actively looked at and said no to.
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/testdb');

let Employee, AttendanceLog, restrictToApproved;

test.before(async () => {
  await db.start();
  Employee = require('../models/Employee');
  AttendanceLog = require('../models/AttendanceLog');
  ({ restrictToApproved } = require('../utils/attendanceEngine'));
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
    faceEmbeddings: [new Array(128).fill(0.1)],
    ...overrides,
  });
}

test('matchableFilter includes PENDING_APPROVAL — a newly self-registered employee can clock in', async () => {
  const pending = await makeEmployee({ status: Employee.STATUS.PENDING });
  const active = await makeEmployee({ status: Employee.STATUS.ACTIVE, phone: '9000000001' });
  const rejected = await makeEmployee({ status: Employee.STATUS.REJECTED, phone: '9000000002' });
  const inactive = await makeEmployee({ status: Employee.STATUS.INACTIVE, phone: '9000000003' });

  const matchable = await Employee.find(Employee.matchableFilter());
  const ids = matchable.map(e => e._id.toString());

  assert.ok(ids.includes(pending._id.toString()), 'a pending employee must be matchable at clock-in');
  assert.ok(ids.includes(active._id.toString()));
  assert.ok(!ids.includes(rejected._id.toString()), 'a rejected registration must never match');
  assert.ok(!ids.includes(inactive._id.toString()), 'a former employee must never match');
});

test('rosterFilter includes pending employees — they show as present, not invisible', async () => {
  const pending = await makeEmployee({ status: Employee.STATUS.PENDING });
  const rejected = await makeEmployee({ status: Employee.STATUS.REJECTED, phone: '9000000009' });

  const roster = await Employee.find(Employee.rosterFilter());
  const ids = roster.map(e => e._id.toString());
  assert.ok(ids.includes(pending._id.toString()));
  assert.ok(!ids.includes(rejected._id.toString()));
});

test('activeFilter (confirmed-employee lists) still excludes pending', async () => {
  const pending = await makeEmployee({ status: Employee.STATUS.PENDING });
  const active = await makeEmployee({ status: Employee.STATUS.ACTIVE, phone: '9000000008' });

  const confirmed = await Employee.find(Employee.activeFilter());
  const ids = confirmed.map(e => e._id.toString());
  assert.ok(!ids.includes(pending._id.toString()), 'the default "confirmed employees" list must not include pending ones');
  assert.ok(ids.includes(active._id.toString()));
});

test('restrictToApproved excludes a pending employee from a payroll query with no prior employee filter', async () => {
  const pending = await makeEmployee({ status: Employee.STATUS.PENDING });
  const active = await makeEmployee({ status: Employee.STATUS.ACTIVE, phone: '9000000007' });
  await AttendanceLog.create({ employee: pending._id, date: '2026-08-24', sessionNumber: 1, clockInTime: new Date(), status: 'VALID' });
  await AttendanceLog.create({ employee: active._id, date: '2026-08-24', sessionNumber: 1, clockInTime: new Date(), status: 'VALID' });

  const filter = await restrictToApproved({ date: '2026-08-24' }, true);
  const logs = await AttendanceLog.find(filter);
  const employeeIds = logs.map(l => String(l.employee));

  assert.ok(!employeeIds.includes(String(pending._id)), 'approvedOnly must exclude a pending employee\'s attendance');
  assert.ok(employeeIds.includes(String(active._id)));
});

test('restrictToApproved with approvedOnly=false leaves the filter untouched (pending employees stay visible)', async () => {
  const filter = { date: '2026-08-24', employee: 'some-id' };
  const result = await restrictToApproved(filter, false);
  assert.deepEqual(result, filter);
});

test('restrictToApproved on a single already-filtered employee: empties the result if that employee is pending', async () => {
  const pending = await makeEmployee({ status: Employee.STATUS.PENDING });
  const filter = await restrictToApproved({ employee: pending._id.toString() }, true);
  // Must not still equal the pending employee's real id.
  assert.notEqual(String(filter.employee), String(pending._id));
});

test('restrictToApproved on a single already-approved employee leaves that employee id intact', async () => {
  const active = await makeEmployee({ status: Employee.STATUS.ACTIVE });
  const filter = await restrictToApproved({ employee: active._id.toString() }, true);
  assert.equal(String(filter.employee), String(active._id));
});

test('rejecting an employee erases their biometrics, so they immediately drop out of matchableFilter', async () => {
  const pending = await makeEmployee({ status: Employee.STATUS.PENDING });
  pending.status = Employee.STATUS.REJECTED;
  pending.faceEmbeddings = [];
  await pending.save();

  const matchable = await Employee.find(Employee.matchableFilter());
  assert.ok(!matchable.map(e => String(e._id)).includes(String(pending._id)));
});
