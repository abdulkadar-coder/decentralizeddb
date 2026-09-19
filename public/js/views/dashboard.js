import { api } from '../api.js';
import { render, pageLoading, escapeHtml, fmtDate } from '../util.js';
import { link } from '../router.js';

const CAPABILITIES = {
  ADMIN: ['Manage all employees and their documents', 'Upload / download / revoke any document', 'Change roles and link user accounts', 'Read the audit history and Fabric network status'],
  MANAGER: ['View and edit direct reports', 'Upload and download documents for your team', 'Read the audit history and Fabric network status'],
  EMPLOYEE: ['Manage your own record', 'Upload and download your own documents'],
};

async function safe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function mountDashboard(container, session) {
  pageLoading(container);
  const role = session.user.role;

  const [health, chain, network, list] = await Promise.all([
    safe(() => api.get('/api/health')),
    role !== 'EMPLOYEE' ? safe(() => api.get('/api/audit/chain')) : Promise.resolve(null),
    role !== 'EMPLOYEE' ? safe(() => api.get('/api/audit/network')) : Promise.resolve(null),
    role === 'ADMIN' ? safe(() => api.get('/api/employees')) : Promise.resolve(null),
  ]);

  const employeeCount = list && Array.isArray(list.employees) ? list.employees.length : null;

  render(container, `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>Dashboard</h1>
          <div class="sub">Signed in as ${escapeHtml(session.user.displayName || session.user.username)} · ${role}</div>
        </div>
        <div class="chip-row">
          ${session.user.employeeId ? link(`employees/${session.user.employeeId}`, 'My employee record', 'btn secondary small') : ''}
          ${link('employees', 'Employees', 'btn secondary small')}
          ${role !== 'EMPLOYEE' ? link('audit', 'Audit ledger', 'btn secondary small') : ''}
        </div>
      </div>

      <div class="grid cols-3">
        <div class="panel">
          <h2>Your role</h2>
          <ul style="margin:0;padding-left:18px">
            ${CAPABILITIES[role] ? CAPABILITIES[role].map((c) => `<li>${escapeHtml(c)}</li>`).join('') : ''}
          </ul>
        </div>

        <div class="panel">
          <h2>Service health</h2>
          <div class="kv">
            <dt>Status</dt><dd>${health && health.status === 'ok' ? '<span class="badge ok">OK</span>' : '<span class="badge danger">degraded</span>'}</dd>
            <dt>Database</dt><dd>${health ? escapeHtml(health.db) : 'unavailable'}</dd>
            <dt>Storage backend</dt><dd>${health ? escapeHtml(String(health.storage ?? '')) : 'unavailable'}</dd>
            <dt>Audit chain</dt><dd>${health && health.blockchain ? `<span class="small muted">${escapeHtml(health.blockchain.backend ?? '')}</span>` : '—'}</dd>
          </div>
        </div>

        ${role === 'ADMIN'
          ? `<div class="panel">
              <h2>Employees</h2>
              <div style="font-size:34px;font-weight:700">${employeeCount == null ? '—' : employeeCount}</div>
              <div class="muted small">visible to ADMIN</div>
              <div class="mt">${link('employees', 'Open employee directory')}</div>
            </div>`
          : `<div class="panel">
              <h2>My scope</h2>
              <div class="muted small">${role === 'MANAGER' ? 'You can view and manage your own record and your direct reports (managed_by = your employee id).' : 'You can view and manage your own record.'}</div>
              ${session.user.employeeId ? `<div class="mt">${link(`employees/${session.user.employeeId}`, 'Open my record')}</div>` : '<div class="mt"><span class="badge muted">No employee record linked yet</span></div>'}
            </div>`}

        ${role !== 'EMPLOYEE'
          ? `<div class="panel">
              <h2>Audit chain (local mirror)</h2>
              ${chain ? `
                <div class="kv">
                  <dt>Length</dt><dd>${chain.length}</dd>
                  <dt>Valid</dt><dd>${chain.valid ? '<span class="badge ok">intact</span>' : '<span class="badge danger">breached</span>'}</dd>
                </div>` : '<div class="muted small">unavailable</div>'}
              <div class="mt">${link('audit', 'Open audit history')}</div>
            </div>`
          : ''}

        ${role !== 'EMPLOYEE'
          ? `<div class="panel">
              <h2>Fabric permissioned ledger</h2>
              ${network ? `
                ${network.enabled
                  ? `<div class="kv">
                      <dt>Enabled</dt><dd><span class="badge ok">yes</span></dd>
                      <dt>Connected</dt><dd>${network.connected ? '<span class="badge ok">yes</span>' : '<span class="badge danger">no</span>'}</dd>
                      <dt>Sequence</dt><dd>${network.seq}</dd>
                      <dt>Hash chain</dt><dd>${network.valid ? '<span class="badge ok">intact</span>' : '<span class="badge danger">breached</span>'}</dd>
                    </div>`
                  : '<span class="badge muted">disabled</span> <span class="small muted">(set LEDGER_BACKEND=fabric)</span>'}
              ` : '<div class="muted small">unavailable</div>'}
              <div class="mt">${link('audit', 'Open ledger status')}</div>
            </div>`
          : ''}
      </div>

      ${health ? `<div class="panel small muted">Last health check: ${fmtDate(health.timestamp)}</div>` : ''}
    </div>
  `);
}