import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { nowIso } from '../../db/index.js';
import { errors } from '../../errors.js';
import { signToken, type Role, type JwtClaims } from '../../auth/tokens.js';
import type { Actor } from '../../authorization.js';
import type { ResolvedIdentity } from '../../middleware/auth.js';
import type { AuditService } from '../audit/service.js';
import { generateRecoveryCodes, hashRecoveryCodes } from '../../auth/recovery.js';
import type { AppConfig } from '../../config.js';

export interface AuthConfig {
  jwtSecret: string;
  tokenTtlSeconds: number;
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string | null;
  role: Role;
  display_name: string;
  employee_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  totp_secret_enc: string | null;
  totp_enabled: number;
  totp_verified_at: string | null;
  totp_created_at: string | null;
  recovery_codes_json: string | null;
}

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  displayName: string;
  employeeId: string | null;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name,
    employeeId: row.employee_id,
  };
}

export function userRowToActor(row: UserRow): Actor {
  return { userId: row.id, username: row.username, role: row.role, employeeId: row.employee_id };
}

function adminCount(db: Db): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND is_active = 1")
    .get() as { n: number };
  return row.n;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly cfg: AuthConfig & { totp: AppConfig['totp'] },
  ) {}

  findUser(username: string): UserRow | null {
    return (
      (this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as
        | UserRow
        | undefined) ?? null
    );
  }

  /** Fresh identity for a user id (used by auth middleware). */
  resolveForAuth(userId: string): ResolvedIdentity | null {
    const user = this.db
      .prepare('SELECT role, is_active FROM users WHERE id = ?')
      .get(userId) as { role: Role; is_active: number } | undefined;
    if (!user) return null;
    const employee = this.db
      .prepare('SELECT id FROM employees WHERE user_id = ? AND is_active = 1')
      .get(userId) as { id: string } | undefined;
    return { role: user.role, employeeId: employee ? employee.id : null, isActive: user.is_active };
  }

  /**
   * Register a user in the passwordless TOTP model.
   *
   * - The first ADMIN bootstrap-registers without any prior auth and receives
   *   the account's recovery codes (its initial credential).
   * - Additional ADMIN and MANAGER accounts require an authenticated ADMIN actor.
   * - EMPLOYEE accounts self-register.
   *
   * Every new account is issued one-time recovery codes that let it log in;
   * the holder then enrolls an authenticator app via `/api/auth/totp/setup`.
   */
  async register(
    input: { username: string; displayName: string; role?: Role },
    actor?: Actor | null,
  ): Promise<{ user: PublicUser; recoveryCodes: string[] }> {
    const role = input.role ?? 'EMPLOYEE';
    if (!['ADMIN', 'MANAGER', 'EMPLOYEE'].includes(role)) {
      throw errors.badRequest('Invalid role');
    }

    const hasAdmins = adminCount(this.db) > 0;
    if (role === 'ADMIN' && !hasAdmins && actor && actor.role !== 'ADMIN') {
      throw errors.forbidden('Only the first administrator can bootstrap the system');
    }
    if (role === 'ADMIN' && hasAdmins && actor?.role !== 'ADMIN') {
      throw errors.forbidden('Only administrators can create admin accounts');
    }
    if (role === 'MANAGER' && actor?.role !== 'ADMIN') {
      throw errors.forbidden('Only administrators can create manager accounts');
    }
    if (!hasAdmins && role !== 'ADMIN') {
      throw errors.badRequest('The first registered account must be an ADMIN');
    }
    if (this.findUser(input.username)) {
      throw errors.conflict('Username is already taken');
    }

    const id = randomUUID();
    const ts = nowIso();
    const recoveryCodes = generateRecoveryCodes(this.cfg.totp.recoveryCount, this.cfg.totp.recoveryLen);
    const recoveryHashes = hashRecoveryCodes(recoveryCodes);

    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled, totp_verified_at, totp_created_at, recovery_codes_json)
         VALUES (?, ?, NULL, ?, ?, 1, ?, ?, NULL, 0, NULL, NULL, ?)`,
      )
      .run(id, input.username, role, input.displayName, ts, ts, JSON.stringify(recoveryHashes));

    return { user: toPublicUser(this.findUser(input.username)!), recoveryCodes };
  }

  async loginWithTotp(userId: string): Promise<{ token: string; user: PublicUser }> {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!user || user.is_active !== 1) {
      throw errors.unauthorized('Account not found or inactive');
    }

    const claims: Omit<JwtClaims, 'iat' | 'exp'> = {
      sub: user.id,
      username: user.username,
      role: user.role,
      ...(user.employee_id ? { employeeId: user.employee_id } : {}),
    };
    const token = signToken(this.cfg.jwtSecret, claims, this.cfg.tokenTtlSeconds);

    await this.audit.record('AUTH_LOGIN', {
      actorId: user.id,
      actorRole: user.role,
      subjectId: user.employee_id ?? undefined,
    });

    return { token, user: toPublicUser(user) };
  }

  me(actor: Actor): UserRow {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(actor.userId) as UserRow | undefined;
    if (!row) throw errors.unauthorized('Account no longer exists');
    return row;
  }

  /** Public user view with the live user->employee link from the employees table. */
  mePublic(actor: Actor): PublicUser {
    const row = this.me(actor);
    const employee = this.db
      .prepare('SELECT id FROM employees WHERE user_id = ? AND is_active = 1')
      .get(actor.userId) as { id: string } | undefined;
    return { ...toPublicUser(row), employeeId: employee ? employee.id : null };
  }
}