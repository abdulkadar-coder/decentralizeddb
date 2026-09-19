import { describe, it, expect } from 'vitest';
import { LocalBlockchain, MemoryChainStore } from '../src/blockchain/blockchain.js';
import { AuditService } from '../src/modules/audit/service.js';
import { NETWORK_SUBMITTABLE_EVENT_TYPES, type LedgerBridge } from '../src/ledger/types.js';

class FakeLedger implements LedgerBridge {
  readonly enabled: boolean;
  calls: Array<{ eventType: string; actorId: string; subjectId: string; payloadJson: string }> = [];
  failNext = false;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  async submitAudit(eventType: string, actorId: string, subjectId: string, payloadJson: string) {
    this.calls.push({ eventType, actorId, subjectId, payloadJson });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('network unreachable');
    }
    return { committed: true, seq: this.calls.length, txId: `tx-${this.calls.length}`, hash: 'h' };
  }

  async query() {
    return { connected: true, seq: 0, records: [], valid: true, issues: [] };
  }
}

async function makeService(fake: FakeLedger | null): Promise<AuditService> {
  const chain = new LocalBlockchain(new MemoryChainStore());
  await chain.init();
  return new AuditService(chain, fake ?? undefined);
}

describe('audit ledger integration (phase 2)', () => {
  it('forwards submittable event types to the network before appending locally', async () => {
    const fake = new FakeLedger(true);
    const service = await makeService(fake);
    await service.record('DOCUMENT_ACCESSED', {
      actorId: 'user-1',
      subjectId: 'emp-0050',
      payload: { docId: 'doc-1', via: 'api' },
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      eventType: 'DOCUMENT_ACCESSED',
      actorId: 'user-1',
      subjectId: 'emp-0050',
    });
    expect(JSON.parse(fake.calls[0]!.payloadJson)).toEqual({ docId: 'doc-1', via: 'api' });
    expect((await service.chain()).length).toBe(2); // genesis + record
  });

  it('never submits event types the chaincode does not accept', async () => {
    const fake = new FakeLedger(true);
    const service = await makeService(fake);
    await service.record('AUTH_LOGIN', { actorId: 'user-1' });
    await service.record('GENESIS', {});
    expect(fake.calls).toHaveLength(0);
    expect((await service.chain()).length).toBe(3);
  });

  it('recovers a local record when no network bridge is configured', async () => {
    const service = await makeService(new FakeLedger(false));
    await service.record('ROLE_CHANGED', { actorId: 'user-1', subjectId: 'emp-9' });
    expect((await service.chain()).length).toBe(2);
  });

  it('throws a ledger error (and refuses the append) when the network submit fails', async () => {
    const fake = new FakeLedger(true);
    fake.failNext = true;
    const service = await makeService(fake);
    await expect(service.record('DOCUMENT_ACCESSED', { actorId: 'user-1' })).rejects.toMatchObject({
      status: 503,
      code: 'LEDGER_FAILURE',
    });
    expect((await service.chain()).length).toBe(1); // no local append happened
  });

  it('exposes the configured bridge through networkBridge()', async () => {
    expect(await makeService(new FakeLedger(false)).then((s) => s.networkBridge())).toBeNull();
    const bridge = await makeService(new FakeLedger(true)).then((s) => s.networkBridge());
    expect(bridge).not.toBeNull();
  });

  it('covers the same submittable set the chaincode permits', () => {
    expect([...NETWORK_SUBMITTABLE_EVENT_TYPES].sort()).toEqual(
      ['ACCESS_REVOKED', 'DOCUMENT_ACCESSED', 'DOCUMENT_UPLOADED', 'EMPLOYEE_CREATED', 'EMPLOYEE_UPDATED', 'ROLE_CHANGED'],
    );
  });

  it('defaults to the off backend and honors LEDGER_BACKEND=fabric', async () => {
    const original = process.env.LEDGER_BACKEND;
    try {
      delete process.env.LEDGER_BACKEND;
      const { loadConfig } = await import('../src/config.js');
      expect(loadConfig().ledgerBackend).toBe('off');
      process.env.LEDGER_BACKEND = 'fabric';
      expect(loadConfig().ledgerBackend).toBe('fabric');
      expect(loadConfig().fabric.enabled).toBe(true);
    } finally {
      if (original === undefined) delete process.env.LEDGER_BACKEND;
      else process.env.LEDGER_BACKEND = original;
    }
  });
});