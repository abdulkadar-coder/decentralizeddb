import express from 'express';
import type { Express } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from './context.js';
import { PROJECT_ROOT } from './config.js';
import { healthRoutes } from './routes/health.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { employeeRoutes } from './routes/employees.routes.js';
import { documentRoutes } from './routes/documents.routes.js';
import { auditRoutes } from './routes/audit.routes.js';
import { userRoutes } from './routes/users.routes.js';
import { notFoundHandler, errorHandler } from './errors.js';

const PUBLIC_DIR = join(PROJECT_ROOT, 'public');
const INDEX_HTML = join(PUBLIC_DIR, 'index.html');
// The SPA is plain JS with no hashed filenames; cache long only in production
// so iterative dev/review always picks up changes immediately.
const STATIC_MAX_AGE = process.env.NODE_ENV === 'production' ? '1h' : '0';

function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  // Hardening headers for a browser-facing API + SPA (same origin, no CORS).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
}

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(express.json({ limit: '256kb' }));

  // Serve the single-page frontend from the same origin (no CORS required).
  // Registered FIRST so "/" lands on index.html rather than the API banner.
  // dotfiles are ignored; missing static files fall through to the SPA route.
  if (existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR, { index: 'index.html', dotfiles: 'ignore', maxAge: STATIC_MAX_AGE }));
    // SPA fallback: any non-API GET returns index.html (client-side hash routing
    // owns navigation). API paths fall through so their own 404 stays JSON.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(INDEX_HTML);
    });
  }

  app.get('/api', (_req, res) => {
    res.status(200).json({
      service: 'zerotrust-hrms',
      phase: '1-and-2',
      security: [
        'aes-256-gcm',
        'opaque-key-references',
        'aad-binding',
        'sha256-integrity',
        'fresh-identity-rbac',
        'permissioned-fabric-audit-ledger',
      ],
      endpoints: [
        '/api/health',
        '/api/auth/*',
        '/api/employees',
        '/api/employees/:id/documents',
        '/api/audit/*',
        '/api/users',
      ],
      ui: 'same-origin single-page app under /',
    });
  });

  app.use('/api', healthRoutes(ctx));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/employees', employeeRoutes(ctx));
  app.use('/api/employees', documentRoutes(ctx));
  app.use('/api/audit', auditRoutes(ctx));
  app.use('/api/users', userRoutes(ctx));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}