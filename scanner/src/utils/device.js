// A stable, anonymous identifier for this phone.
//
// Employees clock in from their own handsets, so there is nothing to
// provision and no shared secret worth distributing — a token handed to
// 4,000 people is not a token. Identity is proved by the face; location by
// GPS. This value only answers "which phone was this scan taken on".
//
// It is explicitly NOT a credential. Anyone can clear it, and anyone can
// forge one. It earns its place for two things:
//   1. One phone cannot hold two people clocked in at the same time, so a
//      single handset can't walk the floor clocking in colleagues from
//      photos of them (backend/utils/attendanceEngine.assertDeviceFree).
//   2. "Eleven people scanned from one device today" becomes visible to HR
//      instead of invisible.
//
// Storage is best-effort. A phone in private browsing, or with storage
// blocked, simply scans without an id — that degrades the two checks above
// rather than locking an employee out of their own attendance.
const DEVICE_KEY = 'radiance_device_id';

// Matches backend/middleware/kiosk.js DEVICE_ID_PATTERN. Kept URL-safe so it
// survives being logged, indexed and shown in the dashboard unescaped.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

function generateId() {
  const bytes = new Uint8Array(24);
  // crypto.getRandomValues is available on every browser that can also run
  // getUserMedia, so the Math.random fallback is unreachable in practice —
  // it exists so an insecure-context dev server doesn't hard-crash.
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

let cached = null;

/**
 * This phone's id, creating and persisting one on first use.
 * @returns {string|null} null only when storage is unavailable.
 */
export function deviceId() {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) {
      cached = existing;
      return cached;
    }
    const fresh = generateId();
    localStorage.setItem(DEVICE_KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    // Private browsing or storage disabled. Deliberately not falling back to
    // an in-memory id: that would be a *different* device on every page load,
    // which is worse than none — it would make the "two people on one phone"
    // check silently useless while looking like it worked.
    return null;
  }
}

/** Headers identifying this phone. */
export function deviceHeaders() {
  const id = deviceId();
  return id ? { 'X-Device-Id': id } : {};
}
