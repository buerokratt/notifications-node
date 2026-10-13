const INVALID_VAPID_PUBLIC_KEY_MESSAGE = 'vapidPublicKey must be a valid uncompressed P-256 public key';

export const decodeVapidPublicKey = (value: string): Uint8Array<ArrayBuffer> => {
  try {
    // A 65-byte uncompressed P-256 key is 87 Base64URL characters, with optional padding.
    if (!/^[A-Za-z0-9_-]{87}=?$/u.test(value)) throw new TypeError();

    // Convert Base64URL to the padded standard Base64 format required by atob().
    const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(88, '=');
    const publicKey = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));

    if (publicKey.length !== 65 || publicKey[0] !== 0x04) throw new TypeError();

    return publicKey;
  } catch {
    throw new TypeError(INVALID_VAPID_PUBLIC_KEY_MESSAGE);
  }
};

export const applicationServerKeysEqual = (existingKey: ArrayBuffer | null, configuredKey: Uint8Array): boolean => {
  if (!existingKey) return false;

  const existingBytes = new Uint8Array(existingKey);
  return (
    existingBytes.length === configuredKey.length &&
    existingBytes.every((value, index) => value === configuredKey[index])
  );
};
