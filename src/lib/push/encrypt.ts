import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Message Encryption for Web Push (RFC 8291) over the `aes128gcm` content
 * coding (RFC 8188).
 *
 * The push service is an untrusted relay: it sees the ciphertext and the
 * endpoint, never the notification. Only the browser that produced the
 * subscription's `p256dh` / `auth` pair can decrypt.
 *
 * Every primitive this needs — P-256 ECDH, HKDF-SHA-256, AES-128-GCM — is in
 * `node:crypto`, so no dependency is involved. The sequence is fixed by the
 * RFCs and must be followed exactly; a single byte out of place produces a
 * notification the browser silently drops.
 */

const AUTH_INFO = Buffer.from('WebPush: info\0', 'utf8');
const CEK_INFO = Buffer.from('Content-Encoding: aes128gcm\0', 'utf8');
const NONCE_INFO = Buffer.from('Content-Encoding: nonce\0', 'utf8');

/** aes128gcm's record size. One record is enough for any notification we send. */
export const RECORD_SIZE = 4096;
/** Padding delimiter (0x02) + GCM tag (16 bytes) ride along with the plaintext. */
const RECORD_OVERHEAD = 1 + 16;

export interface PushSubscriptionKeys {
  /** Base64url of the subscriber's 65-byte uncompressed P-256 public key. */
  p256dh: string;
  /** Base64url of the subscriber's 16-byte auth secret. */
  auth: string;
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

/**
 * Encrypt `payload` for one subscription.
 *
 * `salt` and `ephemeralPrivateKey` are injectable only so the test suite can
 * pin a known vector; production always uses fresh randomness, and reusing a
 * salt across messages would be a real cryptographic break.
 */
export function encryptPushPayload(
  payload: string,
  keys: PushSubscriptionKeys,
  options?: { salt?: Buffer },
): Buffer {
  const uaPublic = Buffer.from(keys.p256dh, 'base64url');
  const authSecret = Buffer.from(keys.auth, 'base64url');
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error('Subscription p256dh key is not an uncompressed P-256 point.');
  }
  if (authSecret.length !== 16) {
    throw new Error('Subscription auth secret must be 16 bytes.');
  }

  const plaintext = Buffer.from(payload, 'utf8');
  if (plaintext.length + RECORD_OVERHEAD > RECORD_SIZE) {
    throw new Error(
      `Push payload is too large: ${plaintext.length} bytes, max ${RECORD_SIZE - RECORD_OVERHEAD}.`,
    );
  }

  // Our ephemeral key pair for this one message.
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  // RFC 8291 §3.3 — the auth secret is the HKDF *salt* at this step, and the
  // info string binds both public keys into the derived IKM so a swapped key
  // cannot decrypt.
  const keyInfo = Buffer.concat([AUTH_INFO, uaPublic, asPublic]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = options?.salt ?? randomBytes(16);
  const contentEncryptionKey = hkdf(salt, ikm, CEK_INFO, 16);
  const nonce = hkdf(salt, ikm, NONCE_INFO, 12);

  const cipher = createCipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])), // 0x02 = last record
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // RFC 8188 §2.1 header: salt(16) ‖ rs(4, big-endian) ‖ idlen(1) ‖ keyid.
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE, 0);
  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([asPublic.length]),
    asPublic,
    ciphertext,
  ]);
}
