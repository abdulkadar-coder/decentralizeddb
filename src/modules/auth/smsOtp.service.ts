import { createHash, randomInt } from 'node:crypto';
import { nowIso } from '../../db/index.js';
import { errors } from '../../errors.js';
import { logger } from '../../logger.js';
import type { Db } from '../../db/index.js';
import type { AuditService } from '../audit/service.js';

export interface SmsOtpConfig {
  enabled: boolean;
  toNumber: string;
  ttlSeconds: number;
  digits: number;
  devMode: boolean;
}

export interface SmsSendResult {
  to: string;
  expiresIn: number;
  /** Present only in dev mode so the console/UI can display the generated code. */
  devCode?: string;
}

interface SmsOtpRow {
  user_id: string;
  code_hash: string;
  expires_at: string;
  used: number;
  attempt_count: number;
}

/** Dev-mode SMS OTP service. Generates a single-use 6-digit code bound to a
 * user and "delivers" it by logging it in dev mode (no SMS provider used yet). */
export class SmsOtpService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly cfg: SmsOtpConfig,
  ) {}

  private hash(code: string): string {
    return createHash('sha256').update(`sms-otp:${code}`).digest('hex');
  }

  private findUser(username: string) {
    return this.db
      .prepare('SELECT id, role, employee_id, is_active FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as
      | { id: string; role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'; employee_id: string | null; is_active: number }
      | undefined;
  }

  /** Request a fresh code for a username. Returns masked destination; the code
   * itself is revealed only in dev mode (logged to the console + returned). */
  async send(username: string): Promise<SmsSendResult> {
    if (!this.cfg.enabled) throw errors.badRequest('SMS OTP is disabled');
    const user = this.findUser(username);
    if (!user || user.is_active !== 1) {
      await this.audit.record('SMS_LOGIN_FAILED', {
        actorRole: 'EMPLOYEE',
        payload: { reason: 'unknown_user', username: maskUsername(username) },
      });
      throw errors.unauthorized('Invalid credentials');
    }

    const code = String(randomInt(0, 10 ** this.cfg.digits)).padStart(this.cfg.digits, '0');
    const expiresAt = new Date(Date.now() + this.cfg.ttlSeconds * 1000).toISOString();
    const codeHash = this.hash(code);

    this.db
      .prepare(
        `INSERT INTO sms_otp_codes (user_id, code_hash, expires_at, used, attempt_count, created_at)
         VALUES (?, ?, ?, 0, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash,
           expires_at = excluded.expires_at, used = 0, attempt_count = 0, created_at = excluded.created_at`,
      )
      .run(user.id, codeHash, expiresAt, nowIso());

    if (this.cfg.devMode) {
      logger.info('sms-otp', `[dev-mode] verification code for ${this.cfg.toNumber} (${username}): ${code}`);
    }

    await this.audit.record('SMS_OTP_SENT', {
      actorId: user.id,
      actorRole: user.role,
      subjectId: user.employee_id ?? undefined,
    });

    return {
      to: maskNumber(this.cfg.toNumber),
      expiresIn: this.cfg.ttlSeconds,
      ...(this.cfg.devMode ? { devCode: code } : {}),
    };
  }

  /** Verify a code and, on success, return the user id (caller issues the JWT). */
  async verify(username: string, code: string): Promise<{ userId: string; role: string; employeeId: string | null }> {
    if (!this.cfg.enabled) throw errors.badRequest('SMS OTP is disabled');
    const user = this.findUser(username);
    if (!user || user.is_active !== 1) {
      await this.audit.record('SMS_LOGIN_FAILED', {
        actorRole: 'EMPLOYEE',
        payload: { reason: 'unknown_user', username: maskUsername(username) },
      });
      throw errors.unauthorized('Invalid credentials');
    }

    const row = this.db.prepare('SELECT * FROM sms_otp_codes WHERE user_id = ?').get(user.id) as SmsOtpRow | undefined;
    if (!row) {
      await this.audit.record('SMS_LOGIN_FAILED', { actorId: user.id, actorRole: user.role, payload: { reason: 'no_code' } });
      throw errors.unauthorized('No SMS code requested for this account');
    }

    if (row.used === 1) {
      await this.audit.record('SMS_LOGIN_FAILED', { actorId: user.id, actorRole: user.role, payload: { reason: 'already_used' } });
      throw errors.unauthorized('Code already used. Request a new one.');
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.audit.record('SMS_LOGIN_FAILED', { actorId: user.id, actorRole: user.role, payload: { reason: 'expired' } });
      throw errors.unauthorized('Code expired. Request a new one.');
    }

    const attempts = row.attempt_count + 1;
    if (attempts > 5) {
      this.db.prepare('DELETE FROM sms_otp_codes WHERE user_id = ?').run(user.id);
      await this.audit.record('SMS_LOGIN_FAILED', { actorId: user.id, actorRole: user.role, payload: { reason: 'too_many_attempts' } });
      throw errors.tooMany('Too many attempts. Request a new code.');
    }

    if (this.hash(code) !== row.code_hash) {
      this.db.prepare('UPDATE sms_otp_codes SET attempt_count = ? WHERE user_id = ?').run(attempts, user.id);
      await this.audit.record('SMS_LOGIN_FAILED', { actorId: user.id, actorRole: user.role, payload: { reason: 'invalid_code' } });
      throw errors.unauthorized('Invalid SMS code');
    }

    this.db.prepare('UPDATE sms_otp_codes SET used = 1 WHERE user_id = ?').run(user.id);
    await this.audit.record('SMS_LOGIN', {
      actorId: user.id,
      actorRole: user.role,
      subjectId: user.employee_id ?? undefined,
    });

    return { userId: user.id, role: user.role, employeeId: user.employee_id };
  }
}

function maskNumber(number: string): string {
  const trimmed = number.trim();
  if (trimmed.length <= 4) return '*'.repeat(trimmed.length);
  return '*'.repeat(Math.max(0, trimmed.length - 4)) + trimmed.slice(-4);
}

function maskUsername(username: string): string {
  if (!username) return '';
  return username.slice(0, 1) + '*'.repeat(Math.max(0, username.length - 1));
}