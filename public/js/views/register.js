import { api } from '../api.js';
import { render, setBusy, toast, escapeHtml } from '../util.js';
import { navigate } from '../router.js';

const CHIPS = ['Least-privilege roles', 'Accounts link 1:1 to employees', 'Bootstrap-only ADMIN'];
const TAGLINE = 'Create <em>one</em> identity,<br/>grant nothing more.';

export async function mountRegister(container) {
  render(container, `
    <div class="auth-shell">
      <main class="auth-main">
        <div class="auth-panel">
          <span class="auth-kicker">zero-trust · hrms</span>
          <h1>Create account</h1>
          <div class="sub">Employees self-register. MANAGER accounts must be created by an administrator.</div>
          <div id="reg-err" class="alert error hidden"></div>
          <form id="reg-form">
            <div class="form-field">
              <label for="reg-username">Username</label>
              <input id="reg-username" name="username" required minlength="3" maxlength="40" autocomplete="username" />
              <div class="hint">Letters, digits, dot, dash or underscore (3–40 chars).</div>
            </div>
            <div class="form-field">
              <label for="reg-display">Display name</label>
              <input id="reg-display" name="displayName" required maxlength="80" />
            </div>
            <div class="form-field">
              <label for="reg-password">Password</label>
              <input id="reg-password" name="password" type="password" required autocomplete="new-password" />
              <div class="hint">At least 10 characters.</div>
            </div>
            <div class="form-field">
              <label for="reg-role">Role</label>
              <select id="reg-role" name="role">
                <option value="EMPLOYEE">Employee (self-service)</option>
                <option value="MANAGER">Manager (admin-gated)</option>
                <option value="ADMIN">Administrator (bootstrap only)</option>
              </select>
            </div>
            <div class="form-actions">
              <button class="btn" id="reg-btn" type="submit">Create account</button>
            </div>
          </form>
          <div class="auth-alt">Already registered? <a href="#/login">Sign in</a></div>
        </div>
      </main>
      <aside class="auth-hero">
        <i class="hero-blob hero-blob-1"></i><i class="hero-blob hero-blob-2"></i>
        <i class="hero-blob hero-blob-3"></i><i class="hero-blob hero-blob-4"></i>
        <div class="hero-top">
          <span class="z-logo" aria-hidden="true">Z</span>
          <span class="hero-wordmark"><strong>ZTHRMS</strong><small>zero-trust hrms</small></span>
          <span class="hero-pill">hash-linked · v0.1</span>
        </div>
        <div>
          <h2 class="hero-title">${TAGLINE}</h2>
          <p class="hero-sub">Role-aware, least-privilege registration. Your account stays locked until an administrator links it to an employee record.</p>
          <div class="hero-chips">${CHIPS.map((c) => `<span>${escapeHtml(c)}</span>`).join('')}</div>
        </div>
        <div class="hero-foot">phase 1 &amp; 2 · SQLite today · Fabric-ready</div>
      </aside>
    </div>
  `);

  const form = container.querySelector('#reg-form');
  const usernameField = container.querySelector('#reg-username');
  const passwordField = container.querySelector('#reg-password');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = container.querySelector('#reg-err');
    errBox.classList.add('hidden');

    const username = usernameField.value.trim();
    const displayName = container.querySelector('#reg-display').value.trim();
    const password = passwordField.value;
    const role = container.querySelector('#reg-role').value;

    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
      errBox.textContent = 'Username must be 3–40 characters: letters, digits, dot, dash, underscore.';
      errBox.classList.remove('hidden');
      return;
    }
    if (password.length < 10) {
      errBox.textContent = 'Password must be at least 10 characters.';
      errBox.classList.remove('hidden');
      return;
    }
    if (!displayName) {
      errBox.textContent = 'Display name is required.';
      errBox.classList.remove('hidden');
      return;
    }

    const btn = container.querySelector('#reg-btn');
    setBusy(btn, true, 'Creating…');
    try {
      await api.post('/api/auth/register', { username, displayName, password, role });
      toast('Account created. Sign in to continue.', 'ok');
      navigate('login');
    } catch (err) {
      errBox.textContent = err.message || 'Registration failed.';
      errBox.classList.remove('hidden');
    } finally {
      setBusy(btn, false);
    }
  });
}