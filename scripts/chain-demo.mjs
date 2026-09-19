// Chain tamper / restore demo tool. Corrupts the last audit block (or restores
// the pre-demo backup) so you can demonstrate the audit chain's tamper
// detection live to the judge.
//
// Usage (recommended with the server stopped for the clearest demo):
//   node scripts/chain-demo.mjs           # backup + corrupt the last block
//   node scripts/chain-demo.mjs --restore # restore the chain from the backup
//
// After corrupting, run `npx tsx scripts/chain-verify.ts` (or open the Audit
// page): the chain is reported INVALID — "block hash does not match its
// content (block was modified)". Restore brings it back to VALID.
//
// All operations use SQLite-level snapshots (VACUUM INTO / ATTACH) so the
// results are correct whether the app server is running or stopped - plain
// file copies would get confused by WAL/SHM sidecar files.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(PROJECT_ROOT, 'data', 'hrms.db');
const BACKUP = join(PROJECT_ROOT, 'data', 'hrms.db.bak');
// backslashes would need escaping inside SQL string literals
const FWD_BACKUP = BACKUP.replace(/\\/g, '/');

function lastBlock(db) {
  return db.prepare('SELECT height FROM audit_blocks ORDER BY height DESC LIMIT 1').get();
}

function corrupt() {
  if (!existsSync(DB)) {
    console.error('data/hrms.db not found. Start the server once first.');
    process.exit(1);
  }
  // Snapshot the CURRENT committed state first (VACUUM INTO writes a complete,
  // standalone copy - immune to WAL/SHM sidecar files).
  rmSync(BACKUP, { force: true });
  const snapshot = new DatabaseSync(DB);
  snapshot.exec(`VACUUM INTO '${FWD_BACKUP}'`);
  snapshot.close();

  const db = new DatabaseSync(DB);
  const last = lastBlock(db);
  if (!last) {
    console.error('audit chain is empty.');
    db.close();
    process.exit(1);
  }
  db.prepare('UPDATE audit_blocks SET tx_json = ? WHERE height = ?').run(
    JSON.stringify({
      type: 'GENERIC_HACK',
      timestamp: '2026-09-19T00:00:00Z',
      payload: { note: 'judge-altered-my-record' },
    }),
    last.height,
  );
  db.close();
  console.log(`backup saved (data/hrms.db.bak); corrupted block height ${last.height} - chain now fails validation.`);
}

function restore() {
  if (!existsSync(BACKUP)) {
    console.error('no backup found (data/hrms.db.bak). Run without --restore first.');
    process.exit(1);
  }
  const db = new DatabaseSync(DB);
  if (!lastBlock(db)) {
    console.error('audit_blocks table missing in live DB; nothing to restore into.');
    db.close();
    process.exit(1);
  }
  db.exec(`ATTACH DATABASE '${FWD_BACKUP}' AS src`);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM audit_blocks');
    db.exec(
      'INSERT INTO audit_blocks (height, tx_json, timestamp, prev_hash, hash) ' +
        'SELECT height, tx_json, timestamp, prev_hash, hash FROM src.audit_blocks',
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  db.exec('DETACH DATABASE src'); // DETACH is not allowed inside a transaction
  db.close();
  console.log('restored chain from data/hrms.db.bak; validation passes again.');
}

if (process.argv.includes('--restore')) restore();
else corrupt();