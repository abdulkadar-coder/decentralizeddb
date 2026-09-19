import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';
import { signToken, verifyToken } from '../src/auth/tokens.js';

describe('scrypt password hashing', () => {
  it('hashes and verifies a password', () => {
    const encoded = hashPassword('correct horse battery staple');
    expect(encoded.startsWith('scrypt$')).toBe(true);
    expect(encoded).not.toContain('correct horse');
    expect(verifyPassword('correct horse battery staple', encoded)).toBe(true);
    expect(verifyPassword('wrong password', encoded)).toBe(false);
  });

  it('produces a unique salt per hash', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(a).not.toBe(b);
  });

  it('rejects malformed hash strings', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$bad$ffff$ffff')).toBe(false);
  });
});

describe('HS256 JWT tokens', () => {
  const secret = 'unit-test-secret-value';
  it('signs and verifies a token with claims', () => {
    const token = signToken(secret, { sub: 'u1', username: 'alice', role: 'EMPLOYEE', employeeId: 'e1' }, 3600);
    const claims = verifyToken(secret, token);
    expect(claims).toMatchObject({ sub: 'u1', username: 'alice', role: 'EMPLOYEE', employeeId: 'e1' });
    expect(claims!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects an expired token', () => {
    const token = signToken(secret, { sub: 'u1', username: 'a', role: 'EMPLOYEE' }, -10);
    expect(verifyToken(secret, token)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signToken('secret-A', { sub: 'u1', username: 'a', role: 'EMPLOYEE' }, 3600);
    expect(verifyToken('secret-B', token)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signToken(secret, { sub: 'u1', username: 'a', role: 'EMPLOYEE' }, 3600);
    const [h, p, s] = token.split('.') as [string, string, string];
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as { role: string; sub: string };
    const forgedPayload = Buffer.from(JSON.stringify({ ...payload, role: 'ADMIN' })).toString('base64url');
    expect(verifyToken(secret, `${h}.${forgedPayload}.${s}`)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(verifyToken(secret, '')).toBeNull();
    expect(verifyToken(secret, 'a.b.c.d')).toBeNull();
    expect(verifyToken(secret, '!!!.!!!.!!!')).toBeNull();
  });
});