import { api } from '../api.js';
import { render, pageLoading, escapeHtml, fmtDate, emptyState } from '../util.js';
import { link } from '../router.js';

export async function mountAudit(container) {
  pageLoading(container);

  const res = await Promise.allSettled([
    api.get('/api/audit/network'),
    api.get('/api/audit/chain'),
    api.get('/api/audit/validate'),
  ]);
  const [network, chain, validation] = res.map((r) => (r.status === 'fulfilled' ? r.value : { error: r.reason }));

  render(container, `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>Audit ledger</h1>
          <div class="sub">Every sensitive action is captured in a tamper-evident hash chain. The ledger records metadata only — never plaintext documents.</div>
        </div>
        <div class="chip-row">${link('', '← Dashboard', 'btn secondary small')}</div>
      </div>

      <div class="grid cols-2">
        <div class="panel">
          <h2>Fabric permissioned ledger</h2>
          ${renderNetwork(network)}
        </div>
        <div class="panel">
          <h2>Chain integrity</h2>
          ${renderValidation(validation)}
        </div>
      </div>

      <div class="panel">
        <h2>Hash chain (latest first)</h2>
        ${renderChain(chain)}
      </div>
    </div>
  `);
}

function renderNetwork(net) {
  if (!net) return '<div class="muted small">No data</div>';
  if (net.error) return `<div class="alert error">${escapeHtml(net.error.message || 'Network query failed')}</div>`;
  if (!net.enabled) {
    return `<div class="muted small">${escapeHtml(net.message || 'Fabric ledger is disabled.')}</div>
      <div class="proto-note">Enable by running the backend with <code>LEDGER_BACKEND=fabric</code> and the Fabric network up.</div>`;
  }
  const conn = net.connected
    ? `<span class="badge ok">connected</span>`
    : `<span class="badge danger">disconnected</span> ${net.error ? `<span class="small muted">${escapeHtml(net.error)}</span>` : ''}`;
  const records = Array.isArray(net.records) ? net.records : [];
  return `
    <div class="kv">
      <dt>Enabled</dt><dd><span class="badge ok">yes</span></dd>
      <dt>Connection</dt><dd>${conn}</dd>
      <dt>Last sequence</dt><dd>${net.seq ?? '—'}</dd>
      <dt>Hash chain</dt><dd>${net.valid ? '<span class="badge ok">intact</span>' : '<span class="badge danger">breached</span>'}</dd>
    </div>
    ${records.length
      ? `<table class="tbl">
          <thead><tr><th>Seq</th><th>Event</th><th>Actor</th><th>Subject</th><th>MSP</th><th>Time</th></tr></thead>
          <tbody>
            ${records.slice().reverse().map((r) => `
              <tr>
                <td>${r.seq}</td>
                <td class="mono">${escapeHtml(r.eventType)}</td>
                <td class="mono small">${escapeHtml(r.actorId ?? '—')}</td>
                <td class="mono small">${escapeHtml(r.subjectId ?? '—')}</td>
                <td>${escapeHtml(r.creatorMsp)}</td>
                <td class="small muted">${fmtDate(r.timestamp)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`
      : '<div class="muted small">No committed records yet.</div>'}
    <div class="proto-note">In this demo the Fabric network commits only <code>AUTH_LOGIN</code>, <code>DOCUMENT_UPLOAD</code>, <code>DOCUMENT_DATA_ACCESS</code>, <code>DOCUMENT_REVOKE</code> and <code>EMPLOYEE_DELETE</code> events.</div>
  `;
}

function renderValidation(validation) {
  if (!validation) return '<div class="muted small">No data</div>';
  if (validation.error) return `<div class="alert error">${escapeHtml(validation.error.message || 'Validation failed')}</div>`;
  return `
    <div class="kv">
      <dt>Result</dt><dd>${validation.validation.valid ? '<span class="badge ok">intact</span>' : '<span class="badge danger">breached</span>'}</dd>
      <dt>Blocks checked</dt><dd>${validation.validation.length}</dd>
    </div>
    ${validation.validation.issues && validation.validation.issues.length
      ? `<div class="alert error small">
           ${validation.validation.issues.map((i) => `height ${i.height}: ${escapeHtml(i.reason)}`).join('; ')}
         </div>`
      : `<div class="proto-note">All ${validation.validation.length} blocks re-hashed and linked correctly. Tampering with any stored event breaks this check.</div>`}
    ${validation.blocks && validation.blocks.length
      ? `<div class="small muted" style="margin-top:8px">${validation.blocks.length} blocks in the local mirror — see hash chain below.</div>`
      : ''}
  `;
}

function renderChain(chain) {
  if (!chain) return '<div class="muted small">No data</div>';
  if (chain.error) return `<div class="alert error">${escapeHtml(chain.error.message || 'Chain query failed')}</div>`;
  const blocks = Array.isArray(chain.blocks) ? chain.blocks : [];
  if (!blocks.length) return emptyState('No audit events yet.');
  return `
    <div class="kv">
      <dt>Length</dt><dd>${chain.length}</dd>
      <dt>Integrity</dt><dd>${chain.valid ? '<span class="badge ok">valid</span>' : '<span class="badge danger">invalid</span>'}</dd>
      <dt>Prototype</dt><dd class="small">${escapeHtml(chain.prototype)}</dd>
    </div>
    <table class="tbl">
      <thead><tr><th>#</th><th>Time</th><th>Type</th><th>Actor</th><th>Subject</th><th>Payload</th><th>Hash</th></tr></thead>
      <tbody>
        ${blocks.slice().reverse().map((b) => `
          <tr>
            <td>${b.height}</td>
            <td class="small muted">${fmtDate(b.timestamp)}</td>
            <td class="mono">${escapeHtml(b.type)}</td>
            <td class="mono small">${escapeHtml(b.actorId ?? '—')}</td>
            <td class="mono small">${escapeHtml(b.subjectId ?? '—')}</td>
            <td class="small">${escapeHtml(shortPayload(b.payload))}</td>
            <td class="mono small">${escapeHtml(b.hash ?? '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function shortPayload(p) {
  if (p == null) return '—';
  if (typeof p === 'string') return p.length > 60 ? `${p.slice(0, 60)}…` : p;
  try {
    const s = JSON.stringify(p);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  } catch {
    return String(p);
  }
}