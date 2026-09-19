import { describe, it, expect } from 'vitest';
import { makeTestContext } from './helpers.js';
import { LocalBlockchain, MemoryChainStore, computeBlockHash, validateChain, GENESIS_PREV_HASH } from '../src/blockchain/blockchain.js';
import type { AuditTransaction, Block } from '../src/blockchain/blockchain.js';

function tx(type: AuditTransaction['type'], extra: Record<string, unknown> = {}): AuditTransaction {
  return { type, timestamp: new Date().toISOString(), ...extra };
}

describe('local hash-linked audit blockchain', () => {
  it('creates a genesis block with the reserved prev-hash', async () => {
    const chain = new LocalBlockchain(new MemoryChainStore());
    await chain.init();
    const blocks = await chain.chain();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.height).toBe(0);
    expect(blocks[0]!.tx.type).toBe('GENESIS');
    expect(blocks[0]!.prevHash).toBe(GENESIS_PREV_HASH);
    expect(blocks[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await chain.validate()).toMatchObject({ valid: true, length: 1, issues: [] });
  });

  it('links each block to the previous hash and hashes deterministically', async () => {
    const chain = new LocalBlockchain(new MemoryChainStore());
    await chain.init();
    const blocks: Block[] = [];
    for (const type of ['EMPLOYEE_CREATED', 'DOCUMENT_UPLOADED', 'DOCUMENT_ACCESSED'] as const) {
      blocks.push(await chain.append(tx(type, { payload: { n: type.length } })));
    }
    expect(blocks).toHaveLength(3);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i]!.prevHash).toBe(blocks[i - 1]!.hash);
    }
    // deterministic: recomputing the canonical serialization yields the same hash
    const recomputed = computeBlockHash(blocks[1]!.height, blocks[1]!.tx.timestamp, LocalBlockchain.canonicalTx(blocks[1]!.tx), blocks[1]!.prevHash);
    expect(recomputed).toBe(blocks[1]!.hash);
  });

  it('detects a tampered transaction in a block', async () => {
    const chain = new LocalBlockchain(new MemoryChainStore());
    await chain.init();
    await chain.append(tx('EMPLOYEE_CREATED', { subjectId: 'a' }));
    await chain.append(tx('ROLE_CHANGED', { subjectId: 'b' }));
    const blocks = await chain.chain();
    expect(await chain.validate()).toMatchObject({ valid: true });

    const tampered = blocks.map((b) => ({ ...b, tx: { ...b.tx } }));
    const target = tampered[1]!;
    target.tx.payload = { ...target.tx.payload, subjectId: 'MALICIOUS' };
    const result = validateChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.height === 1)).toBe(true);
  });

  it('detects a modified stored hash (recomputed content mismatch)', async () => {
    const chain = new LocalBlockchain(new MemoryChainStore());
    await chain.init();
    await chain.append(tx('DOCUMENT_UPLOADED', {})).catch(() => null);
    await chain.append(tx('DOCUMENT_ACCESSED', {}));
    const blocks = await chain.chain();
    expect(await chain.validate()).toMatchObject({ valid: true });

    const tampered = blocks.map((b) => ({ ...b }));
    tampered[1]!.hash = 'f'.repeat(64);
    const result = validateChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({ height: 1, reason: expect.stringContaining('block was modified') });
  });

  it('detects a broken prev-hash link', async () => {
    const chain = new LocalBlockchain(new MemoryChainStore());
    await chain.init();
    await chain.append(tx('EMPLOYEE_UPDATED', {}));
    await chain.append(tx('ACCESS_REVOKED', {}));
    const blocks = await chain.chain();

    const tampered = blocks.map((b) => ({ ...b }));
    tampered[2]!.prevHash = '0'.repeat(64);
    const result = validateChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({ height: 2, reason: expect.stringContaining('chain broken') });
  });

  it('validates an appended-during-runtime chain from the sqlite store', async () => {
    const { ctx, cleanup } = await makeTestContext();
    try {
      await ctx.audits.record('DOCUMENT_ACCESSED', { subjectId: 'emp-1', payload: { documentId: 'd1' } });
      const chain = await ctx.audits.chain();
      expect(chain.length).toBeGreaterThanOrEqual(2);
      expect(await ctx.audits.validate()).toMatchObject({ valid: true });
      expect(chain[0]!.tx.type).toBe('GENESIS');
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i]!.prevHash).toBe(chain[i - 1]!.hash);
      }
    } finally {
      cleanup();
    }
  });
});