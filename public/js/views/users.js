import { api } from '../api.js';
import { render, pageLoading, escapeHtml, fmtDate, toast, deniedPanel, emptyState } from '../util.js';

export async function mountUsers(container) {
  pageLoading(container);
  let data;
  try {
    data = await api.get('/api/users');
  } catch (err) {
    render(
      container,
      `<div class="page">${err && err.status === 403 ? deniedPanel(err.message) : `<div class="alert error">${escapeHtml(err.message || 'Could not load users')}</div>`}</div>`,
    );
    return;
  }
  const users = Array.isArray(data.users) ? data.users : [];

  render(container, `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>User accounts</h1>
          <div class="sub">Accounts · ${users.length} shown</div>
        </div>
      </div>

      ${users.length === 0
        ? emptyState('No user accounts found.', 'Register an account to begin.')
        : `<div class="panel" style="padding:8px 12px">
            <table class="tbl">
              <thead><tr><th>Account</th><th>Role</th><th>User UUID</th><th>Linked employee</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>
                ${users.map((u) => `
                  <tr>
                    <td><strong>${escapeHtml(u.username)}</strong>${u.displayName && u.displayName !== u.username ? `<div class="small muted">${escapeHtml(u.displayName)}</div>` : ''}</td>
                    <td><span class="badge ${u.role === 'ADMIN' ? 'warn' : u.role === 'MANAGER' ? 'ok' : 'muted'}">${escapeHtml(u.role)}</span></td>
                    <td><span class="mono">${escapeHtml(u.id)}</span> <button class="btn secondary small" data-copy="${escapeHtml(u.id)}">Copy</button></td>
                    <td>${u.employeeId ? escapeHtml(u.employeeName || u.employeeId) : '<span class="muted">—</span>'}</td>
                    <td>${u.isActive ? '<span class="badge ok">active</span>' : '<span class="badge danger">inactive</span>'}</td>
                    <td class="small muted">${fmtDate(u.createdAt)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
    </div>
  `);

  container.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-copy');
      navigator.clipboard
        .writeText(id || '')
        .then(() => toast('UUID copied to clipboard.', 'ok'))
        .catch(() => toast('Could not access the clipboard.', 'warn'));
    });
  });
}