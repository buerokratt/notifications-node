import { describe, expect, it } from 'vitest';

import { applicationServerKeysEqual, decodeVapidPublicKey } from '../../../src/core/web-push/vapid-public-key.js';

const INVALID_VAPID_PUBLIC_KEY_MESSAGE = 'vapidPublicKey must be a valid uncompressed P-256 public key';
const VALID_KEY_BYTES = new Uint8Array(65);
VALID_KEY_BYTES[0] = 0x04;
for (let index = 1; index < VALID_KEY_BYTES.length; index += 1) VALID_KEY_BYTES[index] = index;

const toBase64Url = (bytes: Uint8Array, padded = false): string => {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  const encoded = btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_');
  return padded ? encoded : encoded.replace(/=+$/u, '');
};

describe('decodeVapidPublicKey', () => {
  it.each([
    ['unpadded', toBase64Url(VALID_KEY_BYTES)],
    ['padded', toBase64Url(VALID_KEY_BYTES, true)],
  ])('decodes a valid %s Base64URL key', (caseName, value) => {
    void caseName;
    expect(decodeVapidPublicKey(value)).toEqual(VALID_KEY_BYTES);
  });

  it.each([
    ['empty input', ''],
    ['whitespace', '   '],
    ['illegal characters', `${toBase64Url(VALID_KEY_BYTES).slice(0, -1)}+`],
    ['incorrect length', toBase64Url(VALID_KEY_BYTES).slice(1)],
    ['incorrect key prefix', toBase64Url(Uint8Array.from(VALID_KEY_BYTES, (byte, index) => (index ? byte : 0x03)))],
    ['extra padding', `${toBase64Url(VALID_KEY_BYTES, true)}=`],
  ])('rejects %s', (caseName, value) => {
    void caseName;
    expect(() => decodeVapidPublicKey(value)).toThrow(new TypeError(INVALID_VAPID_PUBLIC_KEY_MESSAGE));
  });
});

describe('applicationServerKeysEqual', () => {
  it('rejects an absent existing key', () => {
    expect(applicationServerKeysEqual(null, VALID_KEY_BYTES)).toBe(false);
  });

  it('accepts a byte-for-byte match', () => {
    expect(applicationServerKeysEqual(VALID_KEY_BYTES.buffer, VALID_KEY_BYTES)).toBe(true);
  });

  it('rejects keys with different lengths', () => {
    expect(applicationServerKeysEqual(VALID_KEY_BYTES.slice(0, 64).buffer, VALID_KEY_BYTES)).toBe(false);
  });

  it('rejects keys with different bytes', () => {
    const changed = VALID_KEY_BYTES.slice();
    changed[64] ^= 0xff;

    expect(applicationServerKeysEqual(changed.buffer, VALID_KEY_BYTES)).toBe(false);
  });
});
