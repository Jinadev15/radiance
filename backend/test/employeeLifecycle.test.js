// Employee status model and audit trail.
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/testdb');

let Employee, AuditLog, audit;

test.before(async () => {
  await db.start();
  Employee = require('../models/Employee');
  AuditLog = require('../models/AuditLog');
  audit = require('../utils/audit');
  await db.ensureIndexes(Employee);
});
test.after(async () => db.stop());
test.beforeEach(async () => db.reset());

test('phone number is NOT unique — two employees may share a household phone', async () => {
  const a = await Employee.create({
    name: 'Employee A', phone: '9876543210',
    nationalIdHash: 'hash-a', nationalIdLast4: '1111',
    dateOfBirth: new Date('1990-01-01'), status: Employee.STATUS.PENDING,
  });
  const b = await Employee.create({
    name: 'Employee B', phone: '9876543210', // same phone, different person
    nationalIdHash: 'hash-b', nationalIdLast4: '2222',
    dateOfBirth: new Date('1992-01-01'), status: Employee.STATUS.PENDING,
  });
  assert.notEqual(a._id.toString(), b._id.toString());
});

test('nationalIdHash IS unique — the same ID cannot be registered twice', async () => {
  await Employee.create({
    name: 'Employee A', phone: '9111111111',
    nationalIdHash: 'shared-hash', nationalIdLast4: '1111',
    dateOfBirth: new Date('1990-01-01'), status: Employee.STATUS.PENDING,
  });
  await assert.rejects(
    Employee.create({
      name: 'Employee B', phone: '9222222222',
      nationalIdHash: 'shared-hash', nationalIdLast4: '2222',
      dateOfBirth: new Date('1990-01-01'), status: Employee.STATUS.PENDING,
    }),
    (err) => err.code === 11000
  );
});

test('a new self-registration defaults to PENDING_APPROVAL, not ACTIVE', async () => {
  const emp = await Employee.create({
    name: 'New Hire', phone: '9333333333',
    nationalIdHash: 'hash-c', nationalIdLast4: '3333',
    dateOfBirth: new Date('1995-01-01'),
  });
  assert.equal(emp.status, Employee.STATUS.PENDING);
  assert.equal(emp.isActive, false);
});

// PENDING is deliberately matchable (a self-registered employee can clock in
// before HR reviews them — see test/pendingApproval.test.js for the fuller
// coverage of that design). What matchableFilter must still enforce
// regardless of status is having an actual face enrolled.
test('matchableFilter requires at least one embedding, regardless of ACTIVE vs PENDING status', async () => {
  const pendingWithFace = await Employee.create({
    name: 'Pending', phone: '9444444444', nationalIdHash: 'h4', nationalIdLast4: '4444',
    dateOfBirth: new Date('1990-01-01'), status: Employee.STATUS.PENDING,
    faceEmbeddings: [new Array(128).fill(0.1)],
  });
  const activeNoFace = await Employee.create({
    name: 'No Face', phone: '9555555555', nationalIdHash: 'h5', nationalIdLast4: '5555',
    dateOfBirth: new Date('1990-01-01'), status: Employee.STATUS.ACTIVE, faceEmbeddings: [],
  });
  const activeWithFace = await Employee.create({
    name: 'Matchable', phone: '9666666666', nationalIdHash: 'h6', nationalIdLast4: '6666',
    dateOfBirth: new Date('1990-01-01'), status: Employee.STATUS.ACTIVE,
    faceEmbeddings: [new Array(128).fill(0.1)],
  });

  const matchable = await Employee.find(Employee.matchableFilter());
  const ids = matchable.map(e => e._id.toString());
  assert.ok(ids.includes(pendingWithFace._id.toString()), 'pending employee with a face IS matchable');
  assert.ok(!ids.includes(activeNoFace._id.toString()), 'active employee with no face is NOT matchable');
  assert.ok(ids.includes(activeWithFace._id.toString()));
});

test('getMaskedNationalId never exposes more than the last 4 digits', async () => {
  const emp = await Employee.create({
    name: 'Masked', phone: '9777777777', nationalIdHash: 'h7', nationalIdLast4: '7890',
    dateOfBirth: new Date('1990-01-01'),
  });
  assert.equal(emp.getMaskedNationalId(), 'XXXX-XXXX-7890');
});

test('toSafeJSON never includes the raw embeddings or the ID hash', async () => {
  const emp = await Employee.create({
    name: 'Safe', phone: '9888888888', nationalIdHash: 'secret-hash', nationalIdLast4: '9999',
    dateOfBirth: new Date('1990-01-01'), faceEmbeddings: [new Array(128).fill(0.1)],
  });
  const safe = emp.toSafeJSON();
  assert.equal(safe.faceEmbeddings, undefined);
  assert.equal(safe.nationalIdHash, undefined);
  assert.equal(safe.nationalId, 'XXXX-XXXX-9999');
});

test('audit.record redacts biometric and secret fields even if passed a raw document', async () => {
  const emp = await Employee.create({
    name: 'Audited', phone: '9000000000', nationalIdHash: 'audit-hash', nationalIdLast4: '0000',
    dateOfBirth: new Date('1990-01-01'), faceEmbeddings: [new Array(128).fill(0.1)],
  });

  await audit.record(null, {
    action: 'test.action',
    targetModel: 'Employee',
    targetId: emp._id,
    before: emp, // deliberately the whole raw document, not a picked subset
  });

  const entry = await AuditLog.findOne({ action: 'test.action' });
  assert.equal(entry.before.faceEmbeddings, undefined);
  assert.equal(entry.before.nationalIdHash, undefined);
  assert.equal(entry.before.name, 'Audited');
});

test('audit.diff only reports fields that actually changed', () => {
  const before = { name: 'Old Name', workLocation: 'site-1', shiftTemplate: 'shift-1' };
  const after = { name: 'Old Name', workLocation: 'site-2' };
  const result = audit.diff(before, after, ['name', 'workLocation', 'shiftTemplate']);
  assert.deepEqual(Object.keys(result.after), ['workLocation']);
});
