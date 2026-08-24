const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { query, validationResult } = require('express-validator');
const Employee = require('../models/Employee');
const AttendanceLog = require('../models/AttendanceLog');
const WorkLocation = require('../models/WorkLocation');
const auth = require('../middleware/auth');
const { resolveDayBySite } = require('../utils/roster');
const { businessDate, recentBusinessDates, DEFAULT_TZ } = require('../utils/tz');

// GET /api/v1/dashboard/stats
// GET /api/v1/dashboard/stats?workLocation=<id>  — scoped to one site
//
// Rebuilt on utils/roster.js. Previously `absent = totalEmployees -
// presentToday` conflated four different things: genuinely absent, on
// approved leave, on a weekly off, and a public holiday — so every Sunday
// reported the whole workforce as missing. This now reports each bucket
// separately and computes the attendance rate against who was actually
// expected, not the full headcount.
router.get('/stats', auth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(200).json({
        totalEmployees: 0, expected: 0, presentToday: 0, absent: 0,
        onTime: 0, late: 0, onLeave: 0, weeklyOff: 0, holiday: 0,
        stillClockedIn: 0, attendanceRate: null, bySite: [],
      });
    }

    // Supervisors are always pinned to their own site regardless of what they
    // pass in the query string — no way to peek at another site's numbers.
    const isSupervisor = req.user.role === 'supervisor' && req.user.workLocation;
    const workLocation = isSupervisor ? req.user.workLocation : req.query.workLocation;
    const employeeFilter = Employee.rosterFilter();
    if (workLocation) employeeFilter.workLocation = workLocation;

    const today = businessDate(new Date(), DEFAULT_TZ);

    // One employee read and one grouped roster resolution, regardless of how
    // many sites exist. The previous version ran resolveDay() once per site
    // inside a Promise.all — ~380 concurrent queries at 126 sites, for a
    // single dashboard load.
    const employees = await Employee.find(employeeFilter)
      .select('_id workLocation weeklyOff').lean();
    const { totals, bySite: siteBuckets } = await resolveDayBySite(today, employees, DEFAULT_TZ);

    let bySite = [];
    if (!workLocation) {
      const sites = await WorkLocation.find({ isActive: true }).select('name').lean();
      const blank = { totalEmployees: 0, expected: 0, present: 0, late: 0, onLeave: 0, holiday: 0 };
      bySite = sites.map(site => {
        const b = siteBuckets[String(site._id)] || blank;
        return {
          siteId: site._id,
          siteName: site.name,
          totalEmployees: b.totalEmployees,
          expected: b.expected,
          presentToday: b.present,
          late: b.late,
          onLeave: b.onLeave,
          holiday: b.holiday,
        };
      });

      const unassigned = siteBuckets.unassigned;
      if (unassigned && unassigned.totalEmployees > 0) {
        bySite.push({
          siteId: null, siteName: 'Unassigned',
          totalEmployees: unassigned.totalEmployees,
          expected: unassigned.expected,
          presentToday: unassigned.present,
          late: unassigned.late,
          onLeave: unassigned.onLeave,
          holiday: unassigned.holiday,
        });
      }
    }

    res.status(200).json({
      totalEmployees: totals.totalEmployees,
      expected: totals.expected,
      presentToday: totals.present,
      absent: totals.absent,
      onTime: totals.onTime,
      late: totals.late,
      onLeave: totals.onLeave,
      weeklyOff: totals.weeklyOff,
      holiday: totals.holiday,
      stillClockedIn: totals.stillClockedIn,
      attendanceRate: totals.attendanceRate,
      bySite,
    });
  } catch (error) {
    console.error('[Stats/GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// GET /api/v1/dashboard/trend?days=7 — per-day attendance history for the
// dashboard charts.
router.get('/trend', auth,
  [query('days').optional().isInt({ min: 1, max: 90 }).toInt()],
  async (req, res) => {
    try {
      const days = req.query.days || 7;
      // Business dates, oldest first — the previous version built these from
      // the server's own local date, which on a UTC host drifted from the
      // actual business day for hours at a time.
      const dates = recentBusinessDates(days, DEFAULT_TZ).reverse();

      if (mongoose.connection.readyState !== 1) {
        return res.json(dates.map(date => ({ date, present: 0, onTime: 0, late: 0 })));
      }

      const isSupervisor = req.user.role === 'supervisor' && req.user.workLocation;
      const employeeFilter = Employee.rosterFilter();
      if (isSupervisor) employeeFilter.workLocation = req.user.workLocation;
      const employeeIds = isSupervisor ? (await Employee.find(employeeFilter).select('_id')).map(e => e._id) : null;

      const matchStage = { date: { $in: dates } };
      if (employeeIds) matchStage.employee = { $in: employeeIds };

      const rows = await AttendanceLog.aggregate([
        { $match: matchStage },
        // Sorted first so $first below reliably picks each employee's
        // earliest session of the day — the one whose LATE flag reflects
        // when they actually arrived, not an arbitrary later session.
        { $sort: { clockInTime: 1 } },
        {
          $group: {
            _id: { date: '$date', employee: '$employee' },
            firstStatus: { $first: '$status' },
          },
        },
        {
          $group: {
            _id: '$_id.date',
            present: { $sum: 1 },
            onTime: { $sum: { $cond: [{ $eq: ['$firstStatus', 'VALID'] }, 1, 0] } },
            late: { $sum: { $cond: [{ $eq: ['$firstStatus', 'LATE'] }, 1, 0] } },
          },
        },
      ]);
      const byDate = new Map(rows.map(r => [r._id, r]));

      res.json(dates.map(date => {
        const r = byDate.get(date);
        return { date, present: r?.present || 0, onTime: r?.onTime || 0, late: r?.late || 0 };
      }));
    } catch (error) {
      console.warn('[Trend Warning]', error.message);
      res.status(500).json({ error: 'Failed to fetch attendance trend' });
    }
  }
);

module.exports = router;
