import { api } from '../api.js';
import { render, pageLoading, escapeHtml, fmtDate } from '../util.js';
import { link } from '../router.js';

const CAPABILITIES = {
  ADMIN: ['Manage all employees and their documents', 'Upload / download / revoke any document', 'Change roles and link user accounts', 'Read the audit history and Fabric network status'],
  MANAGER: ['View and edit direct reports', 'Upload and download documents for your team', 'Read the audit history and Fabric network status'],
  EMPLOYEE: ['Manage your own record', 'Upload and download your own documents'],
};

const INTROS = {
  ADMIN: 'Full control: employees, documents, roles, and the audit ledger.',
  MANAGER: 'Team access: your own record and your direct reports.',
  EMPLOYEE: 'Self-service access to your own record and documents.',
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
  const name = session.user.displayName || session.user.username;

  const [health, chain, network, list] = await Promise.all([
    safe(() => api.get('/api/health')),
    role !== 'EMPLOYEE' ? safe(() => api.get('/api/audit/chain')) : Promise.resolve(null),
    role !== 'EMPLOYEE' ? safe(() => api.get('/api/audit/network')) : Promise.resolve(null),
    role === 'ADMIN' ? safe(() => api.get('/api/employees')) : Promise.resolve(null),
  ]);

  const employeeCount = list && Array.isArray(list.employees) ? list.employees.length : null;
  const serviceOk = !!health && health.status === 'ok';
  const chainOk = chain ? chain.valid : null;
  const fabricEnabled = !!(network && network.enabled);

  const stats = [];
  stats.push(`<div class="stat">
    <div class="stat-label">Role</div>
    <div class="stat-num">${escapeHtml(role)}</div>
    <div class="stat-sub">${CAPABILITIES[role] ? CAPABILITIES[role].length : 0} capabilities</div>
  </div>`);
  stats.push(`<div class="stat ${serviceOk ? 'tone-green' : 'tone-muted'}">
    <div class="stat-label">Service</div>
    <div class="stat-num ${serviceOk ? 'ok' : 'danger'}">${serviceOk ? 'OK' : 'DOWN'}</div>
    <div class="stat-sub">${health ? `${escapeHtml(String(health.db ?? ''))} · ${escapeHtml(String(health.storage ?? ''))}` : 'unavailable'}</div>
  </div>`);

  if (role === 'ADMIN') {
    stats.push(`<div class="stat tone-green">
      <div class="stat-label">Employees</div>
      <div class="stat-num">${employeeCount == null ? '—' : employeeCount}</div>
      <div class="stat-sub">in the directory</div>
    </div>`);
  }
  if (role !== 'EMPLOYEE') {
    stats.push(`<div class="stat ${chainOk === null ? 'tone-muted' : chainOk ? 'tone-green' : ''}">
      <div class="stat-label">Audit chain</div>
      <div class="stat-num ${chainOk === null ? 'muted' : chainOk ? 'ok' : 'danger'}">${chainOk === null ? '—' : chain.length}</div>
      <div class="stat-sub">${chainOk === null ? 'unavailable' : chainOk ? 'hash chain intact' : 'hash chain breached'}</div>
    </div>`);
    stats.push(`<div class="stat ${fabricEnabled ? 'tone-peri' : 'tone-muted'}">
      <div class="stat-label">Fabric ledger</div>
      <div class="stat-num sm ${fabricEnabled ? (network.connected ? 'ok' : 'danger') : 'muted'}">${fabricEnabled ? (network.connected ? 'UP' : 'DOWN') : 'OFF'}</div>
      <div class="stat-sub">${fabricEnabled ? `sequence ${network.seq}` : 'set LEDGER_BACKEND=fabric'}</div>
    </div>`);
  } else {
    stats.push(`<div class="stat ${session.user.employeeId ? 'tone-green' : 'tone-muted'}">
      <div class="stat-label">My record</div>
      <div class="stat-num sm ${session.user.employeeId ? 'ok' : 'muted'}">${session.user.employeeId ? 'LINKED' : '—'}</div>
      <div class="stat-sub">${session.user.employeeId ? 'ready to manage' : 'not linked yet'}</div>
    </div>`);
  }

  render(container, `
    <div class="page">
      <div class="band">
        <div class="band-inner">
          <span class="z-logo" aria-hidden="true">Z</span>
          <div class="band-copy">
            <span class="auth-kicker">zero-trust workspace</span>
            <h1>Good to see you, ${escapeHtml(name)}.</h1>
            <p class="band-sub">${INTROS[role]}</p>
          </div>
        </div>
        <div class="chip-row band-actions">
          ${session.user.employeeId ? link(`employees/${session.user.employeeId}`, 'My employee record', 'btn secondary small') : ''}
          ${link('employees', 'Employees', 'btn secondary small')}
          ${role !== 'EMPLOYEE' ? link('audit', 'Audit ledger', 'btn secondary small') : ''}
        </div>
      </div>

      <div class="grid stats">${stats.join('')}</div>

      <div class="grid cols-3">
        <div class="panel">
          <h2>What you can do</h2>
          <ul class="check-list">
            ${CAPABILITIES[role] ? CAPABILITIES[role].map((c) => `<li>${escapeHtml(c)}</li>`).join('') : '<li>No capabilities defined for this role.</li>'}
          </ul>
        </div>

        <div class="panel">
          <h2>Service health</h2>
          <div class="kv">
            <dt>Status</dt><dd>${serviceOk ? '<span class="badge ok">OK</span>' : '<span class="badge danger">degraded</span>'}</dd>
            <dt>Database</dt><dd>${health ? escapeHtml(String(health.db ?? '')) : 'unavailable'}</dd>
            <dt>Storage backend</dt><dd>${health ? escapeHtml(String(health.storage ?? '')) : 'unavailable'}</dd>
            <dt>Audit chain</dt><dd>${health && health.blockchain ? `<span class="small muted">${escapeHtml(String(health.blockchain.backend ?? ''))}</span>` : '—'}</dd>
          </div>
        </div>

        ${role === 'ADMIN'
          ? `<div class="panel">
              <h2>Employees</h2>
              <div class="stat-num">${employeeCount == null ? '—' : employeeCount}</div>
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