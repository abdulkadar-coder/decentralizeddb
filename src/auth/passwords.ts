import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_BYTES = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', `${SCRYPT_N},${SCRYPT_R},${SCRYPT_P}`, salt.toString('hex'), derived.toString('hex')].join('$');
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const [, params, saltHex, hashHex] = parts as [string, string, string, string];
  const [n, r, p] = params.split(',').map((x) => Number.parseInt(x, 10));
  const salt = Buffer.from(saltHex, 'hex');
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const expected = Buffer.from(hashHex, 'hex');
  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, expected.length, { N: n, r, p });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}