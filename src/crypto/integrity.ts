import { createHash } from 'node:crypto';

/**
 * Canonical SHA-256 digest of a string, hex encoded.
 * Used for block linking and object integrity verification.
 */
export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function constantLengthHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return ab.equals(bb);
}