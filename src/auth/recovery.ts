import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './passwords.js';

export function generateRecoveryCodes(count: number = 8, length: number = 10): string[] {
  const codes: string[] = [];
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < length; j++) {
      const byte = randomBytes(1);
      const b = byte[0]!;
      code += charset[b % charset.length];
    }
    codes.push(code);
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  return hashPassword(code);
}

export function verifyRecoveryCode(code: string, hash: string): boolean {
  return verifyPassword(code, hash);
}

export function hashRecoveryCodes(codes: string[]): string[] {
  return codes.map(hashRecoveryCode);
}