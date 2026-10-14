import { Router } from 'express';
import type { AppContext } from '../context.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { simpleRateLimit, skipInTestEnv } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';
import { registerSchema, loginSchema, totpVerifySchema, totpDisableSchema, recoveryLoginSchema, smsSendSchema, smsVerifySchema } from '../validation.js';

export function authRoutes(ctx: AppContext): Router {
  const router = Router();

  const publicLimiter = simpleRateLimit({
    windowMs: 60_000,
    max: 30,
    skip: skipInTestEnv,
  });

  const totpLimiter = simpleRateLimit({
    windowMs: 60_000,
    max: 10,
    skip: skipInTestEnv,
  });

  // Registration - bootstrap admin gets recovery codes, no password
  router.post(
    '/register',
    publicLimiter,
    optionalAuth(ctx.config.jwtSecret, (id) => ctx.auth.resolveForAuth(id)),
    validateBody(registerSchema),
    async (req, res, next) => {
      try {
        const result = await ctx.auth.register(req.body, req.auth ?? null);
        res.status(201).json(result);
      } catch (cause) {
        next(cause);
      }
    },
  );

  // TOTP passwordless login: username + 6-digit code
  router.post('/login', publicLimiter, validateBody(loginSchema), async (req, res, next) => {
    try {
      const { userId } = await ctx.totp.login(req.body.username, req.body.code);
      const { token, user } = await ctx.auth.loginWithTotp(userId);
      res.status(200).json({ token, user });
    } catch (cause) {
      next(cause);
    }
  });

  // Recovery code login
  router.post('/recovery/login', publicLimiter, validateBody(recoveryLoginSchema), async (req, res, next) => {
    try {
      const { userId } = await ctx.totp.recoveryLogin(req.body.username, req.body.recoveryCode);
      const { token, user } = await ctx.auth.loginWithTotp(userId);
      res.status(200).json({ token, user });
    } catch (cause) {
      next(cause);
    }
  });

  // SMS OTP - request a code (delivered in dev mode to the configured number)
  router.post('/otp/request', publicLimiter, validateBody(smsSendSchema), async (req, res, next) => {
    try {
      const result = await ctx.smsOtp.send(req.body.username);
      res.status(200).json(result);
    } catch (cause) {
      next(cause);
    }
  });

  // SMS OTP - verify a code and exchange for a session token
  router.post('/otp/verify', publicLimiter, validateBody(smsVerifySchema), async (req, res, next) => {
    try {
      const { userId } = await ctx.smsOtp.verify(req.body.username, req.body.code);
      const { token, user } = await ctx.auth.loginWithTotp(userId);
      res.status(200).json({ token, user });
    } catch (cause) {
      next(cause);
    }
  });

  // TOTP setup (requires auth)
  router.get('/totp/status', requireAuth(ctx.config.jwtSecret, (id) => ctx.auth.resolveForAuth(id)), async (req, res, next) => {
    try {
      res.status(200).json(ctx.totp.status(req.auth!));
    } catch (cause) {
      next(cause);
    }
  });

  router.post('/totp/setup', requireAuth(ctx.config.jwtSecret, (id) => ctx.auth.resolveForAuth(id)), totpLimiter, async (req, res, next) => {
    try {
      const result = await ctx.totp.setup(req.auth!);
      res.status(200).json(result);
    } catch (cause) {
      next(cause);
    }
  });

  // TOTP verify (requires auth)
  router.post('/totp/verify', requireAuth(ctx.config.jwtSecret, (id) => ctx.auth.resolveForAuth(id)), totpLimiter, validateBody(totpVerifySchema), async (req, res, next) => {
    try {
      const recoveryCodes = await ctx.totp.verify(req.auth!, req.body.code);
      res.status(200).json({ recoveryCodes });
    } catch (cause) {
      next(cause);
    }
  });

  // TOTP disable (requires auth + recovery code)
  router.delete('/totp', requireAuth(ctx.config.jwtSecret, (id) => ctx.auth.resolveForAuth(id)), totpLimiter, validateBody(totpDisableSchema), async (req, res, next) => {
    try {
      await ctx.totp.disable(req.auth!, req.body.recoveryCode);
      res.status(204).end();
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
