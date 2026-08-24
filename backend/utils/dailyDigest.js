// One daily summary email instead of a notification per late scan — nobody
// wants fifty emails from one site having a rough morning.
//
// Rebuilt on utils/roster.js so "not yet clocked in" no longer includes
// people on approved leave, their weekly off, or a holiday — the previous
// version emailed HR a list of everyone legitimately off, every single
// Sunday.
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const SpoofAttemptLog = require('../models/SpoofAttemptLog');
require('../models/WorkLocation'); // registers the model .populate('workLocation') needs
const { notifyAdmins } = require('./notify');
const { resolveDay } = require('./roster');
const { businessDate, DEFAULT_TZ } = require('./tz');

async function sendDailyDigest() {
  if (mongoose.connection.readyState !== 1) return;

  const today = businessDate(new Date(), DEFAULT_TZ);
  // rosterFilter, not activeFilter — a pending-approval employee can already
  // clock in (see Employee.matchableFilter), so they belong in the digest's
  // late/absent reckoning too, not just employees HR has confirmed.
  const employees = await Employee.find(Employee.rosterFilter())
    .select('_id name employeeId workLocation weeklyOff')
    .populate('workLocation', 'name')
    .lean();

  const day = await resolveDay(today, employees, DEFAULT_TZ);

  // resolveDay's buckets hold the same employee docs passed in, so no second
  // lookup is needed — just format them.
  const formatEmp = (emp) => `  - ${emp.name} (${emp.employeeId}) — ${emp.workLocation?.name || 'Unassigned'}`;
  const lateLines = day.buckets.late.map(formatEmp);
  const absentLines = day.buckets.absent.map(formatEmp);

  const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const spoofCount = await SpoofAttemptLog.countDocuments({ createdAt: { $gte: dayStart } });

  if (lateLines.length === 0 && absentLines.length === 0 && spoofCount === 0) return;

  const lines = [
    `Radiance daily attendance summary — ${today}`,
    '',
    `Expected today: ${day.expected} (of ${day.totalEmployees} active employees; ` +
    `${day.onLeave} on leave, ${day.weeklyOff} on weekly off, ${day.holiday} on holiday)`,
    `Present: ${day.present} (${day.attendanceRate ?? '—'}%) | On time: ${day.onTime} | Late: ${day.late}`,
    '',
    `Late arrivals (${lateLines.length}):`,
    ...(lateLines.length ? lateLines : ['  none']),
    '',
    `Not yet clocked in, no leave/holiday on file (${absentLines.length}):`,
    ...(absentLines.length ? absentLines : ['  none']),
  ];

  if (spoofCount > 0) {
    lines.push('', `Liveness/spoof check failures in the last 24h: ${spoofCount} (see Security in the dashboard)`);
  }

  await notifyAdmins(
    `Attendance summary for ${today} — ${day.late} late, ${absentLines.length} unexplained absent`,
    lines.join('\n')
  );
}

module.exports = { sendDailyDigest };
