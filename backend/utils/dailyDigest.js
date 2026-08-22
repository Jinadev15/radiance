// One daily summary email instead of a notification per late scan — nobody
// wants fifty emails from one site having a rough morning. Covers who's late
// and who hasn't shown up at all, as of whenever this runs.
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const AttendanceLog = require('../models/AttendanceLog');
require('../models/WorkLocation'); // registers the model .populate('workLocation') needs — don't rely on load order elsewhere
const { notifyAdmins } = require('./notify');

async function sendDailyDigest() {
  if (mongoose.connection.readyState !== 1) return;

  const today = new Date().toISOString().split('T')[0];
  const employees = await Employee.find({ isActive: true }).populate('workLocation', 'name');
  const todaysLogs = await AttendanceLog.find({ date: today });
  const logByEmployee = new Map(todaysLogs.map(l => [l.employee.toString(), l]));

  const late = [];
  const absent = [];
  employees.forEach(emp => {
    const log = logByEmployee.get(emp._id.toString());
    const site = emp.workLocation?.name || 'Unassigned';
    if (!log) {
      absent.push(`  - ${emp.name} (${emp.employeeId}) — ${site}`);
    } else if (log.status === 'LATE') {
      const time = new Date(log.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      late.push(`  - ${emp.name} (${emp.employeeId}) — ${site}, clocked in ${time}`);
    }
  });

  if (late.length === 0 && absent.length === 0) return; // nothing worth emailing about

  const lines = [
    `Radiance daily attendance summary — ${today}`,
    '',
    `Late arrivals (${late.length}):`,
    ...(late.length ? late : ['  none']),
    '',
    `Not yet clocked in (${absent.length}):`,
    ...(absent.length ? absent : ['  none']),
  ];

  await notifyAdmins(`Attendance summary for ${today} — ${late.length} late, ${absent.length} absent`, lines.join('\n'));
}

module.exports = { sendDailyDigest };
