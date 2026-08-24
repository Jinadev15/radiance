// Kiosk device authentication.
//
// The scanner is a public web page, so before this existed anyone on the
// internet who found the URL could register themselves as an employee and
// start clocking in. The geofence was the only barrier, and browser
// geolocation is straightforward to spoof — so the real control has to be
// that the request comes from a device the company actually deployed.
//
// A kiosk sends a shared token plus its site id. The token proves the device
// is one of ours; the site id lets the backend scope face matching to that
// site's roster (fewer candidates means both faster and more accurate
// identification) and stamp registrations with the right site.
//
// Configuration is a single env var so a site can be added without a code
// change:
//
//   KIOSK_DEVICES='<siteId>:<token>,<siteId>:<token>'
//
// Or, for a single-site deployment or during migration:
//
//   KIOSK_TOKEN='<token>'          (any site, or none)
//
// With neither set the middleware allows the request through and logs a
// warning — otherwise upgrading an already-deployed kiosk would lock every
// employee out the moment the backend redeployed. Set KIOSK_ENFORCE=true to
// make a missing/incorrect token a hard 401 once the kiosks are updated.
const mongoose = require('mongoose');

const ENFORCE = process.env.KIOSK_ENFORCE === 'true';

// siteId -> token, parsed once at boot.
const deviceMap = new Map();
if (process.env.KIOSK_DEVICES) {
  for (const entry of process.env.KIOSK_DEVICES.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.lastIndexOf(':');
    if (idx <= 0) {
      console.warn(`[Kiosk] Ignoring malformed KIOSK_DEVICES entry: "${trimmed}" (expected <siteId>:<token>)`);
      continue;
    }
    const siteId = trimmed.slice(0, idx).trim();
    const token = trimmed.slice(idx + 1).trim();
    if (!mongoose.isValidObjectId(siteId)) {
      console.warn(`[Kiosk] Ignoring KIOSK_DEVICES entry with invalid site id: "${siteId}"`);
      continue;
    }
    if (token.length < 16) {
      console.warn(`[Kiosk] Ignoring KIOSK_DEVICES token for ${siteId}: tokens must be at least 16 characters`);
      continue;
    }
    deviceMap.set(siteId, token);
  }
}

const GLOBAL_TOKEN = (process.env.KIOSK_TOKEN || '').trim();
const CONFIGURED = deviceMap.size > 0 || GLOBAL_TOKEN.length >= 16;

if (!CONFIGURED) {
  console.warn(
    '[Kiosk] No KIOSK_DEVICES/KIOSK_TOKEN configured — the scanner endpoints are ' +
    'reachable by anyone who knows the URL. Configure device tokens and set ' +
    'KIOSK_ENFORCE=true before treating this deployment as production.'
  );
} else {
  console.log(`[Kiosk] Device auth configured for ${deviceMap.size} site(s)${GLOBAL_TOKEN ? ' + a global token' : ''}; enforcement=${ENFORCE}`);
}

// Constant-time comparison so a wrong token can't be recovered by timing.
function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Validates the kiosk device and attaches `req.kioskSiteId`.
 *
 * `req.kioskSiteId` is the *authenticated* site — derived from which token
 * matched, never from a value the client asked for. That distinction is the
 * whole point: a client-supplied site id could be swapped to enrol someone at
 * a site they don't work at.
 */
function requireKioskDevice(req, res, next) {
  const token = (req.header('X-Kiosk-Token') || '').trim();
  const claimedSite = (req.header('X-Kiosk-Site') || '').trim();

  if (!CONFIGURED) {
    // Unconfigured: allow through, but honour a site hint so the site-scoping
    // benefits work during rollout. Only accept a well-formed id.
    req.kioskSiteId = mongoose.isValidObjectId(claimedSite) ? claimedSite : null;
    req.kioskAuthenticated = false;
    return next();
  }

  if (token) {
    // Per-site token: the site comes from the map, not from the request.
    for (const [siteId, expected] of deviceMap) {
      if (tokensMatch(token, expected)) {
        req.kioskSiteId = siteId;
        req.kioskAuthenticated = true;
        return next();
      }
    }
    // Global token: no site is implied, so fall back to the hint.
    if (GLOBAL_TOKEN && tokensMatch(token, GLOBAL_TOKEN)) {
      req.kioskSiteId = mongoose.isValidObjectId(claimedSite) ? claimedSite : null;
      req.kioskAuthenticated = true;
      return next();
    }
  }

  if (ENFORCE) {
    return res.status(401).json({
      error: 'This device is not registered for attendance scanning. Please contact your administrator.',
      code: 'KIOSK_NOT_REGISTERED',
    });
  }

  // Configured but not enforcing: let it through so a partially-updated fleet
  // keeps working, and make the gap loud in the logs.
  console.warn(`[Kiosk] Unauthenticated scanner request from ${req.ip} (enforcement is off)`);
  req.kioskSiteId = mongoose.isValidObjectId(claimedSite) ? claimedSite : null;
  req.kioskAuthenticated = false;
  return next();
}

function kioskStatus() {
  return { configured: CONFIGURED, enforcing: ENFORCE, sites: deviceMap.size, globalToken: Boolean(GLOBAL_TOKEN) };
}

module.exports = { requireKioskDevice, kioskStatus };
