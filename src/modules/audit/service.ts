import type { Block, AuditTransaction, AuditEventType, ChainValidation } from '../../blockchain/blockchain.js';
import type { LocalBlockchain } from '../../blockchain/blockchain.js';
import { errors } from '../../errors.js';
import {
  NETWORK_SUBMITTABLE_EVENT_TYPES,
  type LedgerBridge,
} from '../../ledger/types.js';

/**
 * Audit service - records tamper-evident audit transactions and exposes the
 * readable chain + validation. Only metadata is stored; never plaintext or
 * encryption keys.
 *
 * When a remote permissioned ledger is enabled (phase 2), supported event
 * types are submitted to the Fabric network FIRST - the network commit is the
 * authoritative, multi-organization record. The local hash-linked chain is
 * retained as a built-in mirror for offline runs; without an enabled fabric
 * backend behavior is identical to phase 1.
 */
export class AuditService {
  constructor(
    private readonly blockchain: LocalBlockchain,
    private readonly network?: LedgerBridge,
  ) {}

  /** Returns the configured remote ledger bridge, if any. */
  networkBridge(): LedgerBridge | null {
    return this.network && this.network.enabled ? this.network : null;
  }

  async record(
    type: AuditEventType,
    opts: {
      actorId?: string;
      actorRole?: AuditTransaction['actorRole'];
      subjectId?: string;
      payload?: AuditTransaction['payload'];
      timestamp?: string;
    } = {},
  ): Promise<Block> {
    const tx: AuditTransaction = {
      type,
      timestamp: opts.timestamp ?? new Date().toISOString(),
      ...(opts.actorId ? { actorId: opts.actorId } : {}),
      ...(opts.actorRole ? { actorRole: opts.actorRole } : {}),
      ...(opts.subjectId ? { subjectId: opts.subjectId } : {}),
      ...(opts.payload ? { payload: opts.payload } : {}),
    };

    const bridge = this.networkBridge();
    if (bridge && NETWORK_SUBMITTABLE_EVENT_TYPES.has(type)) {
      try {
        await bridge.submitAudit(
          type,
          opts.actorId ?? 'system',
          opts.subjectId ?? 'unknown',
          JSON.stringify(opts.payload ?? {}),
        );
      } catch (cause) {
        throw errors.ledger(
          `Fabric ledger submit failed (event ${type} NOT committed to the network): ${String(cause)}`,
        );
      }
    }

    return this.blockchain.append(tx);
  }

  async chain(): Promise<Block[]> {
    return this.blockchain.chain();
  }

  async validate(): Promise<ChainValidation> {
    return this.blockchain.validate();
  }
}

export function ensureReadableAudit(role: string | undefined): void {
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    throw errors.forbidden('Audit history is restricted to admins and managers');
  }
}