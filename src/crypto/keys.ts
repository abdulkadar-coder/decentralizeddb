import { hkdf } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from '../db/index.js';
import { logger } from '../logger.js';

const hkdfAsync = promisify(hkdf);

export interface ManagedKey {
  key: Buffer;
  keyId: string;
  version: number;
}

export interface KeyManager {
  /** Return the current (latest) version number for a key family. */
  currentVersion(keyId: string): number;
  /** Derive the key material for keyId@version. */
  getKey(keyId: string, version: number): Promise<ManagedKey>;
  /** Increment the version counter and return the new derived key. */
  bumpVersion(keyId: string): Promise<ManagedKey>;
}

const HKDF_HASH = 'sha256';
const HKDF_KEYLEN = 32;
const INFO_PREFIX = 'zerotrust-hrms/key/v2';

function deriveKeySync(masterKey: Buffer, keyId: string, version: number): Promise<Buffer> {
  const salt = `salt:${keyId}:${version}`;
  const info = `${INFO_PREFIX}/${keyId}/${version}`;
  return hkdfAsync(HKDF_HASH, masterKey, salt, info, HKDF_KEYLEN).then((derived) =>
    Buffer.from(derived as ArrayBuffer),
  );
}

function ensureRow(db: Db, keyId: string): { current_version: number } {
  const row = db
    .prepare('SELECT current_version FROM key_registry WHERE key_id = ?')
    .get(keyId) as { current_version: number } | undefined;
  if (row) return row;
  db.prepare('INSERT INTO key_registry (key_id, current_version) VALUES (?, 0)').run(keyId);
  return { current_version: 0 };
}

/**
 * Local HKDF-based key manager.
 *
 * **Not a production KMS substitute.**
 *
 * This implementation deterministically derives AES-256-GCM keys from a
 * single master secret using HKDF-SHA256. It is cryptographically sound
 * for local development and encrypted-at-rest scenarios but lacks:
 *
 * - Hardware-backed key storage / tamper resistance
 * - Remote audit logging of key access
 * - Centralised key lifecycle & rotation policies
 * - Cloud-KMS authentication & audit trails
 *
 * For production workloads, replace this with a cloud KMS integration
 * (e.g. AWS KMS, Google Cloud KMS, Azure Key Vault, HashiCorp Vault
 * Transit Engine).
 */
export class LocalKeyManager implements KeyManager {
  constructor(private readonly db: Db, private readonly masterKey: Buffer) {}

  currentVersion(keyId: string): number {
    return ensureRow(this.db, keyId).current_version;
  }

  async getKey(keyId: string, version: number): Promise<ManagedKey> {
    if (version <= 0) throw new Error(`invalid key version ${version}`);
    const key = await deriveKeySync(this.masterKey, keyId, version);
    return { key, keyId, version };
  }

  async bumpVersion(keyId: string): Promise<ManagedKey> {
    ensureRow(this.db, keyId);
    dbRun(this.db, 'UPDATE key_registry SET current_version = current_version + 1 WHERE key_id = ?', [keyId]);
    const version = this.currentVersion(keyId);
    const key = await deriveKeySync(this.masterKey, keyId, version);
    logger.debug('keys', 'bumped key version', { keyId, version });
    return { key, keyId, version };
  }
}

function dbRun(db: Db, sql: string, params: unknown[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db.prepare(sql).run(...(params as any));
}