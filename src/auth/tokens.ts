import { createHmac, timingSafeEqual } from 'node:crypto';

export type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

export interface JwtClaims {
  sub: string;
  username: string;
  role: Role;
  employeeId?: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function decodeB64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/** Sign a JWT (HS256) using the supplied secret. Returns `header.payload.signature`. */
export function signToken(
  secret: string,
  claims: Omit<JwtClaims, 'iat' | 'exp'>,
  ttlSeconds = 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtClaims = { ...claims, iat: now, exp: now + ttlSeconds };
  const signingInput = `${HEADER}.${b64url(JSON.stringify(payload))}`;
  const sig = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

/** Verify a JWT. Returns claims when valid and unexpired, otherwise null. */
export function verifyToken(secret: string, token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payloadB64, sigB64] = parts as [string, string, string];
  if (header !== HEADER) return null;

  const expected = createHmac('sha256', secret).update(`${header}.${payloadB64}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let payload: JwtClaims;
  try {
    payload = JSON.parse(decodeB64url(payloadB64).toString('utf8')) as JwtClaims;
  } catch {
    return null;
  }
  if (!payload.sub || !payload.role || !payload.exp || typeof payload.exp !== 'number') return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return null;
  return payload;
}