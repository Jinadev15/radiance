// Fraud signals that only exist because employees scan from their own phones.
//
// A tablet bolted to a wall proved two things for free: that the scan was
// taken at the site, and that one queue meant one person at a time. A
// personal phone proves neither. The attendance engine already refuses to
// let two people hold an open session on one handset, and locationTrust
// already tags odd GPS on the row — these are the read-side queries that
// turn those recordings into something HR can actually look at.
//
// Both are advisory. Nothing here proves fraud; it produces a short queue
// worth a human glance, which is the honest limit of what a web page can
// establish about a phone it does not control.
const AttendanceLog = require('../models/AttendanceLog');
const Employee = require('../models/Employee');

// How many distinct people must share one handset before it is worth
// surfacing. Two is a borrowed phone after a dead battery — ordinary, and
// flagging it would bury the real signal. Three or more inside one window
// starts to look like one person clocking in a group.
const SHARED_DEVICE_MIN_PEOPLE = 3;

/**
 * Handsets used by several different employees in the window.
 *
 * @param {object} match  the caller's already-scoped date/site filter
 * @returns {Promise<Array<{deviceId, employees, peopleCount, scans, lastSeen}>>}
 */
async function sharedDevices(match, limit = 20) {
  const rows = await AttendanceLog.aggregate([
    // deviceId is null for any phone with storage disabled. Those are not one
    // shared device — grouping them together would invent a fake ring of
    // "colleagues" out of unrelated private-browsing sessions.
    { $match: { ...match, deviceId: { $ne: null } } },
    { $group: {
      _id: '$deviceId',
      employees: { $addToSet: '$employee' },
      scans: { $sum: 1 },
      lastSeen: { $max: '$clockInTime' },
    } },
    { $match: { $expr: { $gte: [{ $size: '$employees' }, SHARED_DEVICE_MIN_PEOPLE] } } },
    { $project: {
      _id: 0,
      deviceId: '$_id',
      employees: 1,
      scans: 1,
      lastSeen: 1,
      peopleCount: { $size: '$employees' },
    } },
    { $sort: { peopleCount: -1, scans: -1 } },
    { $limit: limit },
  ]);

  return resolveNames(rows);
}

/** Replace employee ids with names, in one query for the whole result set. */
async function resolveNames(rows) {
  const ids = rows.flatMap(r => r.employees || []).filter(Boolean);
  if (ids.length === 0) return rows;
  const employees = await Employee.find({ _id: { $in: ids } }).select('name employeeId').lean();
  const byId = new Map(employees.map(e => [String(e._id), e]));
  return rows.map(r => ({
    ...r,
    employees: (r.employees || []).map(id => byId.get(String(id))).filter(Boolean),
  }));
}

/**
 * Scans whose GPS the trust heuristics found something odd about.
 *
 * These were all recorded normally — locationTrust never blocks — so this is
 * a review queue, not a rejection log.
 */
async function flaggedLocations(match, limit = 30) {
  return AttendanceLog.find({ ...match, locationFlags: { $exists: true, $ne: [] } })
    .populate('employee', 'name employeeId')
    .sort({ clockInTime: -1 })
    .limit(limit)
    .select('employee date clockInTime siteName locationFlags clockInAccuracyMeters deviceId')
    .lean();
}

module.exports = { sharedDevices, flaggedLocations, SHARED_DEVICE_MIN_PEOPLE };
