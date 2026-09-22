// SPA bootstrap: renders the shell (topbar + nav), then hands routes to the
// matching view module. No inline event handlers anywhere (CSP-compliant).

import { getToken, getCachedUser, clearSession } from './store.js';
import { api } from './api.js';
import { render, escapeHtml, toast } from './util.js';
import { parseHash, navigate, currentPath } from './router.js';
import { mountLogin } from './views/login.js';
import { mountRegister } from './views/register.js';
import { mountDashboard } from './views/dashboard.js';
import { mountEmployees } from './views/employees.js';
import { mountEmployee } from './views/employee.js';
import { mountAudit } from './views/audit.js';
import { mountUsers } from './views/users.js';

const app = document.getElementById('app');
const topbar = document.getElementById('topbar');

function roleNav(user) {
  const items = [
    { path: 'dashboard', label: 'Dashboard' },
    { path: 'employees', label: 'Employees' },
  ];
  if (user && user.role !== 'EMPLOYEE') items.push({ path: 'audit', label: 'Audit' });
  if (user && user.role === 'ADMIN') items.push({ path: 'users', label: 'Users' });
  const current = currentPath();
  return items
    .map((it) => {
      const active = current === it.path || (it.path === 'employees' && current.startsWith('employees/'));
      return `<a class="nav-link${active ? ' active' : ''}" href="#/${it.path}">${escapeHtml(it.label)}</a>`;
    })
    .join('');
}

function renderShell(user) {
  if (!topbar) return;
  topbar.classList.remove('hidden');
  topbar.innerHTML = `
    <div class="bar-inner">
      <a class="brand" href="#/dashboard"><span class="z-logo z-logo-sm" aria-hidden="true">Z</span>ZTHRMS <span class="brand-sub">zero-trust hrms</span></a>
      <nav class="nav">${roleNav(user)}</nav>
      <div class="bar-right">
        <span class="who">${user ? escapeHtml(user.displayName || user.username) : ''}${user ? ` · ${escapeHtml(user.role)}` : ''}</span>
        <button class="btn secondary small" id="btn-logout">Log out</button>
      </div>
    </div>
  `;
  const logout = topbar.querySelector('#btn-logout');
  if (logout) logout.addEventListener('click', () => {
    clearSession();
    toast('Logged out.', 'info');
    navigate('login');
  });
}

async function boot() {
  let user = getCachedUser();
  const localToken = getToken();

  // Restore / validate the session against /me (fresh identity, not the JWT).
  if (localToken) {
    try {
      const data = await api.me();
      user = data.user;
    } catch {
      clearSession();
      user = null;
    }
  }

  if (user) {
    renderShell(user);
    const path = parseHash();
    const first = path.params[0] || 'dashboard';
    if (first === 'login' || first === 'register') {
      navigate('dashboard');
      return; // hashchange will re-dispatch
    }
  } else {
    renderShell(null);
  }

  route(parseHash());
}

async function route(hash) {
  const { path } = hash;
  const token = getToken();

  if (!token) {
    if (path === 'register') {
      renderShell(null);
      await mountRegister(app);
      return;
    }
    renderShell(null);
    await mountLogin(app);
    return;
  }

  const cached = getCachedUser();
  if (!cached) clearSession();
  else renderShell(cached);
  const session = cached ? { user: cached } : null;

  try {
    if (path === 'register') {
      navigate('dashboard');
      return;
    }
    switch (path) {
      case '':
      case 'dashboard':
        await mountDashboard(app, session);
        break;
      case 'employees':
        await mountEmployees(app, session);
        break;
      case 'employees/new':
        // "New employee" is a modal on the list page; redirect a deep link.
        navigate('employees');
        return;
      case 'audit':
        await mountAudit(app);
        break;
      case 'users':
        await mountUsers(app);
        break;
      default: {
        const m = /^employees\/([^/]+)$/.exec(path);
        if (m) {
          await mountEmployee(app, session, decodeURIComponent(m[1]));
        } else {
          render(app, `<div class="page"><div class="alert error">Unknown page.</div></div>`);
        }
      }
    }
  } catch (err) {
    if (err && err.status === 401) {
      clearSession();
      toast('Your session expired. Please sign in again.', 'error');
      navigate('login');
    } else {
      render(app, `<div class="page"><div class="alert error">${escapeHtml(err && err.message ? err.message : 'Unexpected error')}</div></div>`);
    }
  }
}

window.addEventListener('DOMContentLoaded', boot);
window.addEventListener('hashchange', () => route(parseHash()));