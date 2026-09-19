// Shared DOM/formatting helpers. User-supplied text is ALWAYS escaped (XSS
// hardening) before being injected into innerHTML.

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function fragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}

// Render a view's html into a container, preserving any existing focus.
export function render(container, html) {
  container.replaceChildren(fragment(html));
  return container;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function maskId(id) {
  if (!id) return '—';
  if (id.length <= 20) return id;
  return `${id.slice(0, 12)}…${id.slice(-8)}`;
}

// ---------- toasts ----------
export function toast(message, type = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 0.3s';
    setTimeout(() => node.remove(), 300);
  }, 4200);
}

export function toastError(err, fallback = 'Operation failed') {
  const message = err && err.message ? err.message : fallback;
  toast(message, 'error');
}

// ---------- modal ----------
export function openModal({ title, body, actions }) {
  const host = document.getElementById('modal-host');
  host.classList.remove('hidden');
  host.replaceChildren(fragment(`
    <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="m-head">${escapeHtml(title)}</div>
      <div class="m-body">${body}</div>
      ${actions ? `<div class="m-foot">${actions}</div>` : ''}
    </div>
  `));
  return host.querySelector('.modal');
}

export function closeModal() {
  const host = document.getElementById('modal-host');
  host.classList.add('hidden');
  host.replaceChildren();
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    openModal({
      title: 'Are you sure?',
      body: `<p style="margin:0">${escapeHtml(message)}</p>`,
      actions: `
        <button class="btn secondary" data-confirm-cancel>Cancel</button>
        <button class="btn danger" data-confirm-ok>Confirm</button>
      `,
    });
    const modal = document.getElementById('modal-host');
    modal.querySelector('[data-confirm-ok]').addEventListener('click', () => {
      closeModal();
      resolve(true);
    });
    modal.querySelector('[data-confirm-cancel]').addEventListener('click', () => {
      closeModal();
      resolve(false);
    });
  });
}

// ---------- button loading state ----------
export function setBusy(button, busy, busyText = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.prevText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.prevText || button.textContent;
  }
}

// ---------- page loading indicator ----------
export function pageLoading(container) {
  render(container, `<div class="center muted" style="padding:48px"><span class="spinner"></span>&nbsp; Loading…</div>`);
}

export function emptyState(text, sub) {
  return `<div class="panel center muted" style="padding:28px"><div style="font-weight:600;font-size:15px">${escapeHtml(text)}</div>${sub ? `<div class="small mt">${escapeHtml(sub)}</div>` : ''}</div>`;
}

// ---------- access denied panel ----------
export function deniedPanel(message) {
  return `<div class="denied"><strong>Access denied.</strong> ${escapeHtml(message || 'You do not have permission to view this resource.')}</div>`;
}

// ---------- form field builder ----------
export function field(label, content, hint) {
  return `<div class="form-field"><label>${escapeHtml(label)}</label>${content}${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}</div>`;
}