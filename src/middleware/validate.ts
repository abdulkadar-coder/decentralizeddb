import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { errors } from '../errors.js';

/** Validate `req.body` against a zod schema -> 422 on mismatch with safe details. */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(
        errors.unprocessable(
          'Request body failed validation',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
      return;
    }
    req.body = parsed.data;
    next();
  };
}

/** Validate a path parameter (e.g. the `:id`) against a zod schema. */
export function validateParam(schema: ZodTypeAny, name: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.params[name]);
    if (!parsed.success) {
      next(errors.badRequest(`Invalid ${name}`));
      return;
    }
    next();
  };
}