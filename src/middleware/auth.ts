import type { NextFunction, Request, Response } from 'express';
import { verifyToken, type Role } from '../auth/tokens.js';
import type { Actor } from '../authorization.js';
import { errors } from '../errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: Actor;
    }
  }
}

function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export interface ResolvedIdentity {
  role: Role;
  employeeId: string | null;
  isActive: number;
}

/**
 * Require a valid bearer token. When `fetchUser` is provided the identity is
 * re-resolved against the database on every request so role changes and
 * user->employee links take effect immediately instead of waiting for token
 * expiry (fresh-identity RBAC).
 */
export function requireAuth(secret: string, fetchUser?: (userId: string) => ResolvedIdentity | null) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = parseBearer(req.header('authorization'));
    if (!token) {
      next(errors.unauthorized('Missing bearer token'));
      return;
    }
    const claims = verifyToken(secret, token);
    if (!claims) {
      next(errors.unauthorized('Invalid or expired token'));
      return;
    }
    let identity: ResolvedIdentity = {
      role: claims.role,
      employeeId: claims.employeeId ?? null,
      isActive: 1,
    };
    if (fetchUser) {
      const fresh = fetchUser(claims.sub);
      if (!fresh) {
        next(errors.unauthorized('Account no longer exists'));
        return;
      }
      identity = fresh;
      if (fresh.isActive !== 1) {
        next(errors.unauthorized('Account is inactive'));
        return;
      }
    }
    req.auth = {
      userId: claims.sub,
      username: claims.username,
      role: identity.role,
      employeeId: identity.employeeId,
    };
    next();
  };
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(errors.unauthorized('Authentication required'));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(errors.forbidden(`This operation requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}

/** Attach `req.auth` from claims without rejecting (for optional-auth routes). */
export function optionalAuth(secret: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = parseBearer(req.header('authorization'));
    if (token) {
      const claims = verifyToken(secret, token);
      if (claims) {
        req.auth = {
          userId: claims.sub,
          username: claims.username,
          role: claims.role,
          employeeId: claims.employeeId ?? null,
        };
      }
    }
    next();
  };
}