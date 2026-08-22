const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const AttendanceLog = require('../models/AttendanceLog');
const WorkLocation = require('../models/WorkLocation');
const auth = require('../middleware/auth');

// GET /api/v1/dashboard/stats
// GET /api/v1/dashboard/stats?workLocation=<id>  — scoped to one site
router.get('/stats', auth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(200).json({ totalEmployees: 0, presentToday: 0, absent: 0, onTime: 0, late: 0, bySite: [] });
    }

    // Supervisors are always pinned to their own site, regardless of what
    // they pass in the query string — no way to peek at another site's numbers.
    const isSupervisor = req.user.role === 'supervisor' && req.user.workLocation;
    const workLocation = isSupervisor ? req.user.workLocation : req.query.workLocation;
    const employeeFilter = { isActive: true };
    if (workLocation) employeeFilter.workLocation = workLocation;

    const employees = await Employee.find(employeeFilter).select('_id workLocation');
    const employeeIds = employees.map(e => e._id);
    const totalEmployees = employees.length;

    const today = new Date().toISOString().split('T')[0];
    const todaysLogs = await AttendanceLog.find({ date: today, employee: { $in: employeeIds } });

    const presentToday = todaysLogs.length;
    const onTime = todaysLogs.filter(log => log.status === 'VALID').length;
    const late = todaysLogs.filter(log => log.status === 'LATE').length;
    const absent = Math.max(0, totalEmployees - presentToday);

    // Per-site breakdown — this is what makes the dashboard a multi-site view
    // instead of a single aggregate number. Only computed for the unscoped
    // call. Done as one aggregation joining employees -> today's logs,
    // rather than pulling every employee/log into Node and joining in JS.
    let bySite = [];
    if (!workLocation) {
      const [sites, siteCounts] = await Promise.all([
        WorkLocation.find({ isActive: true }).select('name radiusMeters'),
        Employee.aggregate([
          { $match: { isActive: true } },
          {
            $lookup: {
              from: 'attendancelogs',
              let: { empId: '$_id' },
              pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$employee', '$$empId'] }, { $eq: ['$date', today] }] } } }],
              as: 'log',
            },
          },
          {
            $group: {
              _id: '$workLocation',
              totalEmployees: { $sum: 1 },
              presentToday: { $sum: { $cond: [{ $gt: [{ $size: '$log' }, 0] }, 1, 0] } },
              late: { $sum: { $cond: [{ $eq: [{ $arrayElemAt: ['$log.status', 0] }, 'LATE'] }, 1, 0] } },
            },
          },
        ]),
      ]);

      const countsBySite = new Map(siteCounts.map(c => [c._id ? c._id.toString() : 'unassigned', c]));
      bySite = sites.map(site => {
        const c = countsBySite.get(site._id.toString()) || { totalEmployees: 0, presentToday: 0, late: 0 };
        return { siteId: site._id, siteName: site.name, totalEmployees: c.totalEmployees, presentToday: c.presentToday, late: c.late };
      });

      const unassigned = countsBySite.get('unassigned');
      if (unassigned && unassigned.totalEmployees > 0) {
        bySite.push({ siteId: null, siteName: 'Unassigned', totalEmployees: unassigned.totalEmployees, presentToday: unassigned.presentToday, late: unassigned.late });
      }
    }

    res.status(200).json({ totalEmployees, presentToday, absent, onTime, late, bySite });
  } catch (error) {
    // A genuine query failure and "0 employees registered" rendered
    // identically to the dashboard before this — no way to tell a broken
    // stats query apart from a real empty account.
    console.error('[Stats/GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// GET /api/v1/dashboard/trend?days=7 — real per-day attendance history for
// the dashboard charts (present / on-time / late counts per day), replacing
// what used to be today's single stat repeated across fake day labels.
router.get('/trend', auth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const dates = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }

    if (mongoose.connection.readyState !== 1) {
      return res.json(dates.map(date => ({ date, present: 0, onTime: 0, late: 0 })));
    }

    const isSupervisor = req.user.role === 'supervisor' && req.user.workLocation;
    const employeeFilter = { isActive: true };
    if (isSupervisor) employeeFilter.workLocation = req.user.workLocation;
    const employeeIds = isSupervisor ? (await Employee.find(employeeFilter).select('_id')).map(e => e._id) : null;

    const matchStage = { date: { $in: dates } };
    if (employeeIds) matchStage.employee = { $in: employeeIds };

    const rows = await AttendanceLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$date',
          present: { $sum: 1 },
          onTime: { $sum: { $cond: [{ $eq: ['$status', 'VALID'] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', 'LATE'] }, 1, 0] } },
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
});

module.exports = router;
