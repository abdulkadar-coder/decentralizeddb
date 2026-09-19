import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { nowIso } from '../../db/index.js';
import { errors } from '../../errors.js';
import { hashPassword, verifyPassword } from '../../auth/passwords.js';
import { signToken, type Role, type JwtClaims } from '../../auth/tokens.js';
import type { Actor } from '../../authorization.js';
import type { ResolvedIdentity } from '../../middleware/auth.js';
import type { AuditService } from '../audit/service.js';

export interface AuthConfig {
  jwtSecret: string;
  tokenTtlSeconds: number;
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  display_name: string;
  employee_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
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
    private readonly cfg: AuthConfig,
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
   * Register a user. `role: 'ADMIN'` is granted either during bootstrap
   * (when no active administrator exists yet) or to an authenticated admin.
   */
  async register(
    input: { username: string; password: string; displayName: string; role?: Role },
    actor?: Actor | null,
  ): Promise<PublicUser> {
    const role = input.role ?? 'EMPLOYEE';
    if (!['ADMIN', 'MANAGER', 'EMPLOYEE'].includes(role)) {
      throw errors.badRequest('Invalid role');
    }
    // Least-privilege: only EMPLOYEE (and the very first ADMIN bootstrap) may
    // self-register. MANAGER roles grant audit read + team visibility, so they
    // require an authenticated administrator actor.
    if (role === 'MANAGER' && actor?.role !== 'ADMIN') {
      throw errors.forbidden('Only administrators can create manager accounts');
    }
    if (role === 'ADMIN') {
      const hasAdmins = adminCount(this.db) > 0;
      const isAdminActor = actor?.role === 'ADMIN';
      const isBootstrap = !hasAdmins && !actor;
      if (!hasAdmins && actor && actor.role !== 'ADMIN') {
        throw errors.forbidden('Only the first administrator can bootstrap the system');
      }
      if (!isAdminActor && !isBootstrap) {
        throw errors.forbidden('Only administrators can create admin accounts');
      }
    }
    if (this.findUser(input.username)) {
      throw errors.conflict('Username is already taken');
    }

    const id = randomUUID();
    const ts = nowIso();
    const passwordHash = hashPassword(input.password);
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, display_name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, input.username, passwordHash, role, input.displayName, ts, ts);

    return toPublicUser(this.findUser(input.username)!);
  }

  async login(username: string, password: string): Promise<{ token: string; user: PublicUser; userRow: UserRow }> {
    const user = this.findUser(username);
    if (!user) {
      await this.audit.record('AUTH_LOGIN_FAILED', {
        actorRole: 'EMPLOYEE',
        payload: { username: username.slice(0, 1) + '*'.repeat(Math.max(0, username.length - 1)) },
      });
      throw errors.unauthorized('Invalid credentials');
    }
    const ok = verifyPassword(password, user.password_hash);
    if (!ok || user.is_active !== 1) {
      await this.audit.record('AUTH_LOGIN_FAILED', { actorId: user.id, actorRole: user.role, subjectId: user.employee_id ?? undefined });
      throw errors.unauthorized('Invalid credentials');
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

    return { token, user: toPublicUser(user), userRow: user };
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