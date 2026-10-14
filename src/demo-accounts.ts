import { randomUUID } from 'node:crypto';
import type { Db } from './db/index.js';
import { nowIso } from './db/index.js';
import { logger } from './logger.js';

export const DEMO_LOGIN_CODE = '000000';

export const DEMO_ACCOUNTS = [
  { username: 'demo.admin', displayName: 'Demo Administrator', role: 'ADMIN' },
  { username: 'demo.manager', displayName: 'Demo Manager', role: 'MANAGER' },
  { username: 'demo.employee', displayName: 'Demo Employee', role: 'EMPLOYEE' },
] as const;

/** Create predictable, local-only accounts to make role workflows easy to present. */
export function seedDemoAccounts(db: Db): void {
  const ts = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    const findUser = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE');
    for (const account of DEMO_ACCOUNTS) {
      if (findUser.get(account.username)) continue;
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, display_name, is_active, created_at, updated_at, totp_secret_enc, totp_enabled, totp_verified_at, totp_created_at, recovery_codes_json)
         VALUES (?, ?, NULL, ?, ?, 1, ?, ?, NULL, 0, NULL, NULL, '[]')`,
      ).run(randomUUID(), account.username, account.role, account.displayName, ts, ts);
    }

    const manager = findUser.get('demo.manager') as { id: string } | undefined;
    const employee = findUser.get('demo.employee') as { id: string } | undefined;
    const findEmployee = db.prepare('SELECT id FROM employees WHERE user_id = ?');
    if (manager && !findEmployee.get(manager.id)) {
      db.prepare(
        `INSERT INTO employees (id, user_id, full_name, department, title, email, managed_by, created_at, updated_at)
         VALUES (?, ?, 'Demo Manager', 'People Operations', 'HR Manager', 'demo.manager@example.test', NULL, ?, ?)`,
      ).run(randomUUID(), manager.id, ts, ts);
    }
    const managerEmployee = manager ? (findEmployee.get(manager.id) as { id: string } | undefined) : undefined;
    if (employee && !findEmployee.get(employee.id)) {
      db.prepare(
        `INSERT INTO employees (id, user_id, full_name, department, title, email, managed_by, created_at, updated_at)
         VALUES (?, ?, 'Demo Employee', 'Engineering', 'Software Engineer', 'demo.employee@example.test', ?, ?, ?)`,
      ).run(randomUUID(), employee.id, managerEmployee?.id ?? null, ts, ts);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  logger.info('demo', 'local role demo accounts are ready');
}
