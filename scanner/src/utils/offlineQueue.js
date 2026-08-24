// Queues clock-in/out requests when the network is down (patchy site Wi-Fi is
// the norm, not the exception, for a kiosk) and replays them automatically
// once connectivity returns.
//
// Rebuilt on IndexedDB rather than localStorage. Each queued scan holds two
// base64 JPEG frames (~400KB combined); localStorage caps out around 5MB, so
// after roughly a dozen queued scans `setItem` started throwing
// QuotaExceededError — uncaught, which meant the kiosk simply stopped
// accepting scans partway through an outage. IndexedDB has no such practical
// limit for this use case, and this module still exposes the same
// queueLength/enqueue/trySync/startAutoSync surface so nothing else in the
// app needs to change.
//
// Registration is deliberately NOT queued — it needs a live face-duplicate
// check against the server, so it fails clearly and asks the employee to try
// again once online, rather than silently enrolling unverified.
const DB_NAME = 'radiance_kiosk';
const DB_VERSION = 1;
const STORE = 'offline_queue';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    Promise.resolve(fn(store))
      .then(r => { result = r; })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqToPromise(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(idbRequest.error);
  });
}

async function readQueue() {
  try {
    return await withStore('readonly', store => reqToPromise(store.getAll()));
  } catch {
    return [];
  }
}

export async function queueLength() {
  try {
    return await withStore('readonly', store => reqToPromise(store.count()));
  } catch {
    return 0;
  }
}

// Stamps the real scan time onto the queued item — this is what a replayed
// offline scan is timestamped with server-side (see `capturedAt` sent by
// api.js), instead of the previous behaviour of recording whenever the sync
// eventually happened. A four-hour Wi-Fi outage used to mean forty people all
// showed up as clocking in at the same minute, once the network returned.
export async function enqueue(endpoint, body) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    endpoint,
    body: { ...body, capturedAt: body.capturedAt || new Date().toISOString() },
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  try {
    await withStore('readwrite', store => reqToPromise(store.add(item)));
    return { ok: true };
  } catch (err) {
    // IndexedDB failing (private browsing mode with storage disabled, a
    // corrupted database, disk genuinely full) must never look like a
    // silent success — the employee needs to be told to find their
    // supervisor rather than walking away believing they clocked in.
    console.error('[OfflineQueue] Failed to save scan for later sync:', err);
    return { ok: false, error: err };
  }
}

// True network failure (server unreachable) vs a real HTTP error response —
// only the former should be queued; a 403/404 from a live server is a real
// answer and must not be retried forever.
export function isNetworkError(err) {
  return err instanceof TypeError; // fetch throws TypeError on network failure
}

let syncing = false;
// Matches the backend's own MAX_OFFLINE_AGE_MS (utils/attendanceEngine.js).
// Past this the server will reject the scan as too old no matter what, so
// retrying it forever just wastes the queue.
const MAX_QUEUE_AGE_HOURS = 36;

export async function trySync() {
  if (syncing) return;
  const queue = await readQueue();
  if (queue.length === 0) return;
  syncing = true;
  try {
    for (const item of queue) {
      try {
        const res = await fetch(`${API_URL}${item.endpoint}`, {
          method: 'POST',
          headers: kioskHeaders(),
          body: JSON.stringify(item.body),
        });
        // 429 is a 4xx but is emphatically NOT a final answer — it means
        // "try again shortly". Deleting on any 4xx meant a rate-limited
        // replay was thrown away permanently: exactly the case a big site
        // hits when a whole shift's queued scans sync at once after an
        // outage, so the scans most at risk were the ones being destroyed.
        // 408 (timeout) and 425 (too early) are retryable for the same reason.
        const retryable = res.status >= 500 || res.status === 429 || res.status === 408 || res.status === 425;

        if (retryable) {
          await bumpAttempts(item);
          // Back off for the rest of this pass rather than hammering a server
          // that has just told us to slow down.
          if (res.status === 429) {
            const retryAfter = Number(res.headers.get('Retry-After')) || 5;
            await new Promise(r => setTimeout(r, Math.min(retryAfter, 30) * 1000));
          }
        } else {
          // 2xx (recorded) or a genuine 4xx the server has a final answer for
          // (already clocked in, scan too old, unknown face) — resolved.
          await withStore('readwrite', store => reqToPromise(store.delete(item.id)));
        }
      } catch {
        await bumpAttempts(item); // still offline
      }
      // Small gap between replays so a big backlog doesn't arrive as one
      // burst that trips the server's rate limiter the moment Wi-Fi returns.
      await new Promise(r => setTimeout(r, 400));
    }
  } finally {
    syncing = false;
  }
}

// A queued scan is only given up on once it is too old for the server to
// accept anyway (the backend refuses a capture older than 36 hours), not
// after N attempts. Attempt-count expiry was dangerous: a long outage plus
// rate limiting could burn through the attempts and delete a real, still-
// recoverable attendance record.
async function bumpAttempts(item) {
  const attempts = (item.attempts || 0) + 1;
  const queuedAt = new Date(item.queuedAt || item.body?.capturedAt || Date.now()).getTime();
  const ageHours = (Date.now() - queuedAt) / 3600000;

  if (ageHours > MAX_QUEUE_AGE_HOURS) {
    console.error(
      `[OfflineQueue] Scan ${item.id} is ${ageHours.toFixed(1)}h old and can no longer be ` +
      'accepted by the server. Dropping — this attendance must be entered manually by HR.'
    );
    await withStore('readwrite', store => reqToPromise(store.delete(item.id))).catch(() => {});
    return;
  }
  await withStore('readwrite', store => reqToPromise(store.put({ ...item, attempts }))).catch(() => {});
}

// Kept in one place so a future change to kiosk auth doesn't need editing in
// two files — the live request path (api.js) builds the same headers.
function kioskHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = import.meta.env.VITE_KIOSK_TOKEN;
  const site = import.meta.env.VITE_KIOSK_SITE_ID;
  if (token) headers['X-Kiosk-Token'] = token;
  if (site) headers['X-Kiosk-Site'] = site;
  return headers;
}

export function startAutoSync() {
  window.addEventListener('online', trySync);
  trySync();
  return setInterval(trySync, 30_000);
}
