import { api } from '../api.js';
import { setSession } from '../store.js';
import { render, setBusy, toast, escapeHtml } from '../util.js';
import { navigate } from '../router.js';

const CHIPS = ['AES-256-GCM documents', 'Hash-linked audit chain', 'Role-aware access'];
const TAGLINE = 'Employee records, <em>chained</em> forever.';

export async function mountLogin(container) {
  render(container, `
    <div class="auth-shell">
      <main class="auth-main">
        <div class="auth-panel">
          <span class="auth-kicker">zero-trust · hrms</span>
          <h1>Sign in</h1>
          <div class="sub">Continue to your workspace.</div>
          <div id="login-err" class="alert error hidden"></div>
          <form id="login-form">
            <div class="form-field">
              <label for="login-username">Username</label>
              <input id="login-username" name="username" required autocomplete="username" />
            </div>
            <div class="form-field">
              <label for="login-password">Password</label>
              <input id="login-password" name="password" type="password" required autocomplete="current-password" />
            </div>
            <div class="form-actions">
              <button class="btn" id="login-btn" type="submit">Sign in</button>
            </div>
          </form>
          <div class="auth-alt">New here? <a href="#/register">Create an account</a> — employees can self-register.</div>
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
          <p class="hero-sub">Encrypted HR documents with a permissioned audit chain — every event bound to its context and provable end-to-end.</p>
          <div class="hero-chips">${CHIPS.map((c) => `<span>${escapeHtml(c)}</span>`).join('')}</div>
        </div>
        <div class="hero-foot">phase 1 &amp; 2 · SQLite today · Fabric-ready</div>
      </aside>
    </div>
  `);

  container.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = container.querySelector('#login-username').value.trim();
    const password = container.querySelector('#login-password').value;
    const btn = container.querySelector('#login-btn');
    const errBox = container.querySelector('#login-err');
    errBox.classList.add('hidden');

    if (!username || !password) {
      errBox.textContent = 'Username and password are required.';
      errBox.classList.remove('hidden');
      return;
    }

    setBusy(btn, true, 'Signing in…');
    try {
      const data = await api.login(username, password);
      setSession({ token: data.token, user: data.user });
      toast(`Welcome back, ${data.user.displayName || data.user.username}`, 'ok');
      navigate('dashboard');
    } catch (err) {
      errBox.textContent = err.message || 'Sign in failed.';
      errBox.classList.remove('hidden');
    } finally {
      setBusy(btn, false);
    }
  });
}