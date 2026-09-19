import { Router } from 'express';
import type { AppContext } from '../context.js';
import { dbHealth } from '../db/index.js';
import { StorageUnavailableError } from '../storage/types.js';

export function healthRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const db = dbHealth(ctx.db);
    let storage: string;
    let storageUp = true;
    try {
      await ctx.storage.ping();
      storage = ctx.storage.kind;
    } catch (cause) {
      storageUp = false;
      storage = cause instanceof StorageUnavailableError ? String(cause.message) : ctx.storage.kind;
    }
    const status = db && storageUp ? 'ok' : 'degraded';
    res.status(status === 'ok' ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      db: db ? 'ok' : 'unavailable',
      storage: storageUp ? storage : `unavailable (${storage})`,
      blockchain: {
        backend: ctx.config.blockchainBackend,
        prototype: 'local-single-node-hash-linked-audit-chain',
      },
    });
  });

  return router;
}