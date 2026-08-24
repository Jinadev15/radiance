// National ID (Aadhaar and equivalents) handling.
//
// Two jobs:
//
// 1. Validate, so a mistyped number can't create a permanently wrong record.
//    Twelve digits typed on a tablet by someone in a hurry go wrong often,
//    and because the ID is the uniqueness key, a typo also locks the real
//    owner of that number out of ever registering. Aadhaar carries a Verhoeff
//    check digit specifically so this is detectable — a length check alone
//    throws that away.
//
// 2. Never store the number in full. The Aadhaar Act restricts storing
//    Aadhaar numbers and the DPDP Act 2023 treats them as personal data
//    needing safeguards. Uniqueness works just as well on a keyed hash, and
//    HR only ever needs the last four digits on screen.
const crypto = require('crypto');

// Verhoeff dihedral-group tables. Catches every single-digit error and
// almost all adjacent transpositions — the two mistakes people actually make.
const D_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV_TABLE = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function verhoeffIsValid(digits) {
  let checksum = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    checksum = D_TABLE[checksum][P_TABLE[i % 8][Number(reversed[i])]];
  }
  return checksum === 0;
}

// Exposed for tests and for generating valid sample data in the seed script.
function verhoeffCheckDigit(elevenDigits) {
  let checksum = 0;
  const reversed = `${elevenDigits}0`.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    checksum = D_TABLE[checksum][P_TABLE[i % 8][Number(reversed[i])]];
  }
  return INV_TABLE[checksum];
}

function normalise(raw) {
  return String(raw == null ? '' : raw).replace(/\D/g, '');
}

// Returns { ok: true, value } or { ok: false, reason } — a reason a kiosk can
// show to the person standing in front of it, not a stack trace.
function validateNationalId(raw, idType = 'AADHAAR') {
  const digits = normalise(raw);

  if (idType !== 'AADHAAR') {
    // Other ID types have no common checksum; enforce a sane shape only.
    const value = String(raw == null ? '' : raw).trim().toUpperCase();
    if (value.length < 6 || value.length > 20) {
      return { ok: false, reason: 'ID number must be between 6 and 20 characters.' };
    }
    return { ok: true, value };
  }

  if (digits.length !== 12) {
    return { ok: false, reason: 'Aadhaar number must be exactly 12 digits.' };
  }
  // UIDAI never issues a number starting 0 or 1.
  if (digits[0] === '0' || digits[0] === '1') {
    return { ok: false, reason: 'Aadhaar number cannot start with 0 or 1. Please check the number.' };
  }
  if (/^(\d)\1{11}$/.test(digits)) {
    return { ok: false, reason: 'Please enter a real Aadhaar number.' };
  }
  if (!verhoeffIsValid(digits)) {
    return { ok: false, reason: 'That Aadhaar number looks mistyped — please check each digit and try again.' };
  }
  return { ok: true, value: digits };
}

// Keyed hash, not a bare digest.
//
// A plain SHA-256 of a 12-digit number is trivially reversible by brute force
// (10^12 candidates is minutes of GPU time), which would defeat the point of
// not storing the number. HMAC with a server-held secret means an attacker
// who exfiltrates the database still cannot recover any ID without also
// stealing the key. It stays deterministic, so uniqueness lookups still work.
let cachedSecret = null;
function hmacSecret() {
  if (cachedSecret) return cachedSecret;
  const secret = process.env.NATIONAL_ID_HMAC_SECRET;
  if (secret && secret.length >= 16) {
    cachedSecret = secret;
    return cachedSecret;
  }
  if (process.env.NODE_ENV === 'production') {
    // Falling back silently in production would mean every deployment hashed
    // with a publicly-known key, i.e. no protection at all — and rotating to
    // a real key later would orphan every existing record. Fail at boot.
    throw new Error(
      'NATIONAL_ID_HMAC_SECRET must be set (32+ random characters) in production. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }
  console.warn(
    '[nationalId] NATIONAL_ID_HMAC_SECRET not set — using an insecure development key. ' +
    'Set a real one before deploying, and note that hashes will not match across keys.'
  );
  cachedSecret = 'insecure-development-only-national-id-key';
  return cachedSecret;
}

function hashNationalId(raw) {
  const digits = normalise(raw);
  const canonical = digits.length >= 6 ? digits : String(raw == null ? '' : raw).trim().toUpperCase();
  if (!canonical) throw new Error('Cannot hash an empty national ID');
  return crypto.createHmac('sha256', hmacSecret()).update(canonical).digest('hex');
}

function last4(raw) {
  const digits = normalise(raw);
  if (digits.length >= 4) return digits.slice(-4);
  const value = String(raw == null ? '' : raw).trim();
  return value.slice(-4).padStart(4, '0');
}

module.exports = {
  validateNationalId,
  hashNationalId,
  last4,
  verhoeffIsValid,
  verhoeffCheckDigit,
};
