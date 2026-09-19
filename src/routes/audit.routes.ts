import { Router } from 'express';
import type { AppContext } from '../context.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { ensureReadableAudit } from '../modules/audit/service.js';
import { masked } from '../modules/audit/format.js';

export function auditRoutes(ctx: AppContext): Router {
  const router = Router();
  const auth = requireAuth(ctx.config.jwtSecret, (id) => ctx.auth.resolveForAuth(id));

  router.use(auth, requireRoles('ADMIN', 'MANAGER'));

  router.get('/chain', async (req, res, next) => {
    try {
      ensureReadableAudit(req.auth?.role);
      const blocks = await ctx.audits.chain();
      res.status(200).json({
        prototype: 'local-single-node-hash-linked-audit-chain (not a decentralized network)',
        valid: (await ctx.audits.validate()).valid,
        length: blocks.length,
        blocks: blocks.map((b) => ({
          height: b.height,
          timestamp: b.tx.timestamp,
          type: b.tx.type,
          actorId: b.tx.actorId ? masked(b.tx.actorId) : undefined,
          subjectId: b.tx.subjectId ? masked(b.tx.subjectId) : undefined,
          payload: b.tx.payload,
          prevHash: masked(b.prevHash),
          hash: masked(b.hash),
        })),
      });
    } catch (cause) {
      next(cause);
    }
  });

  router.get('/validate', async (req, res, next) => {
    try {
      ensureReadableAudit(req.auth?.role);
      const validation = await ctx.audits.validate();
      const full = await ctx.audits.chain();
      const blocks = full.map((b) => ({
        height: b.height,
        type: b.tx.type,
        timestamp: b.tx.timestamp,
        prevHash: b.prevHash,
        hash: b.hash,
      }));
      res.status(200).json({ validation, blocks });
    } catch (cause) {
      next(cause);
    }
  });

  /**
   * Hyperledger Fabric audit ledger (phase 2). Deliberately separate from the
   * local prototype chain: when enabled, the Fabric network commit is the
   * authoritative, multi-organization record of the submittable event types.
   * The local /chain endpoint remains a built-in mirror, never an authority.
   */
  router.get('/network', async (req, res, next) => {
    try {
      ensureReadableAudit(req.auth?.role);
      const bridge = ctx.audits.networkBridge();
      if (!bridge) {
        res.status(200).json({ enabled: false, message: 'Fabric ledger is not enabled (set LEDGER_BACKEND=fabric)' });
        return;
      }
      const q = await bridge.query();
      res.status(200).json({
        enabled: true,
        connected: q.connected,
        ...(q.error ? { error: q.error } : {}),
        seq: q.seq,
        valid: q.valid,
        issues: q.issues,
        records: q.records.map((r) => ({
          seq: r.seq,
          eventType: r.eventType,
          actorId: masked(r.actorId),
          subjectId: masked(r.subjectId),
          payload: r.payload,
          creatorMsp: r.creatorMsp,
          signerId: masked(r.signerId),
          timestamp: r.ts,
          txId: masked(r.txId),
          prevHash: masked(r.prevHash),
          hash: masked(r.hash),
        })),
      });
    } catch (cause) {
      next(cause);
    }
  });

  return router;
}