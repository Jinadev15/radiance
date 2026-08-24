// Per-device kiosk credentials.
//
// The obvious approach — put the token in a VITE_ environment variable — does
// not work as security. Vite inlines those into the JavaScript bundle at build
// time, so the "secret" ships to every visitor and anyone who opens the page
// can read it out of the source. That is obfuscation, not authentication.
//
// Instead each tablet is provisioned once, by opening a setup link:
//
//   https://<kiosk-url>/?setup=<token>&site=<siteId>
//
// The credentials are written to this device's localStorage, the query string
// is scrubbed from the address bar and from history, and the token never
// appears in the bundle. A visitor who simply finds the kiosk URL gets an
// unprovisioned device and cannot scan.
//
// This is still a shared secret sitting in a browser — someone with physical
// access to an unlocked tablet can read it. It stops remote and casual abuse,
// which is the actual exposure for a public URL. Rotating a token means
// re-opening the setup link on that tablet.
const TOKEN_KEY = 'radiance_kiosk_token';
const SITE_KEY = 'radiance_kiosk_site';

function readSetupFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('setup');
    const site = params.get('site');
    if (!token) return null;
    return { token: token.trim(), site: (site || '').trim() || null };
  } catch {
    return null;
  }
}

function scrubUrl() {
  // replaceState, not pushState — the setup link must not be reachable with
  // the back button, and must not linger in the address bar of a device
  // sitting in a corridor all day.
  try {
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch {
    /* non-fatal: the credentials are already stored */
  }
}

/**
 * Consume a setup link if one is present. Call once at startup, before the
 * first API request.
 * @returns {boolean} true if this call provisioned the device
 */
export function provisionFromUrl() {
  const setup = readSetupFromUrl();
  if (!setup) return false;
  try {
    localStorage.setItem(TOKEN_KEY, setup.token);
    if (setup.site) localStorage.setItem(SITE_KEY, setup.site);
    else localStorage.removeItem(SITE_KEY);
    scrubUrl();
    return true;
  } catch {
    // Private-browsing or storage-disabled: the device cannot be provisioned,
    // and isProvisioned() below will report that honestly rather than letting
    // it fail later on every scan.
    return false;
  }
}

export function kioskToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function kioskSiteId() {
  try {
    return localStorage.getItem(SITE_KEY);
  } catch {
    return null;
  }
}

export function isProvisioned() {
  return Boolean(kioskToken());
}

/** Headers identifying this device. Empty when unprovisioned. */
export function deviceHeaders() {
  const headers = {};
  const token = kioskToken();
  const site = kioskSiteId();
  if (token) headers['X-Kiosk-Token'] = token;
  if (site) headers['X-Kiosk-Site'] = site;
  return headers;
}

/** Used by the setup screen so an installer can confirm the right site. */
export function deviceSummary() {
  return { provisioned: isProvisioned(), siteId: kioskSiteId() };
}
