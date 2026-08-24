const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const n = require('../utils/nationalId');

// Build a genuinely valid Aadhaar by computing its own Verhoeff check digit,
// rather than hardcoding one real-looking number.
const base = '23456789012';
const validAadhaar = base + n.verhoeffCheckDigit(base);

test('a correctly formed Aadhaar passes validation', () => {
  assert.equal(n.validateNationalId(validAadhaar).ok, true);
});

test('a single mistyped digit is caught by the Verhoeff checksum', () => {
  const typo = validAadhaar.slice(0, 5) + String((Number(validAadhaar[5]) + 1) % 10) + validAadhaar.slice(6);
  assert.equal(n.validateNationalId(typo).ok, false);
});

test('numbers starting with 0 or 1, or all-same-digit, are rejected', () => {
  assert.equal(n.validateNationalId('012345678901').ok, false);
  assert.equal(n.validateNationalId('112345678901').ok, false);
  assert.equal(n.validateNationalId('222222222222').ok, false);
});

test('wrong length is rejected', () => {
  assert.equal(n.validateNationalId('12345').ok, false);
});

test('spaces in the input are tolerated', () => {
  const spaced = validAadhaar.replace(/(.{4})/g, '$1 ').trim();
  assert.equal(n.validateNationalId(spaced).ok, true);
});

test('hashing is deterministic regardless of input formatting', () => {
  const spaced = validAadhaar.replace(/(.{4})/g, '$1 ').trim();
  assert.equal(n.hashNationalId(validAadhaar), n.hashNationalId(spaced));
});

test('the hash is keyed (HMAC), not a bare reversible digest', () => {
  const plain = crypto.createHash('sha256').update(validAadhaar).digest('hex');
  assert.notEqual(n.hashNationalId(validAadhaar), plain);
});

test('last4 matches the real trailing digits', () => {
  assert.equal(n.last4(validAadhaar), validAadhaar.slice(-4));
});

test('non-Aadhaar ID types accept a looser shape', () => {
  assert.equal(n.validateNationalId('ABCDE1234F', 'PAN').ok, true);
  assert.equal(n.validateNationalId('AB', 'PAN').ok, false);
});
