import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { nowIso } from '../../db/index.js';
import { errors } from '../../errors.js';
import type { Role } from '../../auth/tokens.js';
import type { Actor } from '../../authorization.js';
import { canViewEmployee, canManageEmployee, canListUnder } from '../../authorization.js';
import { sha256Hex } from '../../crypto/integrity.js';
import type { StorageAdapter } from '../../storage/types.js';
import { StorageNotFoundError } from '../../storage/types.js';
import type { AuditService } from '../audit/service.js';

function employeeDetailsHash(details: {
  fullName: string;
  department: string;
  title: string;
  email: string | null;
  managedBy: string | null;
}): string {
  return sha256Hex(JSON.stringify(details));
}

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
  ledger_version: number;
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
    ledgerVersion: row.ledger_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EmployeesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: StorageAdapter,
  ) {}

  getById(id: string): EmployeeRow {
    const row = this.db
      .prepare(
        `SELECT id, user_id, full_name, department, title, email, managed_by, is_active, version, ledger_version, created_at, updated_at
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
        detailsSha256: employeeDetailsHash({
          fullName: created.full_name,
          department: created.department,
          title: created.title,
          email: created.email,
          managedBy: created.managed_by,
        }),
      },
      submitToNetwork: false,
    });
    return created;
  }

  async list(actor: Actor): Promise<EmployeeRow[]> {
    const all = this.db
      .prepare(
        `SELECT id, user_id, full_name, department, title, email, managed_by, is_active, version, ledger_version, created_at, updated_at
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
      payload: {
        version: updated.version,
        detailsSha256: employeeDetailsHash({
          fullName: updated.full_name,
          department: updated.department,
          title: updated.title,
          email: updated.email,
          managedBy: updated.managed_by,
        }),
      },
      submitToNetwork: false,
    });
    return updated;
  }

  async submitToLedger(actor: Actor, id: string): Promise<{ eventType: 'EMPLOYEE_CREATED' | 'EMPLOYEE_UPDATED'; version: number }> {
    if (actor.role !== 'ADMIN') throw errors.forbidden('Only administrators can submit employee details to Fabric');
    const employee = this.getById(id);
    if (employee.ledger_version >= employee.version) {
      throw errors.conflict('There are no employee detail or proof changes waiting to be submitted');
    }
    const bridge = this.audit.networkBridge();
    if (!bridge) throw errors.ledger('Fabric ledger is not enabled');
    const network = await bridge.query();
    if (!network.connected) throw errors.ledger(network.error || 'Fabric ledger is not connected');

    const proofRows = this.db
      .prepare(
        `SELECT id, filename, content_type, size_bytes, object_key, key_id, key_version, aad_hex, integrity_sha256
         FROM documents
         WHERE employee_id = ? AND status = 'ACTIVE' ORDER BY id ASC`,
      )
      .all(id) as Array<{
        id: string;
        filename: string;
        content_type: string;
        size_bytes: number;
        object_key: string;
        key_id: string;
        key_version: number;
        aad_hex: string;
        integrity_sha256: string;
      }>;
    const proofManifest: Array<{ documentId: string; ciphertextSha256: string }> = [];
    for (const proof of proofRows) {
      let ciphertext: Buffer;
      try {
        ciphertext = (await this.storage.get(proof.object_key)).body;
      } catch (cause) {
        if (cause instanceof StorageNotFoundError) {
          throw errors.notFound(`Encrypted proof '${proof.filename}' is missing from document storage`);
        }
        throw errors.storage(`Could not read encrypted proof '${proof.filename}': ${String(cause)}`);
      }
      const computedIntegrity = sha256Hex(Buffer.concat([Buffer.from(proof.aad_hex, 'hex'), ciphertext]));
      if (computedIntegrity !== proof.integrity_sha256) {
        throw errors.crypto(`Encrypted proof '${proof.filename}' failed its integrity check`);
      }
      const ciphertextSha256 = sha256Hex(ciphertext);
      const metadata = {
        filename: proof.filename,
        contentType: proof.content_type,
        sizeBytes: proof.size_bytes,
        keyId: proof.key_id,
        keyVersion: proof.key_version,
        aadHex: proof.aad_hex,
        integritySha256: proof.integrity_sha256,
        ciphertextSha256,
      };
      try {
        await bridge.submitEncryptedDocument(
          actor.userId,
          id,
          proof.id,
          JSON.stringify(metadata),
          ciphertext.toString('base64'),
        );
      } catch (cause) {
        throw errors.ledger(`Encrypted proof '${proof.filename}' was not committed to Fabric: ${String(cause)}`);
      }
      proofManifest.push({ documentId: proof.id, ciphertextSha256 });
    }
    const detailsSha256 = employeeDetailsHash({
      fullName: employee.full_name,
      department: employee.department,
      title: employee.title,
      email: employee.email,
      managedBy: employee.managed_by,
    });
    const eventType = employee.ledger_version === 0 ? 'EMPLOYEE_CREATED' : 'EMPLOYEE_UPDATED';

    await this.audit.record(eventType, {
      actorId: actor.userId,
      actorRole: actor.role,
      subjectId: id,
      payload: {
        version: employee.version,
        detailsSha256,
        proofCount: proofManifest.length,
        proofsSha256: sha256Hex(JSON.stringify(proofManifest)),
      },
    });
    this.db.prepare('UPDATE employees SET ledger_version = ? WHERE id = ?').run(employee.version, id);
    return { eventType, version: employee.version };
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
