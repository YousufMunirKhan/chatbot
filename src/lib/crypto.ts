import crypto from 'node:crypto';
import { serverEnv } from '@/lib/env';

/**
 * AES-256-GCM encryption for integration tokens at rest
 * (Module 23 / Developer Rule: "Integration tokens must be encrypted").
 *
 * ENCRYPTION_KEY must be 32 bytes, provided as hex (64 chars) or base64.
 * Output format: base64(iv).base64(authTag).base64(ciphertext)
 */
function getKey(): Buffer {
  const raw = serverEnv().ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is required to encrypt/decrypt secrets.');
  const key = raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).');
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
