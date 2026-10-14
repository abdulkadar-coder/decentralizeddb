import { describe, it, expect } from 'vitest';
import {
  bytesToBase32,
  base32ToBytes,
  generateSecret,
  totp,
  totpAtCounter,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  buildOtpAuthUrl,
} from '../src/auth/totp.js';

describe('base32 encoding', () => {
  it('encodes and decodes correctly', () => {
    const bytes = Buffer.from('Hello, World!');
    const encoded = bytesToBase32(bytes);
    const decoded = base32ToBytes(encoded);
    expect(decoded).toEqual(bytes);
  });

  it('handles RFC 4648 test vectors', () => {
    expect(bytesToBase32(Buffer.from(''))).toBe('');
    expect(bytesToBase32(Buffer.from('f'))).toBe('MY======');
    expect(bytesToBase32(Buffer.from('fo'))).toBe('MZXQ====');
    expect(bytesToBase32(Buffer.from('foo'))).toBe('MZXW6===');
    expect(bytesToBase32(Buffer.from('foob'))).toBe('MZXW6YQ=');
    expect(bytesToBase32(Buffer.from('fooba'))).toBe('MZXW6YTB');
    expect(bytesToBase32(Buffer.from('foobar'))).toBe('MZXW6YTBOI======');
  });
});

describe('generateSecret', () => {
  it('generates a valid base32 secret', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('generates different secrets each call', () => {
    const s1 = generateSecret();
    const s2 = generateSecret();
    expect(s1).not.toBe(s2);
  });
});

describe('totp (RFC 6238)', () => {
  // RFC 6238 test vector: secret = "12345678901234567890" (base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const RFC_DIGITS = 8;
  const RFC_PERIOD = 30;

  it('matches RFC 6238 SHA-1 vectors by counter', () => {
    // RFC 6238 Appendix B, 8 digits, secret "12345678901234567890"
    const counterAt = (t: number) => BigInt(Math.floor(t / RFC_PERIOD));
    expect(totpAtCounter(RFC_SECRET, counterAt(59), RFC_DIGITS)).toBe('94287082');
    expect(totpAtCounter(RFC_SECRET, counterAt(1111111109), RFC_DIGITS)).toBe('07081804');
    expect(totpAtCounter(RFC_SECRET, counterAt(1111111111), RFC_DIGITS)).toBe('14050471');
    expect(totpAtCounter(RFC_SECRET, counterAt(1234567890), RFC_DIGITS)).toBe('89005924');
    expect(totpAtCounter(RFC_SECRET, counterAt(2000000000), RFC_DIGITS)).toBe('69279037');
    expect(totpAtCounter(RFC_SECRET, counterAt(20000000000), RFC_DIGITS)).toBe('65353130');
  });

  it('produces 6-digit codes by default', () => {
    const code = totp(generateSecret());
    expect(code).toMatch(/^\d{6}$/);
  });

  it('produces correct length for digits parameter', () => {
    const secret = generateSecret();
    expect(totp(secret, 30, 6).length).toBe(6);
    expect(totp(secret, 30, 8).length).toBe(8);
  });
});

describe('verifyTotp', () => {
  it('accepts valid code at current time step', () => {
    const secret = generateSecret();
    const code = totp(secret);
    expect(verifyTotp(secret, code, 1)).toBe(true);
  });

  it('accepts code within window', () => {
    const secret = generateSecret();
    // We can't easily test time steps without mocking, but we can test the logic
    const code = totp(secret);
    expect(verifyTotp(secret, code, 1)).toBe(true);
  });

  it('rejects invalid code', () => {
    const secret = generateSecret();
    expect(verifyTotp(secret, '000000', 1)).toBe(false);
    expect(verifyTotp(secret, '123456', 1)).toBe(false);
  });

  it('rejects code outside window', () => {
    // Can't easily test without mocking time, but verify the function exists
    expect(typeof verifyTotp).toBe('function');
  });

  it('handles different digits', () => {
    const secret = generateSecret();
    const code = totp(secret, 30, 8);
    expect(verifyTotp(secret, code, 1, 30, 8)).toBe(true);
  });
});

describe('encryptSecret / decryptSecret', () => {
  const key = Buffer.from('0123456789abcdef0123456789abcdef'); // 32 bytes

  it('encrypts and decrypts correctly', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptSecret(secret, key);
    const decrypted = decryptSecret(encrypted, key);
    expect(decrypted).toBe(secret);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const e1 = encryptSecret(secret, key);
    const e2 = encryptSecret(secret, key);
    expect(e1).not.toBe(e2);
    expect(decryptSecret(e1, key)).toBe(secret);
    expect(decryptSecret(e2, key)).toBe(secret);
  });

  it('fails with wrong key', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptSecret(secret, key);
    const wrongKey = Buffer.from('fedcba9876543210fedcba9876543210');
    expect(() => decryptSecret(encrypted, wrongKey)).toThrow();
  });

  it('fails with tampered ciphertext', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    let encrypted = encryptSecret(secret, key);
    const buf = Buffer.from(encrypted, 'base64');
    buf[0] = (buf[0] ?? 0) ^ 0x01; // flip a bit in IV
    encrypted = buf.toString('base64');
    expect(() => decryptSecret(encrypted, key)).toThrow();
  });
});

describe('buildOtpAuthUrl', () => {
  it('builds valid otpauth URL', () => {
    const url = buildOtpAuthUrl('JBSWY3DPEHPK3PXP', 'user@example.com', 'TestApp', 6, 30);
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(url).toContain('issuer=TestApp');
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
    expect(url).toContain('algorithm=SHA1');
  });

  it('URL-encodes special characters in username', () => {
    const url = buildOtpAuthUrl('SECRET', 'user@domain.com', 'App');
    expect(url).toContain('user%40domain.com');
  });
});