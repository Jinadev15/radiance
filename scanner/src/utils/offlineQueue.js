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
const MAX_SYNC_ATTEMPTS = 20; // ~ a stale/broken item shouldn't retry forever

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
        if (res.ok || res.status < 500) {
          // 2xx (recorded) or 4xx (e.g. a stale/invalid scan the server has a
          // real, final answer for) — both are resolved. Don't retry those.
          await withStore('readwrite', store => reqToPromise(store.delete(item.id)));
        } else {
          await bumpAttempts(item);
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

async function bumpAttempts(item) {
  const attempts = (item.attempts || 0) + 1;
  if (attempts >= MAX_SYNC_ATTEMPTS) {
    console.error(`[OfflineQueue] Dropping scan ${item.id} after ${attempts} failed sync attempts.`);
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
