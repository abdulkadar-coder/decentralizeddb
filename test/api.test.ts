import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestContext } from './helpers.js';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';

interface Session {
  token: string;
  userId: string;
  role: string;
}

let ctx: AppContext;
let app: Express;
let workDir: string;
let cleanup: () => void;

const SECRET_DOC = Buffer.from('Wil exp 42 pass TRN-991 - strictly confidential');

beforeAll(async () => {
  const out = await makeTestContext();
  ctx = out.ctx;
  workDir = out.workDir;
  cleanup = out.cleanup;
  app = createApp(ctx);
});

afterAll(() => cleanup());

async function register(username: string, password: string, role?: string, adminToken?: string): Promise<Session> {
  const req = request(app)
    .post('/api/auth/register')
    .send({ username, password, displayName: username, role });
  if (adminToken) req.set('Authorization', `Bearer ${adminToken}`);
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const login = await request(app).post('/api/auth/login').send({ username, password }).expect(200) as {
    body: { token: string; user: { id: string; role: string } };
  };
  return { token: login.body.token, userId: login.body.user.id, role: login.body.user.role };
}

async function createEmployee(token: string, body: Record<string, string>) {
  const res = await request(app).post('/api/employees').set('Authorization', `Bearer ${token}`).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.employee as { id: string; userId: string | null; managedBy: string | null };
}

