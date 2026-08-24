// Checks a newly-captured face embedding against already-enrolled employees,
// using the same matcher as clock-in recognition.
//
// This is what stops the classic buddy-punching setup: enrolling a second
// "ghost" identity from a photo of someone who already has a profile, so one
// person can clock in twice.
const Employee = require('../models/Employee');
const ml = require('./mlServiceCall');

/**
 * @param {number[]} newEmbedding
 * @param {object} [options]
 * @param {*} [options.excludeEmployeeId]  skip this employee — required when
 *        re-enrolling someone's own face, otherwise they always collide with
 *        themselves and re-enrolment is impossible.
 * @param {boolean} [options.includeInactive=true]  also compare against
 *        deactivated profiles. A former employee's face reappearing is
 *        something HR needs to know about (it is either a rehire or an
 *        attempt to enrol a second profile), so the default is to look.
 * @returns {Promise<{employee: object, confidence: number}|null>}
 */
async function findDuplicateFace(newEmbedding, { excludeEmployeeId, includeInactive = true } = {}) {
  const statuses = includeInactive
    ? [Employee.STATUS.ACTIVE, Employee.STATUS.PENDING, Employee.STATUS.INACTIVE]
    : [Employee.STATUS.ACTIVE, Employee.STATUS.PENDING];

  const filter = {
    status: { $in: statuses },
    faceEmbeddings: { $exists: true, $not: { $size: 0 } },
  };
  if (excludeEmployeeId) filter._id = { $ne: excludeEmployeeId };

  const existing = await Employee.find(filter).select('faceEmbeddings name employeeId status');
  if (existing.length === 0) return null;

  const candidates = {};
  for (const emp of existing) candidates[emp._id.toString()] = emp.faceEmbeddings;

  // Enrolment uses a *looser* margin than clock-in on purpose. At clock-in an
  // ambiguous result must be refused (crediting the wrong person's hours is
  // unrecoverable). Here, ambiguity is itself the signal worth acting on — a
  // near-match to an existing profile is exactly what we want to catch, so
  // requiring a clear margin would let the duplicate through.
  const result = await ml.recognise(newEmbedding, candidates, { minMargin: 0 });
  if (!result || !result.match || !result.matched_id) return null;

  const employee = existing.find(emp => emp._id.toString() === result.matched_id);
  if (!employee) return null;

  return { employee, confidence: result.confidence };
}

module.exports = { findDuplicateFace };
