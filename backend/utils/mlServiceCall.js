// Render's free tier spins the ML service down after 15 minutes idle; the
// first request after that has to wait for a cold start (can take 30+
// seconds) instead of the usual sub-second response. A short timeout is
// right for the common case (service already warm) but would wrongly
// surface "unavailable" to a real user during that one slow request.
// requestFn receives the timeout (ms) to use and returns the axios promise.
async function callWithRetry(requestFn, { fastTimeout = 5000, retryTimeout = 25000 } = {}) {
  try {
    return await requestFn(fastTimeout);
  } catch (err) {
    // A real HTTP error response (e.g. 422 no-face-detected) means the
    // service is up and answered — never retry those, only a timeout or
    // connection failure (no response at all), which is what a cold start
    // looks like from the caller's side.
    if (err.response) throw err;
    return await requestFn(retryTimeout);
  }
}

module.exports = { callWithRetry };
