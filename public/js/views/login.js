import { api } from '../api.js';
import { setSession } from '../store.js';
import { render, setBusy, toast } from '../util.js';
import { navigate } from '../router.js';

export async function mountLogin(container) {
  render(container, `
    <div class="auth-wrap">
      <div class="auth-panel">
        <h1>Sign in</h1>
        <div class="sub">ZeroTrust HRMS — encrypted employee document management with a permissioned audit ledger.</div>
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