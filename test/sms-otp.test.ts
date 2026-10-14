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

describe('SMS OTP (dev mode) login', () => {
  it('bootstraps an admin to use for the flow', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'sms-admin', displayName: 'SMS Admin', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.recoveryCodes).toHaveLength(8);
  });

  it('requests a code and returns the masked destination (+ devCode in dev mode)', async () => {
    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ username: 'sms-admin' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ to: '******2770', expiresIn: 300 });
    expect(res.body.devCode).toMatch(/^\d{6}$/);
  });

  it('verifies the generated code and exchanges it for a session token', async () => {
    const sent = await request(app)
      .post('/api/auth/otp/request')
      .send({ username: 'sms-admin' });
    const login = await request(app)
      .post('/api/auth/otp/verify')
      .send({ username: 'sms-admin', code: sent.body.devCode });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    expect(login.body.user.username).toBe('sms-admin');
    expect(login.body.user.role).toBe('ADMIN');
  });

  it('is single-use: a consumed code cannot be reused', async () => {
    const sent = await request(app)
      .post('/api/auth/otp/request')
      .send({ username: 'sms-admin' });
    const first = await request(app)
      .post('/api/auth/otp/verify')
      .send({ username: 'sms-admin', code: sent.body.devCode });
    expect(first.status).toBe(200);
    const again = await request(app)
      .post('/api/auth/otp/verify')
      .send({ username: 'sms-admin', code: sent.body.devCode });
    expect(again.status).toBe(401);
  });

  it('rejects an unknown username with 401 and no devCode', async () => {
    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ username: 'nobody-knows-me' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid code with 401', async () => {
    const sent = await request(app)
      .post('/api/auth/otp/request')
      .send({ username: 'sms-admin' });
    expect(sent.status).toBe(200);
    const res = await request(app)
      .post('/api/auth/otp/verify')
      .send({ username: 'sms-admin', code: '000000' });
    expect(res.status).toBe(401);
  });

  it('requires a 6-digit numeric code (validation)', async () => {
    const res = await request(app)
      .post('/api/auth/otp/verify')
      .send({ username: 'sms-admin', code: '12' });
    expect(res.status).toBe(422);
  });

  it('records SMS auth events into the audit chain', async () => {
    const sent = await request(app)
      .post('/api/auth/otp/request')
      .send({ username: 'sms-admin' });
    expect(sent.status).toBe(200);
    await request(app)
      .post('/api/auth/otp/verify')
      .send({ username: 'sms-admin', code: '000000' })
      .expect(401);
    const ok = await request(app)
      .post('/api/auth/otp/verify')
      .send({ username: 'sms-admin', code: sent.body.devCode })
      .expect(200);

    const chain = await request(app)
      .get('/api/audit/chain')
      .set('Authorization', `Bearer ${ok.body.token}`)
      .expect(200);
    const types = chain.body.blocks.map((b: { type: string }) => b.type);
    expect(types).toContain('SMS_OTP_SENT');
    expect(types).toContain('SMS_LOGIN');
    expect(types).toContain('SMS_LOGIN_FAILED');
  });
});