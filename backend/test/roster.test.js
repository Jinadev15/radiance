// utils/roster.js — replaces `absent = totalEmployees - presentToday`, which
// used to count approved leave, weekly offs, and holidays all as "absent".
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/testdb');

let Employee, AttendanceLog, LeaveRequest, Holiday, roster;

test.before(async () => {
  await db.start();
  Employee = require('../models/Employee');
  AttendanceLog = require('../models/AttendanceLog');
  LeaveRequest = require('../models/LeaveRequest');
  Holiday = require('../models/Holiday');
  roster = require('../utils/roster');
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
    status: Employee.STATUS.ACTIVE,
    weeklyOff: [0],
    ...overrides,
  });
}

test('Sunday reports weekly-off employees separately, not as absent', async () => {
  const emp = await makeEmployee({ weeklyOff: [0] }); // Sunday off
  // 2026-08-23 is a Sunday
  const day = await roster.resolveDay('2026-08-23', [emp.toObject()], 'Asia/Kolkata');
  assert.equal(day.weeklyOff, 1);
  assert.equal(day.absent, 0);
  assert.equal(day.expected, 0);
});

test('an employee on approved leave is not counted as absent', async () => {
  const emp = await makeEmployee({ weeklyOff: [] });
  await LeaveRequest.create({
    employee: emp._id, leaveType: 'CASUAL',
    fromDate: '2026-08-24', toDate: '2026-08-24',
    reason: 'test', status: 'APPROVED',
  });
  const day = await roster.resolveDay('2026-08-24', [emp.toObject()], 'Asia/Kolkata');
  assert.equal(day.onLeave, 1);
  assert.equal(day.absent, 0);
});

test('a pending (unapproved) leave request does not exempt someone from being absent', async () => {
  const emp = await makeEmployee({ weeklyOff: [] });
  await LeaveRequest.create({
    employee: emp._id, leaveType: 'CASUAL',
    fromDate: '2026-08-24', toDate: '2026-08-24',
    reason: 'test', status: 'PENDING',
  });
  const day = await roster.resolveDay('2026-08-24', [emp.toObject()], 'Asia/Kolkata');
  assert.equal(day.onLeave, 0);
  assert.equal(day.absent, 1);
});

test('a company-wide holiday exempts everyone regardless of site', async () => {
  const emp = await makeEmployee({ weeklyOff: [] });
  await Holiday.create({ date: '2026-08-24', name: 'Test Holiday', workLocations: [] });
  const day = await roster.resolveDay('2026-08-24', [emp.toObject()], 'Asia/Kolkata');
  assert.equal(day.holiday, 1);
  assert.equal(day.absent, 0);
});

test('a site-scoped holiday only exempts that site', async () => {
  const otherSiteId = new (require('mongoose').Types.ObjectId)();
  const targetSiteId = new (require('mongoose').Types.ObjectId)();
  const empAtTarget = await makeEmployee({ weeklyOff: [], workLocation: targetSiteId, phone: '9111111111' });
  const empElsewhere = await makeEmployee({ weeklyOff: [], workLocation: otherSiteId, phone: '9222222222' });
  await Holiday.create({ date: '2026-08-24', name: 'Local Holiday', workLocations: [targetSiteId] });

  const day = await roster.resolveDay(
    '2026-08-24',
    [empAtTarget.toObject(), empElsewhere.toObject()],
    'Asia/Kolkata'
  );
  assert.equal(day.holiday, 1);
  assert.equal(day.absent, 1);
});

test('someone who scanned in counts as present even on their weekly off or a holiday (overtime case)', async () => {
  const emp = await makeEmployee({ weeklyOff: [0] });
  await AttendanceLog.create({
    employee: emp._id, date: '2026-08-23', sessionNumber: 1,
    clockInTime: new Date('2026-08-23T04:00:00Z'), status: 'VALID',
  });
  const day = await roster.resolveDay('2026-08-23', [emp.toObject()], 'Asia/Kolkata');
  assert.equal(day.present, 1);
  assert.equal(day.weeklyOff, 0, 'presence takes precedence over the weekly-off calendar entry');
});

test('attendanceRate is computed against expected headcount, not total headcount', async () => {
  const empOnLeave = await makeEmployee({ weeklyOff: [], phone: '9333333333' });
  await LeaveRequest.create({
    employee: empOnLeave._id, leaveType: 'SICK',
    fromDate: '2026-08-24', toDate: '2026-08-24',
    reason: 'test', status: 'APPROVED',
  });
  const empPresent = await makeEmployee({ weeklyOff: [], phone: '9444444444' });
  await AttendanceLog.create({
    employee: empPresent._id, date: '2026-08-24', sessionNumber: 1,
    clockInTime: new Date('2026-08-24T04:00:00Z'), status: 'VALID',
  });

  const day = await roster.resolveDay(
    '2026-08-24',
    [empOnLeave.toObject(), empPresent.toObject()],
    'Asia/Kolkata'
  );
  assert.equal(day.totalEmployees, 2);
  assert.equal(day.expected, 1, 'the person on leave is excluded from the denominator');
  assert.equal(day.attendanceRate, 100, '1 of 1 expected employees present = 100%, not 50%');
});
