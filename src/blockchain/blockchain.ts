import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/index.js';
import { sha256Hex } from '../crypto/integrity.js';

export type AuditEventType =
  | 'EMPLOYEE_CREATED'
  | 'EMPLOYEE_UPDATED'
  | 'EMPLOYEE_DELETED'
  | 'ROLE_CHANGED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_ACCESSED'
  | 'ACCESS_REVOKED'
  | 'AUTH_LOGIN'
  | 'AUTH_LOGIN_FAILED'
  | 'GENESIS';

/** Audit transactions carry metadata only - never plaintext or keys. */
export interface AuditTransaction {
  type: AuditEventType;
  actorId?: string;
  actorRole?: 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  subjectId?: string;
  timestamp: string;
  payload?: Record<string, string | number | boolean | null>;
}

export interface Block {
  height: number;
  tx: AuditTransaction;
  prevHash: string;
  hash: string;
}

export const GENESIS_PREV_HASH = '0'.repeat(64);

export function computeBlockHash(height: number, timestamp: string, txJson: string, prevHash: string): string {
  const canonical = [
    'zerotrust-hrms/audit/v1',
    `height=${height}`,
    `ts=${timestamp}`,
    `prev=${prevHash}`,
    `tx=${txJson}`,
  ].join('\n');
  return sha256Hex(canonical);
}

function canonicalTxJson(tx: AuditTransaction): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(tx).sort()) {
    const value = tx[key as keyof AuditTransaction];
    sorted[key] = value;
  }
  return JSON.stringify(sorted);
}

/** Deterministic 64-char nonce used only for genesis, derived from the timestamp. */
function genesisNonce(): string {
  return createHash('sha256').update(randomBytes(8)).digest('hex');
}

export interface ValidationIssue {
  height: number;
  reason: string;
}

export interface ChainValidation {
  valid: boolean;
  length: number;
  issues: ValidationIssue[];
}

/**
 * Validate an in-memory array of blocks (first block expected at height 0 =
 * genesis). Pure function so it can be used on copies of a live chain to
 * demonstrate tamper detection without mutating the persistent chain.
 */
export function validateChain(blocks: Block[]): ChainValidation {
  const issues: ValidationIssue[] = [];
  if (blocks.length === 0) {
    return { valid: false, length: 0, issues: [{ height: -1, reason: 'chain is empty' }] };
  }

  blocks.forEach((block, i) => {
    if (block.height !== i) {
      issues.push({ height: block.height, reason: `expected height ${i}, found ${block.height}` });
      return;
    }
    if (i === 0) {
      if (block.prevHash !== GENESIS_PREV_HASH) {
        issues.push({ height: block.height, reason: 'genesis block has invalid prev-hash' });
        return;
      }
    } else {
      const previous = blocks[i - 1];
      if (!previous) {
        issues.push({ height: block.height, reason: 'missing previous block' });
        return;
      }
      if (block.prevHash !== previous.hash) {
        issues.push({ height: block.height, reason: 'prev-hash does not link to previous block (chain broken)' });
        return;
      }
    }
    const recomputed = computeBlockHash(block.height, block.tx.timestamp, canonicalTxJson(block.tx), block.prevHash);
    if (recomputed !== block.hash) {
      issues.push({ height: block.height, reason: 'block hash does not match its content (block was modified)' });
    }
  });

  return { valid: issues.length === 0, length: blocks.length, issues };
}

export interface ChainStoreBackend {
  lastBlock(): Promise<Block | null>;
  append(block: Block): Promise<void>;
  all(): Promise<Block[]>;
}

/** SQLite-backed chain store. */
export class SqliteChainStore implements ChainStoreBackend {
  constructor(private readonly db: Db) {}

  async lastBlock(): Promise<Block | null> {
    const row = this.db
      .prepare('SELECT height, tx_json, timestamp, prev_hash, hash FROM audit_blocks ORDER BY height DESC LIMIT 1')
      .get() as
      | { height: number; tx_json: string; timestamp: string; prev_hash: string; hash: string }
      | undefined;
    if (!row) return null;
    return { height: row.height, tx: JSON.parse(row.tx_json), prevHash: row.prev_hash, hash: row.hash };
  }

  async append(block: Block): Promise<void> {
    this.db
      .prepare('INSERT INTO audit_blocks (height, tx_json, timestamp, prev_hash, hash) VALUES (?, ?, ?, ?, ?)')
      .run(block.height, JSON.stringify(block.tx), block.tx.timestamp, block.prevHash, block.hash);
  }

  async all(): Promise<Block[]> {
    const rows = this.db
      .prepare('SELECT height, tx_json, timestamp, prev_hash, hash FROM audit_blocks ORDER BY height ASC')
      .all() as { height: number; tx_json: string; timestamp: string; prev_hash: string; hash: string }[];
    return rows.map((row) => ({
      height: row.height,
      tx: JSON.parse(row.tx_json),
      prevHash: row.prev_hash,
      hash: row.hash,
    }));
  }
}

/** In-memory chain store. For tests/isolated demos only - NOT production. */
export class MemoryChainStore implements ChainStoreBackend {
  private blocks: Block[] = [];

  async lastBlock(): Promise<Block | null> {
    return this.blocks.length ? this.blocks[this.blocks.length - 1]! : null;
  }

  async append(block: Block): Promise<void> {
    this.blocks.push(block);
  }

  async all(): Promise<Block[]> {
    return [...this.blocks];
  }
}

/**
 * Local hash-linked audit blockchain (development prototype).
 *
 * This is a SINGLE-NODE prototype. It is NOT a decentralized multi-node
 * network: there is no consensus, no peer-to-peer gossip and no distributed
 * ledger. Its purpose is to demonstrate tamper-evident audit history that
 * can be upgraded to a distributed chain in later phases.
 */
export class LocalBlockchain {
  constructor(private readonly store: ChainStoreBackend) {}

  async init(): Promise<void> {
    const last = await this.store.lastBlock();
    if (last) return;
    const genesisTx: AuditTransaction = {
      type: 'GENESIS',
      timestamp: new Date().toISOString(),
      payload: { genesisId: genesisNonce(), note: 'local audit chain initialized' },
    };
    const genesis: Block = {
      height: 0,
      tx: genesisTx,
      prevHash: GENESIS_PREV_HASH,
      hash: computeBlockHash(0, genesisTx.timestamp, canonicalTxJson(genesisTx), GENESIS_PREV_HASH),
    };
    await this.store.append(genesis);
  }

  static canonicalTx(tx: AuditTransaction): string {
    return canonicalTxJson(tx);
  }

  /** Append a transaction and return the new block. Snapshot is last-write-wins. */
  async append(tx: AuditTransaction): Promise<Block> {
    const last = await this.store.lastBlock();
    const height = (last?.height ?? -1) + 1;
    const prevHash = last ? last.hash : GENESIS_PREV_HASH;
    const block: Block = {
      height,
      tx,
      prevHash,
      hash: computeBlockHash(height, tx.timestamp, canonicalTxJson(tx), prevHash),
    };
    await this.store.append(block);
    return block;
  }

  async chain(): Promise<Block[]> {
    return this.store.all();
  }

  /** Validate the persisted chain against its internal hashes/links. */
  async validate(): Promise<ChainValidation> {
    return validateChain(await this.store.all());
  }
}

export { canonicalTxJson };