import { enqueue, isNetworkError, queueLength } from './offlineQueue';
import { deviceHeaders, kioskSiteId } from './device';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Identifies this device to the backend (see backend/middleware/kiosk.js).
// Credentials come from this device's own storage, provisioned once via a
// setup link — deliberately NOT from a VITE_ variable, which Vite would
// inline into the bundle and ship to every visitor. See utils/device.js.
function kioskHeaders() {
  return { 'Content-Type': 'application/json', ...deviceHeaders() };
}

export { kioskSiteId };

// Note on the offline path: queuing stores the raw scan and replays it once
// connectivity returns — actual face match / liveness / geofence verification
// only happens server-side at sync time, same as always. So a queued scan is
// "saved, pending verification," not a confirmed clock-in — the UI says so
// rather than claiming success we can't actually know yet.
async function postWithOfflineFallback(endpoint, body, offlineMessage) {
  // Stamped here, at the moment of the actual scan — not when a later sync
  // eventually happens. Sent on every request (not just queued ones) so a
  // slow-but-successful live request is timestamped just as precisely.
  const withCapture = { ...body, capturedAt: new Date().toISOString() };

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: kioskHeaders(),
      body: JSON.stringify(withCapture),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.msg || data.message || 'Request failed');
    return data;
  } catch (err) {
    if (isNetworkError(err)) {
      const result = await enqueue(endpoint, withCapture);
      if (!result.ok) {
        // Never let a storage failure look like a successful clock-in — the
        // employee needs to know to find their supervisor instead of
        // walking away believing they're recorded.
        throw new Error('Could not save your scan for later. Please tell your supervisor.');
      }
      return { success: true, queued: true, message: offlineMessage, pendingCount: await queueLength() };
    }
    throw err;
  }
}

// images: array of 1-2 base64 frames captured a few hundred ms apart —
// the second frame is what lets the backend check for real movement.
export async function clockIn(images, latitude, longitude) {
  return postWithOfflineFallback(
    '/v1/clock-in',
    { images, latitude, longitude },
    "No connection right now — your scan is saved and will be verified automatically once we're back online."
  );
}

export async function clockOut(images, latitude, longitude) {
  return postWithOfflineFallback(
    '/v1/clock-out',
    { images, latitude, longitude },
    "No connection right now — your scan is saved and will be verified automatically once we're back online."
  );
}

// Registration is NOT queued offline — it needs a live duplicate-face check
// against the server, so it fails clearly and asks the employee to retry
// once connectivity is back, rather than silently enrolling unverified.
// `images` is the same 2-frame capture used for clock-in/out — passing both
// (not just the first) lets the backend run a real liveness check on
// enrolment too, not just on later clock-ins.
export async function registerEmployee(name, phone, nationalId, dateOfBirth, images, extra = {}) {
  const response = await fetch(`${API_URL}/v1/register`, {
    method: 'POST',
    headers: kioskHeaders(),
    body: JSON.stringify({ name, phone, nationalId, dateOfBirth, images, ...extra }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.msg || data.message || 'Registration failed');
  return data;
}

// Active sites for the registration form's site picker. Public-but-gated
// endpoint (see backend/routes/locations.js /public) — the kiosk has no
// dashboard login, so it can't use the authenticated GET /locations.
export async function fetchSites() {
  const response = await fetch(`${API_URL}/v1/locations/public`, { headers: kioskHeaders() });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load site list');
  return data;
}

// Self-service — neither of these are queued offline, both need a live answer.
export async function fetchMyAttendance(images) {
  const response = await fetch(`${API_URL}/v1/my-attendance`, {
    method: 'POST',
    headers: kioskHeaders(),
    body: JSON.stringify({ images }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.msg || 'Could not look up your attendance');
  return data;
}

export async function reportIssue(images, date, reason) {
  const response = await fetch(`${API_URL}/v1/regularization`, {
    method: 'POST',
    headers: kioskHeaders(),
    body: JSON.stringify({ images, date, reason }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.msg || 'Could not submit your report');
  return data;
}

export { queueLength };
