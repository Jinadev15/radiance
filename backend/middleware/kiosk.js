// Identifies the phone a scan came from.
//
// Employees clock in from their own phones, so there is no fixed device to
// authenticate and no shared secret worth distributing: a token handed to
// 4,000 people is not a token. Identity is proved by the face, and location
// by GPS. This middleware therefore does not gate access — it records *which
// handset* a scan came from.
//
// `req.deviceId` is a random value the browser generated and stores. It is
// explicitly NOT a credential:
//   * anyone can clear it and get a new one
//   * anyone can forge one
//
// It is fraud friction, and it earns its place for two things:
//   1. One phone cannot hold two people clocked in at the same time, so a
//      single handset cannot walk the floor clocking in a dozen colleagues
//      from photos of them (see attendanceEngine.assertDeviceFree).
//   2. "Eleven employees scanned from one device today" becomes visible to
//      HR instead of invisible.
//
// The public exposure this leaves is real and deliberate: anyone who finds
// the scanner URL can open it. What they cannot do is clock in — that needs
// a matching enrolled face, inside a site's geofence. Self-registration is
// gated behind HR approval (Employee.STATUS.PENDING), so a stranger
// registering themselves still cannot record attendance.
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Attaches `req.deviceId` when the client sent a well-formed one.
 *
 * Never rejects: a phone with storage disabled, or a browser that strips the
 * header, still needs to be able to clock its owner in. The device rules
 * degrade rather than lock someone out.
 */
function requireKioskDevice(req, res, next) {
  const raw = (req.header('X-Device-Id') || '').trim();
  // Reject a malformed value rather than storing junk that would then
  // "occupy" a device slot no real phone could ever match or clear.
  req.deviceId = DEVICE_ID_PATTERN.test(raw) ? raw : null;

  // Retained so a site can still hint which location it belongs to; the
  // authoritative site now comes from GPS (see utils/siteResolver.js).
  req.kioskSiteId = null;
  next();
}

function kioskStatus() {
  return {
    model: 'personal-device',
    deviceGating: false,
    note: 'Employees scan from their own phones; identity is the face, location is GPS.',
  };
}

module.exports = { requireKioskDevice, kioskStatus };
