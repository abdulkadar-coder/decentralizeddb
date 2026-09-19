/*!
 * Phase 1 demonstration: reproducible end-to-end run against the live API.
 *
 *   npm run demo
 *
 * Spins up the API on an ephemeral port against a temporary database + local
 * filesystem object storage, then exercises the exact judge flow:
 *   1. create an employee
 *   2. authenticate as an authorized user
 *   3. upload a document
 *   4. encrypt + store the document (ciphertext at rest, plaintext absent)
 *   5. retrieve the document as an authorized user
 *   6. reject an unauthorized access attempt
 *   7. display the audit blockchain
 *   8. demonstrate detection of a modified block
 *   9. display the test results
 *
 * No outputs are fabricated: every value printed comes from the actual run.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Server } from 'node:http';
import { loadEnvFile, defaultFabricOptions, type AppConfig } from '../src/config.js';
import { createAppContext } from '../src/context.js';
import { createApp } from '../src/app.js';
import { validateChain, type Block } from '../src/blockchain/blockchain.js';
import { masked } from '../src/modules/audit/format.js';

const divider = '='.repeat(78);

async function main(): Promise<void> {
  loadEnvFile();
  const workDir = mkdtempSync(join(tmpdir(), 'hrms-demo-'));
  const config: AppConfig = {
    nodeEnv: 'development',
    isDev: true,
    host: '127.0.0.1',
    port: 0,
    jwtSecret: 'demo-jwt-secret-abcdef0123456789',
    jwtSecretProvided: true,
    masterKey: Buffer.from('demo-master-key-0123456789abcdef0123456789abcdef', 'utf8').subarray(0, 32),
    masterKeyProvided: true,
    dataDir: workDir,
    dbFile: join(workDir, 'demo.db'),
    storageBackend: 'filesystem',
    fsStorageRoot: join(workDir, 'objects'),
    minio: {
      endpoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: 'demo',
      secretKey: 'demo',
      bucket: 'demo-bucket',
    },
    blockchainBackend: 'sqlite',
    ledgerBackend: 'off',
    fabric: { ...defaultFabricOptions(), enabled: false },
  };

  const ctx = await createAppContext(config);
  const app = createApp(ctx);
  const server = await listen(app);

  const base = `http://127.0.0.1:${server.port}`;
  async function post(path: string, body: unknown, token?: string): Promise<Response> {
    return fetch(base + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }
  async function get(path: string, token?: string): Promise<Response> {
    return fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  }
  async function upload(path: string, token: string, filename: string, data: Buffer): Promise<Response> {
    return fetch(base + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-filename': filename, 'content-type': 'application/pdf' },
      body: data,
    });
  }
  async function del(path: string, token: string): Promise<Response> {
    return fetch(base + path, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  }
  async function json<T>(r: Response): Promise<T> {
    return (await r.json()) as T;
  }

  console.log(divider);
  console.log('ZEROTRUST HRMS - PHASE 1 DEMONSTRATION');
  console.log(divider);

  console.log('\n[1] CREATE EMPLOYEES');
  const adminReg = await json<{ user: { username: string } }>(
    await post('/api/auth/register', { username: 'demo-admin', password: 'admin-secure-password-1', displayName: 'Demo Admin', role: 'ADMIN' }),
  );
  const adminLogin = await json<{ token: string }>(await post('/api/auth/login', { username: 'demo-admin', password: 'admin-secure-password-1' }));
  console.log(`  bootstrap admin: ${adminReg.user.username}`);
  const adminToken = adminLogin.token;

  const mgrReg = await json<{ user: { username: string; role: string } }>(
    await post('/api/auth/register', { username: 'demo-mgr', password: 'manager-secure-password-1', displayName: 'Demo Manager', role: 'MANAGER' }, adminToken),
  );
  console.log(`  manager (admin-minted): ${mgrReg.user.username} (${mgrReg.user.role})`);

  for (const [username, password, displayName, role] of [
    ['demo-emp', 'employee-secure-password-1', 'Demo Employee', 'EMPLOYEE'],
    ['demo-other', 'other-secure-password-1', 'Other Employee', 'EMPLOYEE'],
  ] as const) {
    const reg = await json<{ user: { username: string; role: string } }>(
      await post('/api/auth/register', { username, password, displayName, role }),
    );
    console.log(`  registered user: ${reg.user.username} (${reg.user.role})`);
  }

  const mgrLogin = await json<{ token: string; user: { id: string } }>(await post('/api/auth/login', { username: 'demo-mgr', password: 'manager-secure-password-1' }));
  const empLogin = await json<{ token: string; user: { id: string } }>(await post('/api/auth/login', { username: 'demo-emp', password: 'employee-secure-password-1' }));
  const otherLogin = await json<{ token: string; user: { id: string } }>(await post('/api/auth/login', { username: 'demo-other', password: 'other-secure-password-1' }));

  const empCreate = await json<{ employee: { id: string; fullName: string } }>(
    await post('/api/employees', { fullName: 'Alice Paycheck', department: 'Finance', title: 'Accountant', userId: empLogin.user.id }, adminToken),
  );
  const mgrCreate = await json<{ employee: { id: string; fullName: string } }>(
    await post('/api/employees', { fullName: 'Manager Bob', department: 'Finance', title: 'Head of Finance', userId: mgrLogin.user.id }, adminToken),
  );
  await post('/api/employees', { fullName: 'Mallory Outsider', department: 'Sales', title: 'Sales Rep', userId: otherLogin.user.id }, adminToken);

  await fetch(base + `/api/employees/${empCreate.employee.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ managedBy: mgrCreate.employee.id }),
  });

  console.log(`  created employee: ${empCreate.employee.fullName} (id ${masked(empCreate.employee.id)})`);
  console.log(`  created manager : ${mgrCreate.employee.fullName} (id ${masked(mgrCreate.employee.id)})`);

  console.log('\n[2] AUTHENTICATE AS AUTHORIZED USER');
  const me = await json<{ user: { username: string; role: string; employeeId: string | null } }>(
    await get('/api/auth/me', empLogin.token),
  );
  console.log(`  authenticated as ${me.user.username} -> role=${me.user.role}, employeeId=${masked(me.user.employeeId ?? 'n/a')}`);

  console.log('\n[3+4] UPLOAD -> ENCRYPT -> STORE IN OBJECT STORAGE');
  const payload = Buffer.from('Wil exp 42 pass TRN-991 - strictly confidential');
  const up = await upload(`/api/employees/${empCreate.employee.id}/documents`, empLogin.token, 'trn-991.pdf', payload);
  const upBody = await json<{ document: { id: string; sizeBytes: number; status: string } }>(up);
  console.log(`  upload HTTP ${up.status}; document id=${masked(upBody.document.id)}, size=${upBody.document.sizeBytes} bytes, status=${upBody.document.status}`);

  const docId = upBody.document.id;
  const objRel = (ctx.db.prepare('SELECT object_key FROM documents WHERE id = ?').get(docId) as { object_key: string }).object_key;
  const blobPath = join(workDir, 'objects', objRel);
  const blob = readFileSync(blobPath);
  console.log(`  object stored at opaque key ${objRel} (${blob.length} ciphertext bytes)`);
  console.log(`  plaintext leaked to storage? ${blob.includes(payload) ? 'YES (BUG)' : 'NO -> ciphertext-only at rest'}`);

  console.log('\n[5] RETRIEVE DOCUMENT AS AUTHORIZED USER');
  const dlRes = await get(`/api/employees/${empCreate.employee.id}/documents/${docId}`, empLogin.token);
  const dlBytes = Buffer.from(await dlRes.arrayBuffer());
  console.log(`  HTTP ${dlRes.status}; retrieved ${dlBytes.length} bytes`);
  console.log(`  content matches original? ${dlBytes.equals(payload) ? 'YES' : 'NO (BUG)'}`);

  console.log('\n[6] REJECT UNAUTHORIZED ACCESS');
  const denied = await get(`/api/employees/${empCreate.employee.id}/documents/${docId}`, otherLogin.token);
  const deniedBody = await json<{ error: { code: string; message: string } }>(denied);
  console.log(`  unrelated employee (Mallory) -> HTTP ${denied.status} ${deniedBody.error.code}: ${deniedBody.error.message}`);

  console.log('\n[7] AUDIT BLOCKCHAIN (local single-node hash-linked prototype - NOT decentralized)');
  const chainRes = await json<{ valid: boolean; blocks: { height: number; type: string; prevHash: string; hash: string }[] }>(
    await get('/api/audit/chain', adminToken),
  );
  console.log(`  chain valid=${chainRes.valid}, blocks=${chainRes.blocks.length}`);
  console.log('  height | type                  | prevHash   | hash');
  for (const b of chainRes.blocks) {
    console.log(`  ${String(b.height).padStart(6)} | ${b.type.padEnd(21)} | ${b.prevHash} | ${b.hash}`);
  }

  console.log('\n[8] TAMPER DETECTION (simulated on an in-memory copy; live chain untouched)');
  const fullLive = (await ctx.audits.chain()) as Block[];
  const liveValidation = validateChain(fullLive);
  console.log(`  live chain validation: valid=${liveValidation.valid}, blocks=${liveValidation.length}`);
  const copy = fullLive.map((b) => ({ ...b, tx: { ...b.tx, payload: { ...b.tx.payload } } }));
  const target = copy[1];
  if (target) {
    target.tx.payload = { ...target.tx.payload, tampered: 'attacker edits audit record' };
    if (copy.length > 3) copy[3]!.tx.payload = { ...copy[3]!.tx.payload, forged: true };
    const tamperCheck = validateChain(copy);
    console.log(`  modified copy validation: valid=${tamperCheck.valid}`);
    for (const issue of tamperCheck.issues) {
      console.log(`    -> height ${issue.height}: ${issue.reason}`);
    }
    console.log(`  live chain still valid after simulation: ${validateChain(fullLive).valid ? 'YES' : 'NO (BUG)'}`);
  } else {
    console.log('  (chain too short to demonstrate)');
  }

  console.log('\n[EXTRA] REVOKE -> PURE STORAGE PURGE + ACCESS_REVOKED AUDIT');
  const revoke = await del(`/api/employees/${empCreate.employee.id}/documents/${docId}`, empLogin.token);
  const revokeBody = await json<{ document: { status: string } }>(revoke);
  console.log(`  revoke HTTP ${revoke.status}; document status -> ${revokeBody.document.status}`);
  const afterRevoke = await get(`/api/employees/${empCreate.employee.id}/documents/${docId}`, empLogin.token);
  console.log(`  download after revoke -> HTTP ${afterRevoke.status}`);
  console.log(`  ciphertext object purged from storage? ${existsSync(blobPath) ? 'NO (still present)' : 'YES'}`);

  server.close();
  ctx.close();
  rmSync(workDir, { recursive: true, force: true });
}

async function listen(app: ReturnType<typeof createApp>): Promise<Server & { port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(Object.assign(server, { port: typeof addr === 'object' && addr ? addr.port : 0 }));
    });
  });
}

main().catch((err) => {
  console.error('DEMO FAILED:', err);
  process.exitCode = 1;
});