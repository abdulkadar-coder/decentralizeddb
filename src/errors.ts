import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger.js';

export type HttpStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 413
  | 415
  | 422
  | 429
  | 500
  | 503;

export class AppError extends Error {
  readonly status: HttpStatus;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  badRequest: (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details),
  unprocessable: (message: string, details?: unknown) => new AppError(422, 'UNPROCESSABLE_ENTITY', message, details),
  unauthorized: (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'Insufficient permissions') => new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  payloadTooLarge: (message = 'Payload too large') => new AppError(413, 'PAYLOAD_TOO_LARGE', message),
  storage: (message = 'Object storage failure') => new AppError(503, 'STORAGE_FAILURE', message),
  ledger: (message = 'Fabric ledger failure') => new AppError(503, 'LEDGER_FAILURE', message),
  crypto: (message = 'Encryption failure') => new AppError(500, 'ENCRYPTION_FAILURE', message),
  tooMany: (message = 'Too many requests, try again later') => new AppError(429, 'TOO_MANY_REQUESTS', message),
};

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(errors.notFound('Route not found'));
}

const KNOWN_MONGOOSE_DUP = /duplicate/i;

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400) {
    status = 400;
    code = 'BAD_JSON';
    message = 'Malformed JSON body';
  } else if (err && typeof err === 'object' && 'code' in err) {
    const codeValue = String((err as { code: unknown }).code);
    if (codeValue === 'EBADLENGTH') {
      status = 500;
      code = 'INTEGRITY_FAILURE';
      message = 'Ciphertext length mismatch: object integrity cannot be verified';
    } else if (KNOWN_MONGOOSE_DUP.test(codeValue)) {
      status = 409;
      code = 'CONFLICT';
      message = 'Conflict with existing data';
    }
  }

  if (status >= 500) {
    logger.error('http', 'unhandled error', { code, message });
  }

  const body: Record<string, unknown> = {
    error: { code, message },
  };
  if (details !== undefined && process.env.SHOW_ERROR_DETAILS === 'true') {
    body.error = { ...(body.error as object), details };
  }
  res.status(status).json(body);
}