// Works out which site a scan is being made from, using the phone's GPS.
//
// With a fixed tablet per site the site was known from the device. Employees
// scan from their own phones instead, so it has to come from the coordinates.
//
// This is worth doing for more than tidiness: scoping face matching to the
// people assigned to *this* site cuts the candidate pool from ~4,000 to the
// couple of hundred who work there. Fewer candidates is both faster and
// materially more accurate — every extra enrolled face is another chance for
// a false match.
const WorkLocation = require('../models/WorkLocation');
const { calculateDistance } = require('./geofence');

/**
 * Sites whose geofence contains this point, nearest first.
 *
 * Sites can legitimately overlap (two client buildings on one campus), so
 * this returns every match rather than guessing. Matching is then scoped to
 * the union of their rosters, and the employee's own geofence check still
 * decides whether they may actually clock in.
 */
async function sitesAtLocation(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  // The whole site list is small (hundreds at most) and changes rarely, so a
  // full scan is cheaper and simpler than a geospatial index here.
  const sites = await WorkLocation.find({ isActive: true })
    .select('name latitude longitude radiusMeters')
    .lean();

  const within = [];
  for (const site of sites) {
    if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) continue;
    const distance = calculateDistance(lat, lon, site.latitude, site.longitude);
    if (distance <= (site.radiusMeters || 150)) {
      within.push({ ...site, distanceMeters: Math.round(distance) });
    }
  }
  within.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return within;
}

/**
 * The nearest site regardless of radius, for diagnostics.
 *
 * When someone is refused for being outside every geofence, "you are 380 m
 * from Anna Nagar" is actionable; "not at a site" is not.
 */
async function nearestSite(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const sites = await WorkLocation.find({ isActive: true })
    .select('name latitude longitude radiusMeters')
    .lean();

  let best = null;
  for (const site of sites) {
    if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) continue;
    const distance = calculateDistance(lat, lon, site.latitude, site.longitude);
    if (!best || distance < best.distanceMeters) {
      best = { ...site, distanceMeters: Math.round(distance) };
    }
  }
  return best;
}

module.exports = { sitesAtLocation, nearestSite };
