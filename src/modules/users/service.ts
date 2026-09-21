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

/**
 * Admin user directory. The full UUID is intentionally exposed here: admins
 * need it to link employee records to accounts.
 */
export class UsersService {
  constructor(private readonly db: Db) {}

  listForAdmin(actor: Actor): UserAdminRow[] {
    if (actor.role !== 'ADMIN') {
      throw errors.forbidden('Only administrators can list user accounts');
    }
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
}