import { nowIso } from '../../db/index.js';
import { errors } from '../../errors.js';
import { logger } from '../../logger.js';
import type { Db } from '../../db/index.js';
import type { AuditService } from '../audit/service.js';
import type { Actor } from '../../authorization.js';
import type { AppConfig } from '../../config.js';
import { decryptSecret, verifyTotp, buildOtpAuthUrl } from '../../auth/totp.js';
import { generateRecoveryCodes, hashRecoveryCodes, verifyRecoveryCode } from '../../auth/recovery.js';

export interface TotpSetupResult {
  otpauthUrl: string;
  manualKey: string;
}

export class TotpService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly cfg: AppConfig['totp'],
    private readonly jwtSecret: string,
  ) {}

  private findUser(username: string) {
    return this.db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as
      | {
          id: string;
          username: string;
          role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
          employee_id: string | null;
          totp_secret_enc: string | null;
          totp_enabled: number;
          totp_verified_at: string | null;
          totp_created_at: string | null;
          recovery_codes_json: string | null;
        }
      | undefined;
  }

  private getSecret(username: string): string {
    const user = this.findUser(username);
    if (!user?.totp_secret_enc) throw errors.badRequest('TOTP secret not found');
    return decryptSecret(user.totp_secret_enc, this.cfg.encryptionKey);
  }

  status(actor: Actor): { enabled: boolean } {
    const user = this.db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(actor.userId) as
      | { totp_enabled: number }
      | undefined;
    if (!user) throw errors.unauthorized('User not found');
    return { enabled: user.totp_enabled === 1 };
  }

  async setup(actor: Actor): Promise<TotpSetupResult> {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(actor.userId) as
      | { totp_enabled: number; totp_secret_enc: string | null }
      | undefined;
    if (!user) throw errors.unauthorized('User not found');
    if (user.totp_enabled === 1) throw errors.conflict('TOTP already enabled');

    const secret = (await import('../../auth/totp.js')).generateSecret();
    const encrypted = (await import('../../auth/totp.js')).encryptSecret(secret, this.cfg.encryptionKey);

    this.db
      .prepare(
        'UPDATE users SET totp_secret_enc = ?, totp_created_at = ? WHERE id = ?',
      ).run(encrypted, nowIso(), actor.userId);

    await this.audit.record('TOTP_SETUP', { actorId: actor.userId, actorRole: actor.role });

    return {
      otpauthUrl: buildOtpAuthUrl(secret, actor.username, this.cfg.issuer, this.cfg.digits, this.cfg.period),
      manualKey: secret,
    };
  }

  async verify(actor: Actor, code: string): Promise<string[]> {
    const user = this.findUser(actor.username);
    if (!user) throw errors.unauthorized('User not found');
    if (user.totp_enabled === 1) throw errors.conflict('TOTP already verified');

    const secret = decryptSecret(user.totp_secret_enc!, this.cfg.encryptionKey);
    const valid = this.cfg.acceptAnyCode ? isValidAnyCode(code) : verifyTotp(secret, code, this.cfg.window, this.cfg.period, this.cfg.digits);
    if (!valid) {
      await this.audit.record('TOTP_LOGIN_FAILED', {
        actorId: actor.userId,
        actorRole: actor.role,
        payload: { reason: 'invalid_code' },
      });
      throw errors.unauthorized('Invalid TOTP code');
    }

    const recoveryCodes = generateRecoveryCodes(this.cfg.recoveryCount, this.cfg.recoveryLen);
    const recoveryHashes = hashRecoveryCodes(recoveryCodes);

    this.db
      .prepare(
        'UPDATE users SET totp_enabled = 1, totp_verified_at = ?, recovery_codes_json = ? WHERE id = ?',
      ).run(nowIso(), JSON.stringify(recoveryHashes), actor.userId);

    await this.audit.record('TOTP_VERIFIED', { actorId: actor.userId, actorRole: actor.role });

    return recoveryCodes;
  }

  async disable(actor: Actor, recoveryCode: string): Promise<void> {
    const user = this.findUser(actor.username);
    if (!user) throw errors.unauthorized('User not found');
    if (user.totp_enabled !== 1) throw errors.badRequest('TOTP not enabled');

    const codes = user.recovery_codes_json ? JSON.parse(user.recovery_codes_json) : [];
    let ok = false;
    const remaining: string[] = [];
    for (const h of codes) {
      if (!ok && verifyRecoveryCode(recoveryCode, h)) {
        ok = true;
      } else {
        remaining.push(h);
      }
    }
    if (!ok) {
      await this.audit.record('TOTP_LOGIN_FAILED', {
        actorId: actor.userId,
        actorRole: actor.role,
        payload: { reason: 'invalid_recovery_code' },
      });
      throw errors.unauthorized('Invalid recovery code');
    }

    this.db
      .prepare(
        'UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_verified_at = NULL, totp_created_at = NULL, recovery_codes_json = ? WHERE id = ?',
      ).run(JSON.stringify(remaining), actor.userId);

    await this.audit.record('TOTP_DISABLED', { actorId: actor.userId, actorRole: actor.role });
  }

  async login(username: string, code: string): Promise<{ userId: string; role: string; employeeId: string | null }> {
    const user = this.findUser(username);
    if (!user) {
      await this.audit.record('TOTP_LOGIN_FAILED', {
        actorRole: 'EMPLOYEE',
        payload: { username: username.slice(0, 1) + '*'.repeat(Math.max(0, username.length - 1)) },
      });
      throw errors.unauthorized('Invalid credentials');
    }

    // DEV-ONLY bypass: accept any 6-digit code for any account (enrolled or not).
    if (this.cfg.acceptAnyCode) {
      if (!isValidAnyCode(code)) {
        await this.audit.record('TOTP_LOGIN_FAILED', { actorId: user.id, actorRole: user.role, payload: { reason: 'invalid_code' } });
        throw errors.unauthorized('Invalid TOTP code');
      }
      await this.audit.record('TOTP_LOGIN', {
        actorId: user.id,
        actorRole: user.role,
        subjectId: user.employee_id ?? undefined,
      });
      return { userId: user.id, role: user.role, employeeId: user.employee_id };
    }

    if (user.totp_enabled !== 1) {
      await this.audit.record('TOTP_LOGIN_FAILED', {
        actorId: user.id,
        actorRole: user.role,
        payload: { reason: 'not_enrolled' },
      });
      throw errors.unauthorized('TOTP not enrolled');
    }

    const secret = decryptSecret(user.totp_secret_enc!, this.cfg.encryptionKey);
    const valid = this.cfg.acceptAnyCode ? isValidAnyCode(code) : verifyTotp(secret, code, this.cfg.window, this.cfg.period, this.cfg.digits);
    if (!valid) {
      await this.audit.record('TOTP_LOGIN_FAILED', { actorId: user.id, actorRole: user.role, payload: { reason: 'invalid_code' } });
      throw errors.unauthorized('Invalid TOTP code');
    }

    await this.audit.record('TOTP_LOGIN', {
      actorId: user.id,
      actorRole: user.role,
      subjectId: user.employee_id ?? undefined,
    });

    return { userId: user.id, role: user.role, employeeId: user.employee_id };
  }

  async recoveryLogin(username: string, recoveryCode: string): Promise<{ userId: string; role: string; employeeId: string | null }> {
    const user = this.findUser(username);
    if (!user) {
      await this.audit.record('TOTP_RECOVERY_FAILED', {
        actorRole: 'EMPLOYEE',
        payload: { username: username.slice(0, 1) + '*'.repeat(Math.max(0, username.length - 1)) },
      });
      throw errors.unauthorized('Invalid credentials');
    }
    const codes = user.recovery_codes_json ? JSON.parse(user.recovery_codes_json) : [];
    if (!Array.isArray(codes) || codes.length === 0) throw errors.badRequest('No recovery codes available');
    let ok = false;
    const remaining: string[] = [];
    for (const h of codes) {
      if (!ok && verifyRecoveryCode(recoveryCode, h)) {
        ok = true;
      } else {
        remaining.push(h);
      }
    }
    if (!ok) {
      await this.audit.record('TOTP_RECOVERY_FAILED', { actorId: user.id, actorRole: user.role, payload: { reason: 'invalid_recovery_code' } });
      throw errors.unauthorized('Invalid recovery code');
    }

    this.db
      .prepare('UPDATE users SET recovery_codes_json = ? WHERE id = ?')
      .run(JSON.stringify(remaining), user.id);

    await this.audit.record('TOTP_RECOVERY', { actorId: user.id, actorRole: user.role, subjectId: user.employee_id ?? undefined });

    return { userId: user.id, role: user.role, employeeId: user.employee_id };
  }
}

/** DEV-ONLY: accepts any 6-digit code as a valid authenticator code. */
function isValidAnyCode(code: string): boolean {
  const ok = /^\d{6}$/.test(code ?? '');
  if (ok) {
    logger.warn('totp', 'DEV-ONLY: accepting any authenticator code (TOTP_ACCEPT_ANY_CODE=true)');
  }
  return ok;
}
