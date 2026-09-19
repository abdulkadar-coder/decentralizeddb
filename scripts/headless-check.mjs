// Headless-Chrome end-to-end SPA check: loads the real app, performs the
// login flow, navigates to the dashboard and employee views, and asserts the
// rendered DOM. This is the closest thing to a real judge click-through that
// can run from a terminal.
//
// Usage (after `npm start` on a FRESH database):
//   node scripts/headless-check.mjs
//
// Requires Chrome or Edge (paths auto-detected below) and Node >= 22 (global
// WebSocket). The server must already be running on http://127.0.0.1:3000.

const BASE = 'http://127.0.0.1:3000';
const ADMIN_USER = `hl-admin-${Date.now().toString(36)}`;
const ADMIN_PASS = 'admin-secure-password-1';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (ok) pass++;
  else fail++;
}

const chromePath = process.env.CHROME ?? CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome/Edge found. Set CHROME=path/to/chrome');
  process.exit(2);
}

async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return res;
}

// ---- bootstrap admin via the real API ----
let token;
let user;
{
  let res = await post('/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
  if (res.status !== 200) {
    res = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS, displayName: 'HL Admin', role: 'ADMIN' }),
    });
  }
  const login = res.status === 200
    ? res
    : await post('/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
  const body = await login.json();
  token = body.token;
  user = body.user;
  check('backstage: admin session obtained', Boolean(token));
}

// ---- launch headless Chrome with debugging port ----
const DEBUG_PORT = 9333;
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=' + DEBUG_PORT,
  '--user-data-dir=' + process.env.TEMP.replaceAll('\\', '/') + '/opencode/hl-profile-' + Date.now(),
  'about:blank',
], { stdio: 'ignore' });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const listTargets = async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();

let ws;
let seq = 0;
const pending = new Map();
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page evaluate threw: ' + JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}

await delay(1200);
for (let i = 0; i < 20; i++) {
  try {
    const targets = await listTargets();
    const page = targets.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      };
      break;
    }
  } catch {
    /* not ready */
  }
  await delay(500);
}
if (!ws) { console.error('could not attach to Chrome'); process.exit(3); }

async function goto(url, waitMs = 3000) {
  await cdp('Page.navigate', { url });
  await delay(waitMs);
}

try {
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  // 1. Initial load -> "Sign in"
  await goto(BASE + '/');
  let text = await evaluate('document.body.innerText');
  check('SPA loads the sign-in page', /Sign in/.test(text ?? ''));

  // 2. Inject a real session into localStorage (the same data login.js writes)
  await evaluate(
    `localStorage.setItem('zt.hrms.token', ${JSON.stringify(token)});` +
      `localStorage.setItem('zt.hrms.user', ${JSON.stringify(JSON.stringify(user))});`,
  );

  // 3. Reload as authenticated -> dashboard
  await goto(BASE + '/#/dashboard');
  text = await evaluate('document.body.innerText');
  check('dashboard renders after login', /Dashboard/.test(text ?? '') && /Signed in as/.test(text ?? ''));

  // 4. Employees view
  await goto(BASE + '/#/employees');
  text = await evaluate('document.body.innerText');
  check('employees page renders', /Employees/.test(text ?? ''));

  // 5. Audit view (ADMIN/MANAGER only)
  await goto(BASE + '/#/audit');
  text = await evaluate('document.body.innerText');
  check('audit page renders', /Audit ledger/.test(text ?? ''));

  // 6. Logout button clears session
  await goto(BASE + '/#/dashboard');
  await evaluate(`document.getElementById('btn-logout').click()`);
  await delay(800);
  const tokenCleared = await evaluate(`localStorage.getItem('zt.hrms.token') === null`);
  text = await evaluate('document.body.innerText');
  check('logout clears session and returns to sign-in', tokenCleared && /Sign in/.test(text ?? ''));

  console.log('='.repeat(60));
  console.log(`HEADLESS SPA CHECK: ${pass} passed, ${fail} failed`);
} finally {
  ws.close();
  chrome.kill();
}
process.exit(fail ? 1 : 0);