import { Router } from 'express';
import type { AppContext } from '../context.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { toUserAdminView } from '../modules/users/service.js';

export function userRoutes(ctx: AppContext): Router {
  const router = Router();
  const auth = requireAuth(ctx.config.jwtSecret, (id) => ctx.auth.resolveForAuth(id));

  router.use(auth, requireRoles('ADMIN'));

  router.get('/', async (req, res, next) => {
    try {
      const rows = ctx.users.listForAdmin(req.auth!);
      res.status(200).json({ users: rows.map(toUserAdminView) });
    } catch (cause) {
      next(cause);
    }
  });

  return router;
}