import type { NextFunction, Request, Response } from 'express';
import { errors } from '../errors.js';

export interface RateLimitOptions {
  /** seconds window */
  windowMs: number;
  /** max requests allowed per key within the window */
  max: number;
  /** optional custom key (default: request IP) */
  keyFor?: (req: Request) => string;
  /** skip limiting (e.g. always allow in test environments) */
  skip?: (req: Request) => boolean;
}

/**
 * Minimal in-memory sliding-window rate limiter for public endpoints
 * (login/register). Suitable for a single-instance dev/deployment; a
 * production multi-instance deployment should move this behind a shared
 * store (e.g. Redis) with the same interface.
 */
export function simpleRateLimit(opts: RateLimitOptions) {
  const buckets = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction): void => {
    if (opts.skip?.(req)) {
      next();
      return;
    }
    const key = opts.keyFor ? opts.keyFor(req) : (req.ip ?? 'unknown');
    const now = Date.now();
    const recent = (buckets.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (recent.length >= opts.max) {
      next(errors.tooMany());
      return;
    }
    recent.push(now);
    buckets.set(key, recent);
    next();
  };
}

/** Skip limiting during automated test suites (they hammer auth quickly). */
export function skipInTestEnv(_req: Request): boolean {
  return process.env.NODE_ENV === 'test';
}