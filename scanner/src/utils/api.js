import { enqueue, isNetworkError } from './offlineQueue';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Note on the offline path: queuing stores the raw scan and replays it once
// connectivity returns — actual face match / liveness / geofence verification
// only happens server-side at sync time, same as always. So a queued scan is
// "saved, pending verification," not a confirmed clock-in — the UI says so
// rather than claiming success we can't actually know yet.
async function postWithOfflineFallback(endpoint, body, offlineMessage) {
  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.msg || data.message || 'Request failed');
    return data;
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(endpoint, body);
      return { success: true, queued: true, message: offlineMessage };
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
export async function registerEmployee(name, phone, nationalId, dateOfBirth, image, extra = {}) {
  const response = await fetch(`${API_URL}/v1/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone, nationalId, dateOfBirth, imageBase64: image, ...extra })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.msg || data.message || 'Registration failed');
  return data;
}

// Self-service — neither of these are queued offline, both need a live answer.
export async function fetchMyAttendance(images) {
  const response = await fetch(`${API_URL}/v1/my-attendance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.msg || 'Could not look up your attendance');
  return data;
}

export async function reportIssue(images, date, reason) {
  const response = await fetch(`${API_URL}/v1/regularization`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, date, reason })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.msg || 'Could not submit your report');
  return data;
}
