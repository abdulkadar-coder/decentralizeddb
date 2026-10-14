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

async function register(username: string, displayName: string, role?: string, adminToken?: string) {
  const req = request(app).post('/api/auth/register').send({ username, displayName, role });
  if (adminToken) req.set('Authorization', `Bearer ${adminToken}`);
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { user: { id: string; role: string }; recoveryCodes: string[] };
}

async function recoveryLogin(username: string, recoveryCode: string) {
  const res = await request(app).post('/api/auth/recovery/login').send({ username, recoveryCode });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.token as string;
}

describe('Employees directory (accounts + roles + proofs)', () => {
  let adminToken: string;
  let empToken: string;

  it('bootstraps an admin', async () => {
    const reg = await register('dir-admin', 'Dir Admin', 'ADMIN');
    adminToken = await recoveryLogin('dir-admin', reg.recoveryCodes[0]!);
  });

  it('registers an employee account', async () => {
    const reg = await register('dir-emp', 'Dir Employee');
    empToken = await recoveryLogin('dir-emp', reg.recoveryCodes[0]!);
  });

  it('lists accounts with roles and proof counts for an admin', async () => {
    const res = await request(app)
      .get('/api/employees/directory')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const accounts = res.body.accounts as Array<{ username: string; role: string; proofCount: number }>;
    const admin = accounts.find((a) => a.username === 'dir-admin');
    const emp = accounts.find((a) => a.username === 'dir-emp');
    expect(admin?.role).toBe('ADMIN');
    expect(emp?.role).toBe('EMPLOYEE');
    // The admin authored account-creation + login proofs.
    expect(admin!.proofCount).toBeGreaterThan(0);
    expect(typeof emp!.proofCount).toBe('number');
  });

  it('scopes the directory for a non-admin to their own account', async () => {
    const res = await request(app)
      .get('/api/employees/directory')
      .set('Authorization', `Bearer ${empToken}`)
      .expect(200);
    const usernames = (res.body.accounts as Array<{ username: string }>).map((a) => a.username);
    expect(usernames).toContain('dir-emp');
    expect(usernames).not.toContain('dir-admin');
  });

  it('requires authentication', async () => {
    await request(app).get('/api/employees/directory').expect(401);
  });
});