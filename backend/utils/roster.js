// Who was actually expected at work on a given day.
//
// The dashboard used to compute `absent = totalEmployees - presentToday`,
// which silently merged four different situations into one alarming number:
// genuinely absent, on approved leave, on their weekly off, and a public
// holiday. Every Sunday reported the whole workforce as missing, and the
// daily digest emailed HR a list of people who were legitimately off — which
// is exactly the kind of noise that gets a system switched off.
//
// This module resolves the roster for one business date in a fixed number of
// queries (three, regardless of headcount) and returns a breakdown the
// dashboard can show honestly.
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const AttendanceLog = require('../models/AttendanceLog');
const { businessDayOfWeek, startOfBusinessDay, DEFAULT_TZ } = require('./tz');

/**
 * @param {string} dateStr    'YYYY-MM-DD' business date
 * @param {Array}  employees  lean employee docs; needs _id, workLocation, weeklyOff
 * @param {string} [timeZone]
 */
async function resolveDay(dateStr, employees, timeZone = DEFAULT_TZ) {
  const employeeIds = employees.map(e => e._id);

  const [onLeave, holidays, logs] = await Promise.all([
    LeaveRequest.approvedOnDate(dateStr, employeeIds),
    Holiday.onDate(dateStr),
    AttendanceLog.find({ date: dateStr, employee: { $in: employeeIds } })
      .select('employee status clockInTime clockOutTime totalHours overtimeHours sessionNumber')
      .lean(),
  ]);

  // A day can hold several sessions per person. "Present" is a property of
  // the person, so collapse to their earliest session — that's the one whose
  // LATE flag reflects when they actually turned up.
  const firstSessionByEmployee = new Map();
  const hoursByEmployee = new Map();
  for (const log of logs) {
    const key = String(log.employee);
    const existing = firstSessionByEmployee.get(key);
    if (!existing || new Date(log.clockInTime) < new Date(existing.clockInTime)) {
      firstSessionByEmployee.set(key, log);
    }
    hoursByEmployee.set(key, (hoursByEmployee.get(key) || 0) + (log.totalHours || 0));
  }

  // Day-of-week is resolved in the business timezone: on a UTC host the
  // server's own day can differ from the site's for several hours a day.
  const dayOfWeek = businessDayOfWeek(startOfBusinessDay(dateStr, timeZone), timeZone);

  const buckets = {
    present: [], late: [], onTime: [], absent: [],
    onLeave: [], weeklyOff: [], holiday: [], stillClockedIn: [],
  };

  for (const emp of employees) {
    const key = String(emp._id);
    const log = firstSessionByEmployee.get(key);
    const siteKey = emp.workLocation ? String(emp.workLocation) : null;
    const isHoliday = holidays.companyWide || (siteKey && holidays.siteIds.has(siteKey));
    const offDays = Array.isArray(emp.weeklyOff) ? emp.weeklyOff : [];
    const isWeeklyOff = offDays.includes(dayOfWeek);

    if (log) {
      // Someone who came in on a holiday or their day off is present, and
      // that fact matters more than the calendar — it's usually overtime.
      buckets.present.push(emp);
      if (log.status === 'LATE') buckets.late.push(emp);
      else buckets.onTime.push(emp);
      if (!log.clockOutTime) buckets.stillClockedIn.push(emp);
      continue;
    }

    // Precedence: holiday, then weekly off, then approved leave, then absent.
    // Holiday first because it applies to everyone regardless of their own
    // arrangements, and a worker shouldn't burn leave on a closed site.
    if (isHoliday) buckets.holiday.push(emp);
    else if (isWeeklyOff) buckets.weeklyOff.push(emp);
    else if (onLeave.has(key)) buckets.onLeave.push(emp);
    else buckets.absent.push(emp);
  }

  const expected = employees.length
    - buckets.holiday.length
    - buckets.weeklyOff.length
    - buckets.onLeave.length;

  return {
    date: dateStr,
    dayOfWeek,
    totalEmployees: employees.length,
    // "Expected in today" — the only denominator an attendance percentage
    // should ever use.
    expected: Math.max(0, expected),
    present: buckets.present.length,
    onTime: buckets.onTime.length,
    late: buckets.late.length,
    absent: buckets.absent.length,
    onLeave: buckets.onLeave.length,
    weeklyOff: buckets.weeklyOff.length,
    holiday: buckets.holiday.length,
    stillClockedIn: buckets.stillClockedIn.length,
    attendanceRate: expected > 0 ? Math.round((buckets.present.length / expected) * 100) : null,
    buckets,
    hoursByEmployee,
  };
}

module.exports = { resolveDay };
