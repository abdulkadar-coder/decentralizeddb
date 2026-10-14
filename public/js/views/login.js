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
          <div id="login-mode-sub" class="sub">Enter your 6-digit authenticator code.</div>
          <div id="login-err" class="alert error hidden"></div>
          <div id="sms-status" class="alert ok hidden"></div>
          <form id="login-form">
            <div class="form-field">
              <label for="login-username">Username</label>
              <input id="login-username" name="username" required autocomplete="username" />
            </div>
            <div id="sms-send-field" class="form-field hidden">
              <button class="btn secondary" type="button" id="sms-send-btn">Send code</button>
            </div>
            <div class="form-field">
              <label for="login-code">Code</label>
              <input id="login-code" name="code" type="text" inputmode="numeric" maxlength="6" pattern="[0-9]*" required autocomplete="one-time-code" placeholder="000000" />
            </div>
            <div class="form-actions">
              <button class="btn" id="login-btn" type="submit">Sign in</button>
            </div>
          </form>
          <div class="auth-alt">
            <a href="#" id="mode-toggle">Use SMS code</a> — or —
            <a href="#" id="recovery-link">Use recovery code</a> — or —
            <a href="#/register">Create an account</a>
          </div>
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
        <div class="hero-foot">phase 1 & 2 · SQLite today · Fabric-ready</div>
      </aside>
    </div>
  `);

  const form = container.querySelector('#login-form');
  const codeInput = container.querySelector('#login-code');
  const modeToggle = container.querySelector('#mode-toggle');
  const recoveryLink = container.querySelector('#recovery-link');
  const errBox = container.querySelector('#login-err');
  const sub = container.querySelector('#login-mode-sub');
  const smsSendField = container.querySelector('#sms-send-field');
  const smsSendBtn = container.querySelector('#sms-send-btn');
  const smsStatus = container.querySelector('#sms-status');
  let mode = 'totp'; // 'totp' | 'sms' | 'recovery'
  let pendingSmsCode = false;

  function setCodeLabel(text) {
    codeInput.previousElementSibling.textContent = text;
  }

  function setMode(next) {
    mode = next;
    codeInput.value = '';
    errBox.classList.add('hidden');
    smsStatus.classList.add('hidden');
    smsSendField.classList.toggle('hidden', next !== 'sms');
    if (next === 'sms') {
      sub.textContent = 'We\u2019ll send a one-time code to your phone.';
      setCodeLabel('SMS Code');
      codeInput.placeholder = '000000';
      codeInput.maxLength = 6;
      codeInput.name = 'code';
      modeToggle.textContent = 'Use authenticator code';
    } else if (next === 'recovery') {
      sub.textContent = 'Enter one of your recovery codes.';
      setCodeLabel('Recovery Code');
      codeInput.maxLength = 10;
      codeInput.placeholder = 'ABCDEFGHIJ';
      codeInput.name = 'recoveryCode';
      modeToggle.textContent = 'Use SMS code';
    } else {
      sub.textContent = 'Enter your 6-digit authenticator code.';
      setCodeLabel('Authenticator Code');
      codeInput.maxLength = 6;
      codeInput.placeholder = '000000';
      codeInput.name = 'code';
      modeToggle.textContent = 'Use SMS code';
    }
    pendingSmsCode = false;
  }

  // Auto-submit on 6 digits (TOTP / SMS only)
  codeInput.addEventListener('input', () => {
    if ((mode === 'totp' || mode === 'sms') && codeInput.value.length === 6) {
      form.requestSubmit();
    }
  });

  // Toggle authenticator <-> SMS
  modeToggle.addEventListener('click', (e) => {
    e.preventDefault();
    setMode(mode === 'sms' ? 'totp' : 'sms');
  });

  // Toggle to recovery code
  recoveryLink.addEventListener('click', (e) => {
    e.preventDefault();
    setMode(mode === 'recovery' ? 'totp' : 'recovery');
  });

  // Send the SMS code (dev mode: shown on screen + server console)
  smsSendBtn.addEventListener('click', async () => {
    const username = container.querySelector('#login-username').value.trim();
    errBox.classList.add('hidden');
    smsStatus.classList.add('hidden');
    if (!username) {
      errBox.textContent = 'Enter your username first.';
      errBox.classList.remove('hidden');
      return;
    }
    setBusy(smsSendBtn, true, 'Sending…');
    try {
      const result = await api.smsRequest(username);
      pendingSmsCode = true;
      codeInput.focus();
      const devHint = result.devCode ? ` Dev mode code: ${result.devCode}.` : '';
      smsStatus.textContent = `Code sent to ${result.to}.${devHint}`;
      smsStatus.classList.remove('hidden');
    } catch (err) {
      errBox.textContent = err.message || 'Could not send code.';
      errBox.classList.remove('hidden');
    } finally {
      setBusy(smsSendBtn, false);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = container.querySelector('#login-username').value.trim();
    const code = codeInput.value.trim();
    const btn = container.querySelector('#login-btn');
    errBox.classList.add('hidden');

    if (!username || !code) {
      errBox.textContent = 'Username and code are required.';
      errBox.classList.remove('hidden');
      return;
    }

    if (mode === 'recovery') {
      setBusy(btn, true, 'Signing in…');
      try {
        const data = await api.recoveryLogin(username, code);
        setSession({ token: data.token, user: data.user });
        toast(`Welcome back, ${data.user.displayName || data.user.username}`, 'ok');
        navigate('dashboard');
      } catch (err) {
        errBox.textContent = err.message || 'Sign in failed.';
        errBox.classList.remove('hidden');
      } finally {
        setBusy(btn, false);
      }
      return;
    }

    if (mode === 'sms') {
      if (!pendingSmsCode) {
        errBox.textContent = 'Request a code first.';
        errBox.classList.remove('hidden');
        return;
      }
      setBusy(btn, true, 'Verifying…');
      try {
        const data = await api.smsLogin(username, code);
        setSession({ token: data.token, user: data.user });
        toast(`Welcome back, ${data.user.displayName || data.user.username}`, 'ok');
        navigate('dashboard');
      } catch (err) {
        errBox.textContent = err.message || 'Verification failed.';
        errBox.classList.remove('hidden');
      } finally {
        setBusy(btn, false);
      }
      return;
    }

    // default: authenticator code
    setBusy(btn, true, 'Signing in…');
    try {
      const data = await api.login(username, code);
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
