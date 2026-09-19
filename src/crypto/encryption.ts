import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptionContext } from './aad.js';
import { buildAad } from './aad.js';
import { sha256Hex, constantLengthHexEqual } from './integrity.js';
import { errors } from '../errors.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptResult {
  /** iv || ciphertext || authTag */
  blob: Buffer;
  keyId: string;
  keyVersion: number;
  aadHex: string;
  integritySha256: string;
}

export interface DecryptInput {
  blob: Buffer;
  keyId: string;
  keyVersion: number;
  aadHex: string;
  integritySha256: string;
}

export function encryptGcm(
  plaintext: Buffer,
  context: EncryptionContext,
  key: Buffer,
  keyId: string,
  version: number,
): EncryptResult {
  if (key.length !== 32) {
    throw errors.crypto('data-encryption key must be 256 bits');
  }
  const aad = buildAad(context);
  const iv = randomBytes(IV_BYTES);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, ct, tag]);
    const integritySha256 = sha256Hex(Buffer.concat([aad, blob]));
    return { blob, keyId, keyVersion: version, aadHex: aad.toString('hex'), integritySha256 };
  } catch {
    throw errors.crypto('failed to encrypt document');
  }
}

export function decryptGcm(blob: Buffer, context: EncryptionContext, meta: DecryptInput, key: Buffer): Buffer {
  const aad = buildAad(context);

  if (!constantLengthHexEqual(meta.aadHex, aad.toString('hex'))) {
    throw errors.badRequest('AAD mismatch: object context does not match its record');
  }

  const expectedIntegrity = meta.integritySha256;
  if (expectedIntegrity) {
    const actual = sha256Hex(Buffer.concat([aad, blob]));
    if (!constantLengthHexEqual(expectedIntegrity, actual)) {
      throw errors.crypto('integrity verification failed: object content was modified');
    }
  }

  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw errors.crypto('ciphertext too short: authentication tag is missing');
  }

  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw errors.crypto(
      'authentication tag verification failed: ciphertext is invalid or was tampered with',
    );
  }
}