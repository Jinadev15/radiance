// Queues clock-in/out requests when the network is down (patchy site Wi-Fi is
// the norm, not the exception, for a kiosk) and replays them automatically
// once connectivity returns. Registration is deliberately NOT queued — it
// needs a live face-duplicate check against the server, so it should just
// fail clearly and ask the employee to try again once online.
const QUEUE_KEY = 'radiance_offline_queue';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function queueLength() {
  return readQueue().length;
}

export function enqueue(endpoint, body) {
  const queue = readQueue();
  queue.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, endpoint, body, queuedAt: new Date().toISOString() });
  writeQueue(queue);
}

// True network failure (server unreachable) vs a real HTTP error response —
// only the former should be queued, a 403/404 from a live server is a real answer.
export function isNetworkError(err) {
  return err instanceof TypeError; // fetch throws TypeError on network failure
}

let syncing = false;
export async function trySync() {
  if (syncing) return;
  const queue = readQueue();
  if (queue.length === 0) return;
  syncing = true;
  try {
    const remaining = [];
    for (const item of queue) {
      try {
        const res = await fetch(`${API_URL}${item.endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.body),
        });
        if (!res.ok && res.status >= 500) {
          remaining.push(item); // server-side issue, retry later
        }
        // 2xx or 4xx (e.g. already clocked in) both count as "resolved" — don't retry those forever
      } catch {
        remaining.push(item); // still offline
      }
    }
    writeQueue(remaining);
  } finally {
    syncing = false;
  }
}

export function startAutoSync() {
  window.addEventListener('online', trySync);
  trySync();
  return setInterval(trySync, 30_000);
}
