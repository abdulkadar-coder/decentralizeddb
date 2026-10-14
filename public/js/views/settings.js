import { api } from '../api.js';
import { closeModal, escapeHtml, openModal, pageLoading, render, setBusy, toast, toastError } from '../util.js';

export async function mountSettings(container) {
  let enrolled = false;
  let loading = true;

  function renderPage(error = '') {
    if (loading) {
      pageLoading(container);
      return;
    }

    if (error) {
      render(container, `
        <section class="page settings-page">
          <header class="page-head">
            <div><h1>Settings</h1><p class="sub">Manage your account security.</p></div>
          </header>
          <section class="panel settings-card">
            <div class="settings-empty" role="alert">
              <span class="settings-icon" aria-hidden="true">!</span>
              <div><h2>Security settings unavailable</h2><p>${escapeHtml(error)}</p></div>
            </div>
            <div class="settings-actions"><button class="btn secondary" id="retry-status">Try again</button></div>
          </section>
        </section>
      `);
      container.querySelector('#retry-status').addEventListener('click', load);
      return;
    }

    render(container, `
      <section class="page settings-page">
        <header class="page-head">
          <div>
            <span class="settings-eyebrow">ACCOUNT PREFERENCES</span>
            <h1>Settings</h1>
            <p class="sub">Manage your sign-in security and recovery options.</p>
          </div>
        </header>

        <section class="panel settings-card" aria-labelledby="authenticator-title">
          <div class="settings-card-head">
            <span class="settings-icon" aria-hidden="true">2FA</span>
            <div class="settings-card-title">
              <div class="settings-title-row">
                <h2 id="authenticator-title">Authenticator app</h2>
                <span class="badge ${enrolled ? 'ok' : 'muted'}"><span class="status-dot"></span>${enrolled ? 'Enabled' : 'Not enabled'}</span>
              </div>
              <p>Use a time-based one-time password from an authenticator app to secure your account.</p>
            </div>
          </div>
          <div class="settings-divider"></div>
          ${enrolled ? `
            <div class="settings-detail">
              <div><strong>Two-step verification is active</strong><p>Your authenticator will be requested when you sign in.</p></div>
              <button class="btn danger" id="disable-btn">Disable authenticator</button>
            </div>
          ` : `
            <div class="settings-detail">
              <div><strong>Add another layer of protection</strong><p>Setup takes a few minutes. Keep your recovery codes somewhere safe.</p></div>
              <button class="btn" id="enroll-btn">Set up authenticator</button>
            </div>
          `}
        </section>
      </section>
    `);

    container.querySelector('#enroll-btn')?.addEventListener('click', enroll);
    container.querySelector('#disable-btn')?.addEventListener('click', disable);
  }

  async function load() {
    loading = true;
    renderPage();
    try {
      const status = await api.totpStatus();
      enrolled = Boolean(status.enabled);
      loading = false;
      renderPage();
    } catch (err) {
      loading = false;
      renderPage(err.message || 'Could not load your account security status.');
    }
  }

  async function enroll(event) {
    const button = event.currentTarget;
    setBusy(button, true, 'Preparing…');
    try {
      const setup = await api.totpSetup();
      setBusy(button, false);
      showSetup(setup);
    } catch (err) {
      setBusy(button, false);
      toastError(err, 'Could not start authenticator setup');
    }
  }

  function showSetup({ manualKey, otpauthUrl }) {
    openModal({
      title: 'Set up your authenticator',
      body: `
        <p class="modal-intro">Add this account in your authenticator app, then enter the current 6-digit code to finish setup.</p>
        <div class="setup-key-card">
          <div><span class="field-label">Setup key</span><code class="setup-key">${escapeHtml(manualKey)}</code></div>
          <button type="button" class="btn secondary" id="copy-setup-key">Copy key</button>
        </div>
        <p class="field-hint">In your app, choose <strong>Enter a setup key</strong>. Keep this key private.</p>
        <a class="setup-app-link" href="${escapeHtml(otpauthUrl)}">Open in an authenticator app</a>
        <form id="totp-verify-form" class="modal-form">
          <div class="form-field">
            <label for="totp-code">Verification code</label>
            <input id="totp-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" aria-describedby="totp-code-error" required />
            <span class="field-hint">Enter the 6-digit code shown in your app.</span>
            <span class="form-error" id="totp-code-error" role="alert"></span>
          </div>
        </form>
      `,
      actions: `
        <button class="btn secondary" type="button" data-setup-cancel>Cancel</button>
        <button class="btn" type="submit" form="totp-verify-form" id="verify-totp">Verify and enable</button>
      `,
    });

    const modal = document.getElementById('modal-host');
    const input = modal.querySelector('#totp-code');
    modal.querySelector('#copy-setup-key').addEventListener('click', () => copyText(manualKey, 'Setup key copied'));
    modal.querySelector('[data-setup-cancel]').addEventListener('click', closeModal);
    input.focus();
    modal.querySelector('#totp-verify-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = input.value.trim();
      const error = modal.querySelector('#totp-code-error');
      const submit = modal.querySelector('#verify-totp');
      error.textContent = '';
      if (!/^\d{6}$/.test(code)) {
        error.textContent = 'Enter all 6 digits to continue.';
        input.focus();
        return;
      }
      setBusy(submit, true, 'Verifying…');
      try {
        const { recoveryCodes } = await api.totpVerify(code);
        enrolled = true;
        closeModal();
        renderPage();
        showRecoveryCodes(recoveryCodes);
      } catch (err) {
        error.textContent = err.message || 'That code could not be verified. Try the latest code in your app.';
        setBusy(submit, false);
        input.select();
      }
    });
  }

  function showRecoveryCodes(codes) {
    const text = codes.join('\n');
    openModal({
      title: 'Save your recovery codes',
      body: `
        <div class="alert warn">These codes are shown once. Store them somewhere private so you can recover access if you lose your authenticator.</div>
        <div class="recovery-codes" aria-label="Recovery codes">${codes.map((code) => `<code class="mono">${escapeHtml(code)}</code>`).join('')}</div>
      `,
      actions: `
        <button class="btn secondary" type="button" id="copy-recovery-codes">Copy codes</button>
        <button class="btn" type="button" id="done-recovery-codes">Done</button>
      `,
    });
    document.getElementById('modal-host').querySelector('#copy-recovery-codes').addEventListener('click', () => copyText(text, 'Recovery codes copied'));
    document.getElementById('modal-host').querySelector('#done-recovery-codes').addEventListener('click', closeModal);
  }

  async function disable() {
    openModal({
      title: 'Disable authenticator',
      body: `
        <p class="modal-intro">Enter one unused recovery code to turn off two-step verification. This code will be consumed.</p>
        <form id="totp-disable-form" class="modal-form">
          <div class="form-field">
            <label for="recovery-code">Recovery code</label>
            <input id="recovery-code" name="recoveryCode" type="text" autocomplete="off" placeholder="Enter an unused recovery code" aria-describedby="recovery-code-error" required />
            <span class="form-error" id="recovery-code-error" role="alert"></span>
          </div>
        </form>
      `,
      actions: `
        <button class="btn secondary" type="button" data-disable-cancel>Cancel</button>
        <button class="btn danger" type="submit" form="totp-disable-form" id="confirm-disable">Disable</button>
      `,
    });
    const modal = document.getElementById('modal-host');
    const input = modal.querySelector('#recovery-code');
    modal.querySelector('[data-disable-cancel]').addEventListener('click', closeModal);
    input.focus();
    modal.querySelector('#totp-disable-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = modal.querySelector('#recovery-code-error');
      const submit = modal.querySelector('#confirm-disable');
      error.textContent = '';
      setBusy(submit, true, 'Disabling…');
      try {
        await api.totpDisable(input.value.trim());
        enrolled = false;
        closeModal();
        renderPage();
        toast('Authenticator disabled', 'ok');
      } catch (err) {
        error.textContent = err.message || 'Could not disable the authenticator. Check the recovery code and try again.';
        setBusy(submit, false);
        input.select();
      }
    });
  }

  async function copyText(value, successMessage) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable');
      await navigator.clipboard.writeText(value);
      toast(successMessage, 'ok');
    } catch {
      toast('Clipboard access is unavailable. Select and copy the text manually.', 'error');
    }
  }

  await load();
}
