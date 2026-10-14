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
          <div class="sub">Employees self-register. ADMIN/MANAGER accounts are gated by existing administrators.</div>
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

  function showError(message) {
    const errBox = container.querySelector('#reg-err');
    errBox.textContent = message;
    errBox.classList.remove('hidden');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = container.querySelector('#reg-err');
    errBox.classList.add('hidden');

    const username = usernameField.value.trim();
    const displayName = container.querySelector('#reg-display').value.trim();
    const role = container.querySelector('#reg-role').value;

    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
      showError('Username must be 3–40 characters: letters, digits, dot, dash, underscore.');
      return;
    }
    if (!displayName) {
      showError('Display name is required.');
      return;
    }

    const btn = container.querySelector('#reg-btn');
    setBusy(btn, true, 'Creating…');
    try {
      const data = await api.post('/api/auth/register', { username, displayName, role });
      showRecoveryCodes(container, data);
    } catch (err) {
      showError(err.message || 'Registration failed.');
    } finally {
      setBusy(btn, false);
    }
  });
}

function showRecoveryCodes(container, data) {
  const codes = Array.isArray(data && data.recoveryCodes) ? data.recoveryCodes : null;
  const suffix = data && data.user && data.user.role ? ` (${escapeHtml(data.user.role)})` : '';
  render(container.querySelector('.auth-panel'), `
    <span class="auth-kicker">zero-trust · hrms</span>
    <h1>Account created${suffix}</h1>
    <div class="alert ok" role="status">These one-time recovery codes are the only way in until you enroll an authenticator. They will not be shown again.</div>
    <div class="recovery-codes" data-recover-codes>
      ${codes
        ? codes.map((c) => `<span class="mono">${escapeHtml(String(c))}</span>`).join('')
        : '<span class="muted">No recovery codes returned.</span>'}
    </div>
    <div class="sub">Write them down or store them in a password manager, then continue.</div>
    <div class="form-actions">
      <button class="btn" id="reg-saved" type="button">I've saved my codes</button>
    </div>
  `);
  container.querySelector('#reg-saved').addEventListener('click', () => {
    toast('Sign in with a recovery code, then enroll your authenticator.', 'info');
    navigate('login');
  });
}