import type { Db } from '../../db/index.js';
import { errors } from '../../errors.js';
import type { Role } from '../../auth/tokens.js';
import type { Actor } from '../../authorization.js';

export interface UserAdminRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  is_active: number;
  employee_id: string | null;
  employee_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountDirectoryRow extends UserAdminRow {
  proof_count: number;
  last_proof_at: string | null;
}

export function toUserAdminView(row: UserAdminRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active === 1,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAccountDirectoryView(row: AccountDirectoryRow) {
  return {
    ...toUserAdminView(row),
    proofCount: row.proof_count,
    lastProofAt: row.last_proof_at,
  };
}

/**
 * Admin user directory. The full UUID is intentionally exposed here: admins
 * need it to link employee records to accounts.
 */
export class UsersService {
  constructor(private readonly db: Db) {}

  private selectUsers(): UserAdminRow[] {
    return this.db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.role, u.is_active,
                e.id AS employee_id, e.full_name AS employee_name,
                u.created_at, u.updated_at
         FROM users u
         LEFT JOIN employees e ON e.user_id = u.id
         ORDER BY u.created_at ASC`,
      )
      .all() as unknown as UserAdminRow[];
  }

  listForAdmin(actor: Actor): UserAdminRow[] {
    if (actor.role !== 'ADMIN') {
      throw errors.forbidden('Only administrators can list user accounts');
    }
    return this.selectUsers();
  }

  /**
   * Proof ledger: how many audit blocks each actor authored (the tamper-evident
   * "proofs" recorded for their actions), plus the most recent timestamp.
   */
  private proofStats(): Map<string, { count: number; lastAt: string | null }> {
    const rows = this.db.prepare('SELECT tx_json FROM audit_blocks').all() as { tx_json: string }[];
    const stats = new Map<string, { count: number; lastAt: string | null }>();
    for (const row of rows) {
      let tx: { actorId?: string; timestamp?: string } | null = null;
      try {
        tx = JSON.parse(row.tx_json) as { actorId?: string; timestamp?: string };
      } catch {
        continue;
      }
      if (!tx?.actorId) continue;
      const current = stats.get(tx.actorId) ?? { count: 0, lastAt: null };
      current.count += 1;
      if (tx.timestamp && (!current.lastAt || tx.timestamp > current.lastAt)) {
        current.lastAt = tx.timestamp;
      }
      stats.set(tx.actorId, current);
    }
    return stats;
  }

  /**
   * Scoped account directory with role + authored-proof counts.
   * ADMIN sees everyone; MANAGER sees self + linked direct reports; EMPLOYEE
   * sees only their own account.
   */
  directory(actor: Actor): AccountDirectoryRow[] {
    const rows = this.selectUsers();
    const stats = this.proofStats();
    const withStats: AccountDirectoryRow[] = rows.map((row) => ({
      ...row,
      proof_count: stats.get(row.id)?.count ?? 0,
      last_proof_at: stats.get(row.id)?.lastAt ?? null,
    }));

    if (actor.role === 'ADMIN') return withStats;

    if (actor.role === 'MANAGER') {
      const directUserIds = new Set<string>();
      if (actor.employeeId) {
        const reports = this.db
          .prepare('SELECT user_id FROM employees WHERE managed_by = ? AND user_id IS NOT NULL')
          .all(actor.employeeId) as { user_id: string }[];
        for (const report of reports) directUserIds.add(report.user_id);
      }
      return withStats.filter((row) => row.id === actor.userId || directUserIds.has(row.id));
    }

    return withStats.filter((row) => row.id === actor.userId);
  }
}