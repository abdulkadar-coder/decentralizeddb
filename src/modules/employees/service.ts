import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { nowIso } from '../../db/index.js';
import { errors } from '../../errors.js';
import type { Role } from '../../auth/tokens.js';
import type { Actor } from '../../authorization.js';
import { canViewEmployee, canManageEmployee, canListUnder } from '../../authorization.js';
import type { AuditService } from '../audit/service.js';

export interface EmployeeRow {
  id: string;
  user_id: string | null;
  full_name: string;
  department: string;
  title: string;
  email: string | null;
  managed_by: string | null;
  is_active: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface EmployeeInput {
  fullName: string;
  department: string;
  title: string;
  email?: string | null;
  managedBy?: string | null;
  userId?: string | null;
}

export function toEmployeePublic(row: EmployeeRow) {
  return {
    id: row.id,
    userId: row.user_id,
    fullName: row.full_name,
    department: row.department,
    title: row.title,
    email: row.email,
    managedBy: row.managed_by,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EmployeesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  getById(id: string): EmployeeRow {
    const row = this.db
      .prepare(
        `SELECT id, user_id, full_name, department, title, email, managed_by, is_active, version, created_at, updated_at
         FROM employees WHERE id = ?`,
      )
      .get(id) as EmployeeRow | undefined;
    if (!row) throw errors.notFound('Employee not found');
    return row;
  }

  private assertNotActiveUserLinked(userId: string | null | undefined, exceptId?: string): void {
    if (!userId) return;
    const row = this.db
      .prepare('SELECT id FROM employees WHERE user_id = ? AND id != ?')
      .get(userId, exceptId ?? '') as { id: string } | undefined;
    if (row) throw errors.conflict('That user account is already linked to another employee');
  }

  async create(actor: Actor, input: EmployeeInput): Promise<EmployeeRow> {
    if (actor.role !== 'ADMIN') throw errors.forbidden('Only administrators can create employees');
    if (input.managedBy) {
      const manager = this.db.prepare('SELECT id FROM employees WHERE id = ?').get(input.managedBy) as
        | { id: string }
        | undefined;
      if (!manager) throw errors.badRequest('managedBy references an unknown employee');
    }
    this.assertNotActiveUserLinked(input.userId);

    const id = randomUUID();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO employees (id, user_id, full_name, department, title, email, managed_by, is_active, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      )
      .run(
        id,
        input.userId ?? null,
        input.fullName,
        input.department,
        input.title,
        input.email ?? null,
        input.managedBy ?? null,
        ts,
        ts,
      );
    const created = this.getById(id);
    await this.audit.record('EMPLOYEE_CREATED', {
      actorId: actor.userId,
      actorRole: actor.role,
      subjectId: id,
      payload: {
        department: created.department,
        title: created.title,
        managedBy: created.managed_by ?? '',
      },
    });
    return created;
  }

  async list(actor: Actor): Promise<EmployeeRow[]> {
    const all = this.db
      .prepare(
        `SELECT id, user_id, full_name, department, title, email, managed_by, is_active, version, created_at, updated_at
         FROM employees ORDER BY created_at ASC`,
      )
      .all() as unknown as EmployeeRow[];
    if (actor.role === 'ADMIN') return all;
    return all.filter((e) => canListUnder(actor, e));
  }

  async get(actor: Actor, id: string): Promise<EmployeeRow> {
    const employee = this.getById(id);
    if (!canViewEmployee(actor, employee)) throw errors.forbidden('Access to this employee is not allowed');
    return employee;
  }

  async update(actor: Actor, id: string, input: Partial<EmployeeInput>): Promise<EmployeeRow> {
    const employee = this.getById(id);
    if (!canManageEmployee(actor, employee)) throw errors.forbidden('You may not modify this employee');

    if (input.managedBy !== undefined && actor.role !== 'ADMIN') {
      throw errors.forbidden('Only administrators can reassign a manager');
    }
    if (input.userId !== undefined && actor.role !== 'ADMIN') {
      throw errors.forbidden('Only administrators can change the linked user account');
    }
    this.assertNotActiveUserLinked(input.userId, id);

    const next = {
      full_name: input.fullName ?? employee.full_name,
      department: input.department ?? employee.department,
      title: input.title ?? employee.title,
      email: input.email === undefined ? employee.email : (input.email ?? null),
      managed_by: input.managedBy === undefined ? employee.managed_by : (input.managedBy ?? null),
      user_id: input.userId === undefined ? employee.user_id : (input.userId ?? null),
    };
    const version = employee.version + 1;
    const ts = nowIso();
    this.db
      .prepare(
        `UPDATE employees SET full_name=?, department=?, title=?, email=?, managed_by=?, user_id=?, version=?, updated_at=? WHERE id=?`,
      )
      .run(next.full_name, next.department, next.title, next.email, next.managed_by, next.user_id, version, ts, id);

    const updated = this.getById(id);
    await this.audit.record('EMPLOYEE_UPDATED', {
      actorId: actor.userId,
      actorRole: actor.role,
      subjectId: id,
      payload: { version: updated.version },
    });
    return updated;
  }

  async changeRole(actor: Actor, id: string, role: Role): Promise<EmployeeRow> {
    const employee = this.getById(id);
    if (actor.role !== 'ADMIN') throw errors.forbidden('Only administrators can change roles');
    if (!employee.user_id) throw errors.badRequest('This employee has no linked user account');
    const current = this.db.prepare('SELECT role FROM users WHERE id = ?').get(employee.user_id) as
      | { role: string }
      | undefined;
    if (!current) throw errors.badRequest('Linked user account not found');
    if (current.role === role) throw errors.conflict('Employee already has this role');

    this.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, nowIso(), employee.user_id);
    await this.audit.record('ROLE_CHANGED', {
      actorId: actor.userId,
      actorRole: actor.role,
      subjectId: id,
      payload: { from: current.role, to: role },
    });
    return this.getById(id);
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const employee = this.getById(id);
    if (actor.role !== 'ADMIN') throw errors.forbidden('Only administrators can delete employees');
    const ts = nowIso();
    this.db
      .prepare('UPDATE employees SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(ts, id);
    if (employee.user_id) {
      this.db.prepare('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?').run(ts, employee.user_id);
    }
    await this.audit.record('EMPLOYEE_DELETED', {
      actorId: actor.userId,
      actorRole: actor.role,
      subjectId: id,
      payload: { fullName: employee.full_name },
    });
  }
}