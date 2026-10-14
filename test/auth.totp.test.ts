import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { TotpService } from '../src/modules/auth/totp.service.js';
import { generateRecoveryCodes } from '../src/auth/recovery.js';
import type { AppConfig } from '../src/config.js';
import type { AuditService } from '../src/modules/audit/service.js';
import { nowIso } from '../src/db/index.js';

const mockDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT,
      role TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','EMPLOYEE')),
      display_name TEXT NOT NULL,
      employee_id TEXT UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      totp_secret_enc TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      totp_verified_at TEXT,
      totp_created_at TEXT,
      recovery_codes_json TEXT
    );
  `);
  return db;
};

const mockAudit = () => ({
  record: vi.fn().mockResolvedValue({ height: 1, hash: 'test' }),
});

const mockConfig: AppConfig['totp'] = {
  encryptionKey: Buffer.from('0123456789abcdef0123456789abcdef'),
  issuer: 'TestApp',
  digits: 6,
  period: 30,
  window: 1,
  recoveryCount: 8,
  recoveryLen: 10,
  acceptAnyCode: false,
};

type TotpUserRow = {
  totp_secret_enc: string | null;
  totp_enabled: number;
  totp_created_at: string | null;
  totp_verified_at: string | null;
  recovery_codes_json: string | null;
};

const userRow = (db: DatabaseSync, id: string): TotpUserRow =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as TotpUserRow;

describe('TotpService', () => {
  let db: DatabaseSync;
  let audit: ReturnType<typeof mockAudit>;
  let service: TotpService;
  let actor = { userId: 'test-user-id', username: 'testuser', role: 'ADMIN' as const, employeeId: null };

  beforeEach(() => {
    db = mockDb();
    audit = mockAudit();
    service = new TotpService(db, audit as unknown as AuditService, mockConfig, 'test-jwt-secret');
    vi.clearAllMocks();
  });

  describe('setup', () => {
    it('generates secret and returns otpauth URL for new user', async () => {
      const id = randomUUID();
      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso());
      actor = { ...actor, userId: id };

      const result = await service.setup(actor);
      expect(result.otpauthUrl).toContain('otpauth://totp/');
      expect(result.otpauthUrl).toContain('secret=');
      expect(result.otpauthUrl).toContain('issuer=TestApp');
      expect(result.manualKey).toMatch(/^[A-Z2-7]{32}$/);

      const user = userRow(db, id);
      expect(user.totp_secret_enc).toBeTruthy();
      expect(user.totp_enabled).toBe(0);
      expect(user.totp_created_at).toBeTruthy();
      expect(audit.record).toHaveBeenCalledWith('TOTP_SETUP', expect.any(Object));
    });

    it('throws if TOTP already enabled', async () => {
      const id = randomUUID();
      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_enabled) VALUES (?, ?, ?, ?, 1, ?, ?, 1)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso());
      actor = { ...actor, userId: id };

      await expect(service.setup(actor)).rejects.toThrow('TOTP already enabled');
    });

    it('throws if user not found', async () => {
      await expect(service.setup({ ...actor, userId: 'nonexistent' })).rejects.toThrow('User not found');
    });
  });

  describe('verify', () => {
    it('verifies correct code and enables TOTP with recovery codes', async () => {
      const id = randomUUID();
      const { generateSecret, encryptSecret } = await import('../src/auth/totp.js');
      const secret = generateSecret();
      const encrypted = encryptSecret(secret, mockConfig.encryptionKey);

      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso(), encrypted);
      actor = { ...actor, userId: id };

      // Get current valid code
      const { totp } = await import('../src/auth/totp.js');
      const code = totp(secret);

      const recoveryCodes = await service.verify(actor, code);
      expect(recoveryCodes).toHaveLength(8);
      expect(recoveryCodes.every((c: string) => c.length === 10)).toBe(true);

      const user = userRow(db, id);
      expect(user.totp_enabled).toBe(1);
      expect(user.totp_verified_at).toBeTruthy();
      expect(user.recovery_codes_json).toBeTruthy();

      const codes = JSON.parse(user.recovery_codes_json!);
      expect(codes).toHaveLength(8);
      expect(audit.record).toHaveBeenCalledWith('TOTP_VERIFIED', expect.any(Object));
    });

    it('throws for invalid code', async () => {
      const id = randomUUID();
      const { generateSecret, encryptSecret } = await import('../src/auth/totp.js');
      const secret = generateSecret();
      const encrypted = encryptSecret(secret, mockConfig.encryptionKey);

      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso(), encrypted);

      await expect(service.verify(actor, '000000')).rejects.toThrow('Invalid TOTP code');
      expect(audit.record).toHaveBeenCalledWith('TOTP_LOGIN_FAILED', expect.objectContaining({
        payload: { reason: 'invalid_code' }
      }));
    });

    it('throws if already verified', async () => {
      const id = randomUUID();
      const { generateSecret, encryptSecret } = await import('../src/auth/totp.js');
      const secret = generateSecret();
      const encrypted = encryptSecret(secret, mockConfig.encryptionKey);

      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso(), encrypted);

      await expect(service.verify(actor, '123456')).rejects.toThrow('TOTP already verified');
    });
  });

  describe('disable', () => {
    it('disables TOTP with valid recovery code', async () => {
      const id = randomUUID();
      const { generateSecret, encryptSecret } = await import('../src/auth/totp.js');
      const { hashRecoveryCodes } = await import('../src/auth/recovery.js');
      const secret = generateSecret();
      const encrypted = encryptSecret(secret, mockConfig.encryptionKey);
      const recoveryCodes = generateRecoveryCodes(8, 10);
      const recoveryHashes = hashRecoveryCodes(recoveryCodes);

      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled, recovery_codes_json) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso(), encrypted, JSON.stringify(recoveryHashes));
      actor = { ...actor, userId: id };

      await service.disable(actor, recoveryCodes[0]!);

      const user = userRow(db, id);
      expect(user.totp_enabled).toBe(0);
      expect(user.totp_secret_enc).toBeNull();
      expect(user.totp_verified_at).toBeNull();
      expect(user.totp_created_at).toBeNull();
      expect(audit.record).toHaveBeenCalledWith('TOTP_DISABLED', expect.any(Object));
    });

    it('throws for invalid recovery code', async () => {
      const id = randomUUID();
      const { generateSecret, encryptSecret } = await import('../src/auth/totp.js');
      const { hashRecoveryCodes } = await import('../src/auth/recovery.js');
      const secret = generateSecret();
      const encrypted = encryptSecret(secret, mockConfig.encryptionKey);
      const recoveryCodes = generateRecoveryCodes(8, 10);
      const recoveryHashes = hashRecoveryCodes(recoveryCodes);

      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled, recovery_codes_json) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso(), encrypted, JSON.stringify(recoveryHashes));

      await expect(service.disable(actor, 'INVALIDCODE')).rejects.toThrow('Invalid recovery code');
      expect(audit.record).toHaveBeenCalledWith('TOTP_LOGIN_FAILED', expect.objectContaining({
        payload: { reason: 'invalid_recovery_code' }
      }));
    });
  });

  describe('login', () => {
    it('returns user info on valid TOTP code', async () => {
      const id = randomUUID();
      const { generateSecret, encryptSecret } = await import('../src/auth/totp.js');
      const { hashRecoveryCodes } = await import('../src/auth/recovery.js');
      const secret = generateSecret();
      const encrypted = encryptSecret(secret, mockConfig.encryptionKey);
      const recoveryCodes = generateRecoveryCodes(8, 10);
      const recoveryHashes = hashRecoveryCodes(recoveryCodes);

      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled, recovery_codes_json, employee_id) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso(), encrypted, JSON.stringify(recoveryHashes), null);

      const { totp } = await import('../src/auth/totp.js');
      const code = totp(secret);

      const result = await service.login('testuser', code);
      expect(result).toEqual({ userId: id, role: 'ADMIN', employeeId: null });
      expect(audit.record).toHaveBeenCalledWith('TOTP_LOGIN', expect.any(Object));
    });

    it('throws for user without TOTP enabled', async () => {
      const id = randomUUID();
      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_enabled) VALUES (?, ?, ?, ?, 1, ?, ?, 0)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso());

      await expect(service.login('testuser', '123456')).rejects.toThrow('TOTP not enrolled');
    });

    it('throws for invalid code', async () => {
      const id = randomUUID();
      const { generateSecret, encryptSecret } = await import('../src/auth/totp.js');
      const { hashRecoveryCodes } = await import('../src/auth/recovery.js');
      const secret = generateSecret();
      const encrypted = encryptSecret(secret, mockConfig.encryptionKey);
      const recoveryCodes = generateRecoveryCodes(8, 10);
      const recoveryHashes = hashRecoveryCodes(recoveryCodes);

      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled, recovery_codes_json) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso(), encrypted, JSON.stringify(recoveryHashes));

      await expect(service.login('testuser', '000000')).rejects.toThrow('Invalid TOTP code');
      expect(audit.record).toHaveBeenCalledWith('TOTP_LOGIN_FAILED', expect.objectContaining({
        payload: { reason: 'invalid_code' }
      }));
    });
  });

  describe('recoveryLogin', () => {
    it('logs in with valid recovery code and burns it', async () => {
      const id = randomUUID();
      const { generateSecret, encryptSecret } = await import('../src/auth/totp.js');
      const { hashRecoveryCodes } = await import('../src/auth/recovery.js');
      const secret = generateSecret();
      const encrypted = encryptSecret(secret, mockConfig.encryptionKey);
      const recoveryCodes = generateRecoveryCodes(8, 10);
      const recoveryHashes = hashRecoveryCodes(recoveryCodes);

      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled, recovery_codes_json, employee_id) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso(), encrypted, JSON.stringify(recoveryHashes), null);

      const result = await service.recoveryLogin('testuser', recoveryCodes[0]!);
      expect(result).toEqual({ userId: id, role: 'ADMIN', employeeId: null });

      const user = userRow(db, id);
      const remaining = JSON.parse(user.recovery_codes_json!);
      expect(remaining).toHaveLength(7);
      expect(audit.record).toHaveBeenCalledWith('TOTP_RECOVERY', expect.any(Object));
    });

    it('throws for invalid recovery code', async () => {
      const id = randomUUID();
      const { generateSecret, encryptSecret } = await import('../src/auth/totp.js');
      const { hashRecoveryCodes } = await import('../src/auth/recovery.js');
      const secret = generateSecret();
      const encrypted = encryptSecret(secret, mockConfig.encryptionKey);
      const recoveryCodes = generateRecoveryCodes(8, 10);
      const recoveryHashes = hashRecoveryCodes(recoveryCodes);

      db.prepare('INSERT INTO users (id, username, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled, recovery_codes_json) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?)')
        .run(id, 'testuser', 'ADMIN', 'Test User', nowIso(), nowIso(), encrypted, JSON.stringify(recoveryHashes));

      await expect(service.recoveryLogin('testuser', 'INVALIDCODE')).rejects.toThrow('Invalid recovery code');
      expect(audit.record).toHaveBeenCalledWith('TOTP_RECOVERY_FAILED', expect.any(Object));
    });
  });
});