import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger.js';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash       TEXT,
  role                TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','EMPLOYEE')),
  display_name        TEXT NOT NULL,
  employee_id         TEXT UNIQUE,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  totp_secret_enc     TEXT,
  totp_enabled        INTEGER NOT NULL DEFAULT 0,
  totp_verified_at    TEXT,
  totp_created_at     TEXT,
  recovery_codes_json TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id          TEXT PRIMARY KEY,
  user_id     TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name   TEXT NOT NULL,
  department  TEXT NOT NULL,
  title       TEXT NOT NULL,
  email       TEXT,
  managed_by  TEXT REFERENCES employees(id) ON DELETE SET NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  version     INTEGER NOT NULL DEFAULT 1,
  ledger_version INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id               TEXT PRIMARY KEY,
  employee_id      TEXT NOT NULL REFERENCES employees(id),
  filename         TEXT NOT NULL,
  content_type     TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL,
  object_key       TEXT NOT NULL UNIQUE,
  key_id           TEXT NOT NULL,
  key_version      INTEGER NOT NULL,
  aad_hex          TEXT NOT NULL,
  integrity_sha256 TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  uploaded_by      TEXT REFERENCES users(id),
  uploaded_at      TEXT NOT NULL,
  revoked_at       TEXT
);

CREATE TABLE IF NOT EXISTS key_registry (
  key_id          TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_blocks (
  height    INTEGER PRIMARY KEY,
  tx_json   TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sms_otp_codes (
  user_id    TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`;

/** Opens the SQLite database, creating the file and schema when missing. */
export function openDatabase(dbFile: string): Db {
  if (dbFile !== ':memory:') {
    mkdirSync(dirname(dbFile), { recursive: true });
  }
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const employeeColumns = db.prepare('PRAGMA table_info(employees)').all() as Array<{ name: string }>;
  if (!employeeColumns.some((column) => column.name === 'ledger_version')) {
    db.exec('ALTER TABLE employees ADD COLUMN ledger_version INTEGER NOT NULL DEFAULT 0;');
  }
  logger.debug('db', 'database ready', { dbFile: dbFile === ':memory:' ? ':memory:' : dbFile });
  return db;
}

export function dbHealth(db: Db): boolean {
  try {
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    return row?.ok === 1;
  } catch {
    return false;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
