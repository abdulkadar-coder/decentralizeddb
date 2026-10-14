import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeTestContext } from './helpers.js';
import { openDatabase } from '../src/db/index.js';
import { DEMO_ACCOUNTS, seedDemoAccounts } from '../src/demo-accounts.js';

describe('local role demo accounts', () => {
  let db: ReturnType<typeof openDatabase> | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it('seeds all roles idempotently and links the sample employee to the manager', () => {
    db = openDatabase(':memory:');

    seedDemoAccounts(db);
    seedDemoAccounts(db);

    const users = db.prepare('SELECT username, role FROM users ORDER BY username').all();
    expect(users).toEqual([
      { username: 'demo.admin', role: 'ADMIN' },
      { username: 'demo.employee', role: 'EMPLOYEE' },
      { username: 'demo.manager', role: 'MANAGER' },
    ]);
    expect(DEMO_ACCOUNTS).toHaveLength(3);

    const relationship = db.prepare(
      `SELECT report.full_name AS employee, manager.full_name AS manager
       FROM employees report JOIN employees manager ON report.managed_by = manager.id
       WHERE report.user_id = (SELECT id FROM users WHERE username = 'demo.employee')`,
    ).get();
    expect(relationship).toEqual({ employee: 'Demo Employee', manager: 'Demo Manager' });
  });

  it('shows demo credentials and allows each role to sign in only when enabled', async () => {
    const context = await makeTestContext({
      demoAccountsEnabled: true,
      totp: {
        encryptionKey: Buffer.alloc(32, 4),
        issuer: 'TestApp',
        digits: 6,
        period: 30,
        window: 1,
        recoveryCount: 8,
        recoveryLen: 10,
        acceptAnyCode: true,
      },
    });
    try {
      const app = createApp(context.ctx);
      const credentials = await request(app).get('/api/auth/demo-accounts').expect(200);
      expect(credentials.body.accounts).toHaveLength(3);

      for (const account of DEMO_ACCOUNTS) {
        const login = await request(app)
          .post('/api/auth/login')
          .send({ username: account.username, code: '000000' })
          .expect(200);
        expect(login.body.user.role).toBe(account.role);
      }
    } finally {
      context.cleanup();
    }
  });

  it('hides demo credentials when disabled', async () => {
    const context = await makeTestContext();
    try {
      await request(createApp(context.ctx)).get('/api/auth/demo-accounts').expect(404);
      expect(context.ctx.db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
    } finally {
      context.cleanup();
    }
  });
});
