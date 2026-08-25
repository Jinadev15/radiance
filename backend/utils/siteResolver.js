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

// A fix this imprecise cannot establish presence at a site at all.
//
// Phone GNSS is 5-20 m outdoors and 20-100 m inside a building; wifi
// positioning is 100-500 m. Anything past this is a cell-tower estimate with
// no satellite lock behind it, and its centre landing inside a 150 m fence
// says nothing about where the person actually is — they could be a
// kilometre away.
//
// The ceiling is deliberately generous rather than tight. Refusing at, say,
// 200 m would lock out honest workers scanning inside a basement or a metal
// warehouse, and a false refusal at 6 AM is worse than a coarse fix that the
// site geofence still has to pass anyway.
const MAX_USABLE_ACCURACY_M = Number(process.env.MAX_USABLE_ACCURACY_M || 1000);

function gateError(status, message, code) {
  return Object.assign(new Error(message), {
    isServiceError: true, status, error: message, code,
  });
}

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

/**
 * The whole location gate for a scan, run *before* any ML work.
 *
 * Previously a request that simply omitted its coordinates sailed through
 * face extraction and a match against all 4,000 employees, and was only
 * refused at the geofence right at the end. The attendance outcome was
 * correct, but it made the most expensive operation in the system reachable
 * in a loop by anyone who found the scanner URL — which is now a public page
 * by design. Checking the cheap thing first is the point.
 *
 * @param {object}  params
 * @param {boolean} params.requireSite  refuse when the fix is outside every
 *        fence. True for clock-in. False for clock-out: someone mid-shift at
 *        a site HR has just deactivated still has to be able to close their
 *        session, and their own site's geofence is checked either way.
 * @returns {Promise<{siteIds: ObjectId[]|null, sites: object[]}>}
 * @throws  a service error carrying {status, error, code}
 */
async function resolveScanSite({ latitude, longitude, accuracy, verb, requireSite = true }) {
  const lat = latitude === undefined || latitude === null ? null : Number(latitude);
  const lon = longitude === undefined || longitude === null ? null : Number(longitude);

  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw gateError(
      403,
      `Location access is required to ${verb}. Please turn on location for this page and try again.`,
      'LOCATION_REQUIRED'
    );
  }

  // A reported accuracy is not trustworthy — a spoofing app can claim any
  // number it likes — so this is not a security control. It is an honesty
  // control for the ordinary case: a phone that genuinely has no GPS lock
  // should be told to go outside, not quietly recorded as present.
  if (accuracy !== undefined && accuracy !== null) {
    const metres = Number(accuracy);
    if (Number.isFinite(metres) && metres > MAX_USABLE_ACCURACY_M) {
      throw gateError(
        403,
        `Your phone's location is only accurate to about ${Math.round(metres)}m, which is too rough ` +
        'to confirm you are at the site. Please step outside or near a window and try again.',
        'LOCATION_TOO_IMPRECISE'
      );
    }
  }

  const sites = await sitesAtLocation(lat, lon);
  if (sites.length > 0) return { siteIds: sites.map(s => s._id), sites };

  if (!requireSite) return { siteIds: null, sites: [] };

  const closest = await nearestSite(lat, lon);
  throw gateError(
    403,
    closest
      ? `You're ${closest.distanceMeters}m from ${closest.name}, which is too far to ${verb}. ` +
        'Please move closer to your site and try again.'
      : 'You do not appear to be at any Radiance site. Please check your location settings.',
    'NOT_AT_ANY_SITE'
  );
}

module.exports = { sitesAtLocation, nearestSite, resolveScanSite, MAX_USABLE_ACCURACY_M };
