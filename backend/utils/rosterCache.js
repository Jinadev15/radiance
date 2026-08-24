// Keeps the ML service's resident embedding cache in sync with the roster.
//
// Why this exists: the previous design sent every candidate's embeddings with
// every scan. Measured at this deployment's real size — 4,000 employees across
// 126 sites — that was a 13.6 MB payload *per scan*, roughly 1.8 GB/minute at
// a morning shift change, and enough memory per concurrent request to OOM a
// small instance. Embeddings almost never change, so they are pushed once and
// only re-pushed when the roster actually changes.
//
// Correctness rule: the ML service refuses to match against a roster whose
// version it can't confirm (see /recognize-cached). That matters — silently
// matching against a stale cache would let a deactivated employee keep
// clocking in. A version mismatch triggers a resync and one retry, never a
// silent fallback to old data.
const crypto = require('crypto');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const ml = require('./mlServiceCall');

// Version is derived from the roster's content, not a counter, so two backend
// instances that see the same roster compute the same version and don't fight
// over resyncing. Built from the fields that actually affect matching.
function computeVersion(rows) {
  const hash = crypto.createHash('sha1');
  // Sorted so map/query ordering can't change the version spuriously.
  const parts = rows
    .map(r => `${r._id}:${r.workLocation || ''}:${(r.faceEmbeddings || []).length}:${r.faceEnrolledAt ? new Date(r.faceEnrolledAt).getTime() : 0}`)
    .sort();
  for (const p of parts) hash.update(p).update('\n');
  return `${rows.length}-${hash.digest('hex').slice(0, 16)}`;
}

let currentVersion = null;
let lastSyncAt = null;
let lastSyncError = null;
let syncInFlight = null;

/** The version the ML service should currently be holding. */
function version() {
  return currentVersion;
}

function status() {
  return {
    version: currentVersion,
    lastSyncAt,
    lastSyncError,
    syncing: Boolean(syncInFlight),
  };
}

/**
 * Push the full roster to the ML service.
 *
 * Deduplicated: concurrent callers share one in-flight sync rather than each
 * pushing the same multi-megabyte payload. At a shift change several scans can
 * discover a stale cache simultaneously, and without this they would all
 * resync at once.
 */
async function sync({ force = false } = {}) {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      if (mongoose.connection.readyState !== 1) {
        throw new Error('Database unavailable — cannot sync roster');
      }

      // .lean() matters here: hydrating 4,000 Mongoose documents with
      // embeddings costs several times the memory of the raw objects, and
      // nothing in this path needs document methods.
      const rows = await Employee.find(Employee.matchableFilter())
        .select('_id workLocation faceEmbeddings faceEnrolledAt')
        .lean();

      const nextVersion = computeVersion(rows);
      if (!force && nextVersion === currentVersion) {
        lastSyncAt = new Date();
        return { skipped: true, version: currentVersion, people: rows.length };
      }

      const payload = {
        version: nextVersion,
        employees: rows.map(r => ({
          id: String(r._id),
          site_id: r.workLocation ? String(r.workLocation) : null,
          embeddings: r.faceEmbeddings || [],
        })),
      };

      const result = await ml.syncEmbeddings(payload);
      currentVersion = nextVersion;
      lastSyncAt = new Date();
      lastSyncError = null;
      console.log(
        `[RosterCache] Synced ${result.people} people / ${result.embeddings} embeddings ` +
        `across ${result.sites} sites (version ${nextVersion}, ${result.elapsed_ms}ms)`
      );
      return result;
    } catch (err) {
      lastSyncError = { message: err.error || err.message, at: new Date() };
      console.error('[RosterCache] Sync failed:', lastSyncError.message);
      throw err;
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

/**
 * Mark the roster changed and re-push in the background.
 *
 * Called after enrolment, approval, rejection, re-enrolment and deactivation —
 * anything that changes who can be matched. Deliberately fire-and-forget: the
 * HTTP response to the operator must not wait on the ML service, and a failed
 * push is self-healing because the next scan sees a stale version and resyncs.
 */
function invalidate(reason = 'roster changed') {
  sync().catch(() => {
    console.warn(`[RosterCache] Background resync after "${reason}" failed; the next scan will retry.`);
  });
}

/**
 * Sync at boot, retrying on a short backoff.
 *
 * The two services deploy at the same time and the backend usually wins by a
 * few seconds, so a single boot-time attempt reliably fails against an ML
 * service that hasn't finished starting — observed in production at exactly
 * 20 seconds apart. Falling back to the 10-minute reconciler would leave the
 * cache empty for that whole window, making the first employee of the morning
 * pay for a full roster push. These retries close that gap.
 */
async function syncOnBoot(delaysMs = [0, 15000, 45000, 120000]) {
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt] > 0) {
      await new Promise(resolve => setTimeout(resolve, delaysMs[attempt]));
    }
    try {
      await sync({ force: true });
      return true;
    } catch (err) {
      const last = attempt === delaysMs.length - 1;
      const message = err.error || err.message;
      if (last) {
        console.warn(
          `[RosterCache] Boot sync still failing after ${delaysMs.length} attempts (${message}). ` +
          'The next scan, or the 10-minute reconciler, will retry.'
        );
        return false;
      }
      console.warn(
        `[RosterCache] Boot sync attempt ${attempt + 1} failed (${message}); ` +
        `retrying in ${Math.round(delaysMs[attempt + 1] / 1000)}s.`
      );
    }
  }
  return false;
}

module.exports = { sync, syncOnBoot, invalidate, version, status, computeVersion };
