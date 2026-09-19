import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { makeTestContext } from './helpers.js';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';

let ctx: AppContext;
let app: Express;
let cleanup: () => void;

beforeAll(async () => {
  const out = await makeTestContext();
  ctx = out.ctx;
  cleanup = out.cleanup;
  app = createApp(ctx);
});

afterAll(() => cleanup());

describe('Phase 3 frontend delivery', () => {
  it('serves the SPA shell at /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('ZeroTrust HRMS');
    expect(res.text).toContain('/js/main.js');
  });

  it('serves the entry module, router, api wrapper and views as static JS', async () => {
    for (const asset of [
      '/js/main.js',
      '/js/api.js',
      '/js/router.js',
      '/js/store.js',
      '/js/util.js',
      '/js/views/login.js',
      '/js/views/register.js',
      '/js/views/dashboard.js',
      '/js/views/employees.js',
      '/js/views/employee.js',
      '/js/views/audit.js',
      '/css/app.css',
    ]) {
      const res = await request(app).get(asset);
      expect(res.status, `asset ${asset}`).toBe(200);
    }
  });

  it('falls back to index.html for client-side (hash) routes', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('ZeroTrust HRMS');
  });

  it('keeps unknown /api routes as JSON 404 (no SPA fallback)', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('never exposes the project .env file through the static SPA', async () => {
    const res = await request(app).get('/.env');
    expect([200, 404]).toContain(res.status);
    expect(res.text).not.toContain('JWT_SECRET=');
    expect(res.text).not.toContain('MASTER_KEY=');
    expect(res.text).not.toContain('dev-only-jwt-secret');
  });

  it('sets hardening security headers on HTML responses', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('GET /api exposes the capability manifest', async () => {
    const res = await request(app).get('/api');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('zerotrust-hrms');
    expect(res.body.endpoints).toContain('/api/health');
  });
});