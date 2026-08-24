// Single client for the face-recognition service.
//
// Everything that talks to the ML service goes through here so the shared
// secret, the cold-start retry policy and error translation live in exactly
// one place. Previously each caller built its own axios call and invented its
// own timeout, which is how the liveness check ended up with a different
// retry policy from embedding extraction.
const axios = require('axios');

const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const ML_SERVICE_TOKEN = process.env.ML_SERVICE_TOKEN || '';

// A container's first request after being spun down has to wait for the
// process to start and the ONNX models to load. A short timeout is right for
// the common case (service already warm) but would wrongly report
// "unavailable" during that one slow request, so a timeout is retried once
// with a much longer budget.
const FAST_TIMEOUT_MS = Number(process.env.ML_FAST_TIMEOUT_MS || 6000);
const COLD_TIMEOUT_MS = Number(process.env.ML_COLD_TIMEOUT_MS || 45000);

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (ML_SERVICE_TOKEN) h['X-ML-Token'] = ML_SERVICE_TOKEN;
  return h;
}

// Thrown as a plain { status, error, code } object so routes can respond from
// a catch block without re-deriving status codes. `code` lets callers branch
// on the *kind* of failure (retryable infrastructure vs a real answer from
// the service) rather than string-matching messages.
function serviceError(status, error, code) {
  return { status, error, code, isServiceError: true };
}

/**
 * POST to the ML service with a cold-start retry.
 *
 * A real HTTP error response (422 no-face-detected, 401 bad token) means the
 * service is up and answered — never retried. Only a timeout or connection
 * failure, which is what a cold start looks like from here, is retried.
 */
async function call(path, body, { fastTimeout = FAST_TIMEOUT_MS, coldTimeout = COLD_TIMEOUT_MS } = {}) {
  const url = `${ML_SERVICE_URL}${path}`;
  try {
    const res = await axios.post(url, body, { timeout: fastTimeout, headers: headers() });
    return res.data;
  } catch (err) {
    if (err.response) throw err;               // the service answered — don't retry
    try {
      const res = await axios.post(url, body, { timeout: coldTimeout, headers: headers() });
      return res.data;
    } catch (retryErr) {
      if (retryErr.response) throw retryErr;
      throw serviceError(503, 'Face recognition service unavailable. Please try again in a moment.', 'ML_UNAVAILABLE');
    }
  }
}

// Translates an axios failure into the shape routes expect. Kept separate so
// each endpoint wrapper below stays readable.
function translate(err, fallbackMessage) {
  if (err && err.isServiceError) return err;
  const status = err && err.response ? err.response.status : null;
  const detail = err && err.response && err.response.data ? err.response.data.detail : null;

  if (status === 422) {
    return serviceError(400, detail || 'No face detected. Please align your face clearly in good lighting.', 'NO_FACE');
  }
  if (status === 400) {
    return serviceError(400, detail || 'That image could not be read. Please try again.', 'BAD_IMAGE');
  }
  if (status === 401) {
    // Misconfiguration, not user error — say so in the logs, stay vague to
    // the caller (a kiosk user can do nothing about it).
    console.error('[MLService] Rejected: ML_SERVICE_TOKEN does not match the ML service.');
    return serviceError(503, 'Face recognition service unavailable.', 'ML_AUTH');
  }
  if (status === 503) {
    return serviceError(503, detail || 'Face recognition service is starting up. Please try again shortly.', 'ML_DEGRADED');
  }
  return serviceError(503, fallbackMessage || 'Face recognition service unavailable.', 'ML_UNAVAILABLE');
}

/** Extract a face embedding from one base64 frame. Throws NO_FACE if none found. */
async function extractEmbedding(image) {
  let data;
  try {
    data = await call('/extract-embedding', { image });
  } catch (err) {
    throw translate(err);
  }
  if (!data || !data.face_detected || !Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw serviceError(400, 'No face detected in the image. Please align your face clearly.', 'NO_FACE');
  }
  return data.embedding;
}

/**
 * Liveness check over 1-3 frames.
 * Returns the full result rather than a boolean: the caller has to tell a
 * too-dark frame ("move to better light", retryable, not suspicious) apart
 * from a genuine spoof signal ("possible printed photo", worth logging).
 */
async function checkLiveness(images) {
  try {
    // Liveness is the cheapest of the three calls, so it gets a tighter fast
    // path before the cold-start retry kicks in.
    return await call('/liveness-check', { images }, { fastTimeout: 5000 });
  } catch (err) {
    throw translate(err);
  }
}

/**
 * Identify one embedding against a candidate map of { employeeId: embeddings }.
 * Returns the raw result including `margin` and `reason` so the caller can
 * distinguish "nobody matched" from "two people matched too closely to tell".
 */
async function recognise(embedding, candidates, options = {}) {
  try {
    const body = { embedding, candidates };
    if (options.threshold !== undefined) body.threshold = options.threshold;
    if (options.minMargin !== undefined) body.min_margin = options.minMargin;
    return await call('/recognize-face', body);
  } catch (err) {
    throw translate(err);
  }
}

/** 1:1 check of a probe embedding against one person's stored embeddings. */
async function compareToEmployee(embedding, embeddings, threshold) {
  try {
    const body = { embedding, embeddings };
    if (threshold !== undefined) body.threshold = threshold;
    return await call('/compare-embedding', body, { fastTimeout: 5000 });
  } catch (err) {
    throw translate(err);
  }
}

/** Non-throwing health probe, for the backend's own /health endpoint. */
async function health() {
  try {
    const res = await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 4000, headers: headers() });
    return { reachable: true, ...res.data };
  } catch (err) {
    return { reachable: false, error: err.message };
  }
}

module.exports = {
  extractEmbedding,
  checkLiveness,
  recognise,
  compareToEmployee,
  health,
  serviceError,
  ML_SERVICE_URL,
  ML_SERVICE_TOKEN_CONFIGURED: Boolean(ML_SERVICE_TOKEN),
};
