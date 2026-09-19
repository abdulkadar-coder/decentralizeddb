import { Router } from 'express';
import type { AppContext } from '../context.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { validateBody, validateParam } from '../middleware/validate.js';
import { employeeCreateSchema, employeeUpdateSchema, idSchema, roleChangeSchema } from '../validation.js';
import { toEmployeePublic } from '../modules/employees/service.js';

export function employeeRoutes(ctx: AppContext): Router {
  const router = Router();
  const auth = requireAuth(ctx.config.jwtSecret, (id) => ctx.auth.resolveForAuth(id));

  router.use(auth);

  router.post('/', validateBody(employeeCreateSchema), async (req, res, next) => {
    try {
      const employee = await ctx.employees.create(req.auth!, req.body);
      res.status(201).json({ employee: toEmployeePublic(employee) });
    } catch (cause) {
      next(cause);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const employees = await ctx.employees.list(req.auth!);
      res.status(200).json({ employees: employees.map(toEmployeePublic) });
    } catch (cause) {
      next(cause);
    }
  });

  router.get('/:id', validateParam(idSchema, 'id'), async (req, res, next) => {
    try {
      const employee = await ctx.employees.get(req.auth!, req.params.id!);
      res.status(200).json({ employee: toEmployeePublic(employee) });
    } catch (cause) {
      next(cause);
    }
  });

  router.patch('/:id', validateParam(idSchema, 'id'), validateBody(employeeUpdateSchema), async (req, res, next) => {
    try {
      const employee = await ctx.employees.update(req.auth!, req.params.id!, req.body);
      res.status(200).json({ employee: toEmployeePublic(employee) });
    } catch (cause) {
      next(cause);
    }
  });

  router.delete('/:id', validateParam(idSchema, 'id'), async (req, res, next) => {
    try {
      await ctx.employees.remove(req.auth!, req.params.id!);
      res.status(204).end();
    } catch (cause) {
      next(cause);
    }
  });

  router.post(
    '/:id/role',
    validateParam(idSchema, 'id'),
    requireRoles('ADMIN'),
    validateBody(roleChangeSchema),
    async (req, res, next) => {
      try {
        const employee = await ctx.employees.changeRole(req.auth!, req.params.id!, req.body.role);
        res.status(200).json({ employee: toEmployeePublic(employee) });
      } catch (cause) {
        next(cause);
      }
    },
  );

  return router;
}