describe('Phase 1 API - full flow', () => {
  let admin: Session;
  let manager: Session;
  let emp1: Session;
  let emp2: Session;
  let managerEmp: { id: string };
  let emp1Emp: { id: string };
  let emp2Emp: { id: string };
  let doc1: { id: string };
  let doc2: { id: string };

  it('health endpoint reports db and storage status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok', storage: 'filesystem' });
  });

  it('bootstraps the first ADMIN without prior auth', async () => {
    admin = await register('root-admin', 'supersecure-password-1', 'ADMIN');
    expect(admin.role).toBe('ADMIN');
  });

  it('forbids a second ADMIN registration without an admin token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'rogue-admin', password: 'rogue-password-123', displayName: 'Rogue', role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  it('forbids self-service MANAGER registration without an admin token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'mgr-rogue', password: 'rogue-pass-12345', displayName: 'Rogue Mgr', role: 'MANAGER' });
    expect(res.status).toBe(403);
  });

  it('registers manager (admin-minted) and employees (self-service)', async () => {
    manager = await register('mgr-mgr', 'manager-password-1', 'MANAGER', admin.token);
    emp1 = await register('e1-e1', 'employee-password-1', 'EMPLOYEE');
    emp2 = await register('e2-e2', 'employee-password-2', 'EMPLOYEE');
    expect(manager.role).toBe('MANAGER');
  });

  it('rejects duplicate usernames', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'e1-e1', password: 'employee-password-1', displayName: 'Dup' })
      .expect(409);
  });

  it('rejects weak passwords at validation', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'weak', password: 'short', displayName: 'Weak' })
      .expect(422);
  });

  it('creates employee records with manager ownership (only ADMIN can create)', async () => {
    managerEmp = await createEmployee(admin.token, {
      fullName: 'Mgr Employee',
      department: 'Engineering',
      title: 'Team Lead',
      userId: manager.userId,
    });
    emp1Emp = await createEmployee(admin.token, {
      fullName: 'Alice',
      department: 'Engineering',
      title: 'Engineer',
      userId: emp1.userId,
      managedBy: managerEmp.id,
    });
    emp2Emp = await createEmployee(admin.token, {
      fullName: 'Bob',
      department: 'Sales',
      title: 'Sales Rep',
      userId: emp2.userId,
    });
    await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${emp1.token}`)
      .send({ fullName: 'Hax', department: 'x', title: 'y' })
      .expect(403);
  });

  it('enforces employee ownership for reads', async () => {
    await request(app).get(`/api/employees/${emp1Emp.id}`).set('Authorization', `Bearer ${emp1.token}`).expect(200);
    await request(app).get(`/api/employees/${emp1Emp.id}`).set('Authorization', `Bearer ${emp2.token}`).expect(403);
    await request(app).get(`/api/employees/${emp1Emp.id}`).set('Authorization', `Bearer ${manager.token}`).expect(200);
    await request(app).get(`/api/employees/${emp2Emp.id}`).set('Authorization', `Bearer ${manager.token}`).expect(403);
    await request(app).get(`/api/employees/${emp1Emp.id}`).set('Authorization', `Bearer ${admin.token}`).expect(200);
  });

  it('employee list is scoped by role', async () => {
    const asEmp1 = await request(app).get('/api/employees').set('Authorization', `Bearer ${emp1.token}`).expect(200);
    expect(asEmp1.body.employees).toHaveLength(1);
    const asManager = await request(app).get('/api/employees').set('Authorization', `Bearer ${manager.token}`).expect(200);
    expect(asManager.body.employees).toHaveLength(2); // self + direct report
    const asAdmin = await request(app).get('/api/employees').set('Authorization', `Bearer ${admin.token}`).expect(200);
    expect(asAdmin.body.employees).toHaveLength(3);
  });

  it('uploads encrypted documents when authorized (owner and manager) but denies unauthorized', async () => {
    const up1 = await request(app)
      .post(`/api/employees/${emp1Emp.id}/documents`)
      .set('Authorization', `Bearer ${emp1.token}`)
      .set('X-Filename', 'trn-991.pdf')
      .set('Content-Type', 'application/pdf')
      .send(SECRET_DOC);
    expect(up1.status, JSON.stringify(up1.body)).toBe(201);
    doc1 = up1.body.document as { id: string };

    const up2 = await request(app)
      .post(`/api/employees/${emp1Emp.id}/documents`)
      .set('Authorization', `Bearer ${manager.token}`)
      .set('X-Filename', 'review-notes.txt')
      .set('Content-Type', 'text/plain')
      .send(Buffer.from('manager note'));
    expect(up2.status, JSON.stringify(up2.body)).toBe(201);
    doc2 = up2.body.document as { id: string };

    await request(app)
      .post(`/api/employees/${emp1Emp.id}/documents`)
      .set('Authorization', `Bearer ${emp2.token}`)
      .set('X-Filename', 'stolen.pdf')
      .set('Content-Type', 'application/pdf')
      .send(SECRET_DOC)
      .expect(403);
  });

  it('ciphertext stored in object storage is not the plaintext and has integrity metadata', async () => {
    const files = readdirSync(join(workDir, 'objects', 'documents')).filter((f) => !f.endsWith('.meta.json'));
    expect(files.length).toBeGreaterThanOrEqual(2);
    const { readFileSync } = await import('node:fs');
    const blob = readFileSync(join(workDir, 'objects', 'documents', files[0]!));
    expect(blob.includes(SECRET_DOC)).toBe(false);
    expect(blob.length).toBeGreaterThanOrEqual(28); // 12-byte IV + ct + 16-byte tag
  });

  it('downloads the exact original bytes to the authorized owner', async () => {
    const res = await request(app)
      .get(`/api/employees/${emp1Emp.id}/documents/${doc1.id}`)
      .set('Authorization', `Bearer ${emp1.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SECRET_DOC);
  });

  it('downloads to manager and admin as authorized', async () => {
    const mgr = await request(app)
      .get(`/api/employees/${emp1Emp.id}/documents/${doc1.id}`)
      .set('Authorization', `Bearer ${manager.token}`);
    expect(mgr.status).toBe(200);
    expect(mgr.body).toEqual(SECRET_DOC);

    const ad = await request(app)
      .get(`/api/employees/${emp1Emp.id}/documents/${doc1.id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(ad.status).toBe(200);
    expect(ad.body).toEqual(SECRET_DOC);
  });

  it('rejects an unauthorized download attempt with 403', async () => {
    await request(app)
      .get(`/api/employees/${emp1Emp.id}/documents/${doc1.id}`)
      .set('Authorization', `Bearer ${emp2.token}`)
      .expect(403);
  });

  it('rejects document reads without authentication', async () => {
    await request(app).get(`/api/employees/${emp1Emp.id}/documents/${doc1.id}`).expect(401);
  });

  it('rejects wrong employee/document pairing with 404', async () => {
    await request(app)
      .get(`/api/employees/${emp2Emp.id}/documents/${doc1.id}`)
      .set('Authorization', `Bearer ${emp1.token}`)
      .expect(404);
  });

  it('reports missing document content from object storage', async () => {
    const { unlinkSync } = await import('node:fs');
    const objKey = (ctx.db.prepare('SELECT object_key FROM documents WHERE id = ?').get(doc2.id) as { object_key: string }).object_key;
    unlinkSync(join(workDir, 'objects', objKey));
    const res = await request(app)
      .get(`/api/employees/${emp1Emp.id}/documents/${doc2.id}`)
      .set('Authorization', `Bearer ${emp1.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('detects tampered ciphertext at rest (integrity/auth-tag rejection)', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const objKey = (ctx.db.prepare('SELECT object_key FROM documents WHERE id = ?').get(doc1.id) as { object_key: string }).object_key;
    const blobPath = join(workDir, 'objects', objKey);
    const blob = readFileSync(blobPath);
    const last = blob.length - 1;
    blob.writeUInt8(blob.readUInt8(last) ^ 0xff, last);
    writeFileSync(blobPath, blob);
    const res = await request(app)
      .get(`/api/employees/${emp1Emp.id}/documents/${doc1.id}`)
      .set('Authorization', `Bearer ${emp1.token}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('ENCRYPTION_FAILURE');
  });

  it('revocation: only owner or admin may revoke; afterwards content is gone', async () => {
    await request(app)
      .delete(`/api/employees/${emp1Emp.id}/documents/${doc1.id}`)
      .set('Authorization', `Bearer ${emp2.token}`)
      .expect(403);

    const revoke = await request(app)
      .delete(`/api/employees/${emp1Emp.id}/documents/${doc1.id}`)
      .set('Authorization', `Bearer ${emp1.token}`)
      .expect(200);
    expect(revoke.body.document.status).toBe('REVOKED');

    await request(app)
      .get(`/api/employees/${emp1Emp.id}/documents/${doc1.id}`)
      .set('Authorization', `Bearer ${emp1.token}`)
      .expect(404);
  });

  it('upload requires a valid X-Filename header', async () => {
    await request(app)
      .post(`/api/employees/${emp1Emp.id}/documents`)
      .set('Authorization', `Bearer ${emp1.token}`)
      .set('Content-Type', 'text/plain')
      .send(Buffer.from('no filename'))
      .expect(400);
  });

  it('role changes are restricted to administrators', async () => {
    await request(app)
      .post(`/api/employees/${emp2Emp.id}/role`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ role: 'MANAGER' })
      .expect(403);
    await request(app)
      .post(`/api/employees/${emp2Emp.id}/role`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'MANAGER' })
      .expect(200);
  });

  it('audit chain is readable and valid for admins/managers but forbidden to employees', async () => {
    const forbidden = await request(app).get('/api/audit/chain').set('Authorization', `Bearer ${emp1.token}`);
    expect(forbidden.status).toBe(403);

    const mgrChain = await request(app).get('/api/audit/chain').set('Authorization', `Bearer ${manager.token}`).expect(200);
    expect(mgrChain.body.valid).toBe(true);
    const types = mgrChain.body.blocks.map((b: { type: string }) => b.type);
    expect(types).toContain('EMPLOYEE_CREATED');
    expect(types).toContain('DOCUMENT_UPLOADED');
    expect(types).toContain('DOCUMENT_ACCESSED');
    expect(types).toContain('ACCESS_REVOKED');
    expect(types[0]).toBe('GENESIS');

    const validate = await request(app).get('/api/audit/validate').set('Authorization', `Bearer ${admin.token}`).expect(200);
    expect(validate.body.validation).toMatchObject({ valid: true });
  });

  it('login failures are recorded to the audit chain', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'e1-e1', password: 'definitely-wrong' })
      .expect(401);
    const chainRes = await request(app).get('/api/audit/chain').set('Authorization', `Bearer ${admin.token}`).expect(200);
    const types = chainRes.body.blocks.map((b: { type: string }) => b.type);
    expect(types).toContain('AUTH_LOGIN_FAILED');
  });

  it('input validation rejects malformed employee payloads', async () => {
    await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ fullName: '', department: '', title: '' })
      .expect(422);
    await request(app)
      .patch(`/api/employees/${emp1Emp.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({})
      .expect(422);
  });
});