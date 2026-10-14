import { createHmac, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE32_ALPHABET.length; i++) {
  BASE32_LOOKUP[BASE32_ALPHABET[i] as string] = i;
}

export function bytesToBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  // RFC 4648 requires '=' padding to a multiple of 8 characters.
  const rem = output.length % 8;
  return rem === 0 ? output : output + '='.repeat(8 - rem);
}

export function base32ToBytes(base32: string): Buffer {
  const cleaned = base32.replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const val = BASE32_LOOKUP[char as string];
    if (val === undefined) continue;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      out.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return bytesToBase32(randomBytes(20));
}

export function totpAtCounter(secretBase32: string, counter: bigint, digits: number = 6): string {
  const secret = base32ToBytes(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);
  const hmac = createHmac('sha1', secret).update(counterBuf).digest();
  // hmac is always 20 bytes for SHA1
  const offset = hmac[19]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  const otp = code % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

export function totp(secretBase32: string, timeStep: number = 30, digits: number = 6): string {
  const counter = BigInt(Math.floor(Date.now() / 1000 / timeStep));
  return totpAtCounter(secretBase32, counter, digits);
}

export function verifyTotp(
  secretBase32: string,
  code: string,
  window: number = 1,
  timeStep: number = 30,
  digits: number = 6
): boolean {
  const now = Math.floor(Date.now() / 1000 / timeStep);
  for (let i = -window; i <= window; i++) {
    const expected = totpAtCounter(secretBase32, BigInt(now + i), digits);
    if (timingSafeEqualStr(expected, code)) return true;
  }
  return false;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function encryptSecret(secretBase32: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

export function decryptSecret(encrypted: string, key: Buffer): string {
  const data = Buffer.from(encrypted, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(-16);
  const ciphertext = data.subarray(12, -16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function buildOtpAuthUrl(
  secretBase32: string,
  username: string,
  issuer: string,
  digits: number = 6,
  period: number = 30
): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    digits: digits.toString(),
    period: period.toString(),
    algorithm: 'SHA1',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}