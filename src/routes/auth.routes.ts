import { Router } from 'express';
import type { AppContext } from '../context.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { simpleRateLimit, skipInTestEnv } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';
import { loginSchema, registerSchema } from '../validation.js';

export function authRoutes(ctx: AppContext): Router {
  const router = Router();

  const publicLimiter = simpleRateLimit({
    windowMs: 60_000,
    max: 30,
    skip: skipInTestEnv,
  });

  // Registration is public for EMPLOYEE self-service and the first ADMIN
  // (bootstrap). MANAGER or additional ADMIN accounts require an admin actor,
  // so an optional bearer token is parsed here and passed to the service.
  router.post(
    '/register',
    publicLimiter,
    optionalAuth(ctx.config.jwtSecret),
    validateBody(registerSchema),
    async (req, res, next) => {
      try {
        const user = await ctx.auth.register(req.body, req.auth ?? null);
        res.status(201).json({ user });
      } catch (cause) {
        next(cause);
      }
    },
  );

  router.post('/login', publicLimiter, validateBody(loginSchema), async (req, res, next) => {
    try {
      const { token, user } = await ctx.auth.login(req.body.username, req.body.password);
      res.status(200).json({ token, user });
    } catch (cause) {
      next(cause);
    }
  });

  router.get('/me', requireAuth(ctx.config.jwtSecret, (id) => ctx.auth.resolveForAuth(id)), async (req, res, next) => {
    try {
      const user = ctx.auth.mePublic(req.auth!);
      res.status(200).json({ user });
    } catch (cause) {
      next(cause);
    }
  });

  return router;
}