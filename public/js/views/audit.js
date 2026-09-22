import { api } from '../api.js';
import { render, pageLoading, escapeHtml, fmtDate, emptyState } from '../util.js';
import { link } from '../router.js';

const RAIL_LIMIT = 12;

export async function mountAudit(container) {
  pageLoading(container);

  const res = await Promise.allSettled([
    api.get('/api/audit/network'),
    api.get('/api/audit/chain'),
    api.get('/api/audit/validate'),
  ]);
  const [network, chain, validation] = res.map((r) => (r.status === 'fulfilled' ? r.value : { error: r.reason }));

  const chainBlocks = chain && !chain.error && Array.isArray(chain.blocks) ? chain.blocks : [];
  const brokenHeights = validation && !validation.error && validation.validation && Array.isArray(validation.validation.issues)
    ? new Set(validation.validation.issues.map((i) => i.height))
    : new Set();

  render(container, `
    <div class="page">
      <div class="band">
        <div class="band-inner">
          <span class="z-logo" aria-hidden="true">Z</span>
          <div class="band-copy">
            <span class="auth-kicker">tamper-evident hash chain</span>
            <h1>Audit ledger</h1>
            <p class="band-sub">Every sensitive action is captured in a tamper-evident hash chain. The ledger records metadata only — never plaintext documents.</p>
          </div>
        </div>
        <div class="chip-row band-actions">
          <button class="btn secondary small" id="audit-refresh">↻ Refresh</button>
          ${link('', '← Dashboard', 'btn secondary small')}
        </div>
      </div>

      <div class="grid stats">
        <div class="stat ${chainStateTone(chain)}">
          <div class="stat-label">Chain integrity</div>
          <div class="stat-num ${chain && !chain.error ? (chain.valid ? 'ok' : 'danger') : 'muted'}">${chain && !chain.error ? (chain.valid ? 'INTACT' : 'BREACHED') : '—'}</div>
          <div class="stat-sub">${chain && !chain.error ? 're-hash of every block' : 'unavailable'}</div>
        </div>
        <div class="stat tone-green">
          <div class="stat-label">Blocks</div>
          <div class="stat-num">${chain && !chain.error ? chain.length : '—'}</div>
          <div class="stat-sub">in the local mirror</div>
        </div>
        <div class="stat ${fabricStateTone(network)}">
          <div class="stat-label">Fabric ledger</div>
          <div class="stat-num sm ${fabricStateLabel(network).cls}">${fabricStateLabel(network).text}</div>
          <div class="stat-sub">${fabricStateLabel(network).sub}</div>
        </div>
        <div class="stat ${validationStateTone(validation)}">
          <div class="stat-label">Validation</div>
          <div class="stat-num sm ${validationStateCls(validation)}">${validationStateText(validation)}</div>
          <div class="stat-sub">${validation && !validation.error ? `${validation.validation.length} blocks re-checked` : 'unavailable'}</div>
        </div>
      </div>

      <div class="panel">
        <h2>Hash chain</h2>
        ${renderRail(chainBlocks, brokenHeights, chain)}
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
        <h2>All blocks (latest first)</h2>
        ${renderChain(chain)}
      </div>
    </div>
  `);

  const refresh = container.querySelector('#audit-refresh');
  if (refresh) refresh.addEventListener('click', () => window.location.reload());
}

/* ---------- helpers ---------- */

function chainStateTone(chain) {
  if (!chain || chain.error) return 'tone-muted';
  return chain.valid ? 'tone-green' : '';
}
function fabricStateTone(net) {
  if (!net) return 'tone-muted';
  if (net.error) return 'tone-muted';
  return net.enabled ? 'tone-peri' : 'tone-muted';
}
function fabricStateLabel(net) {
  if (!net || net.error) return { text: '—', cls: 'muted', sub: 'unavailable' };
  if (!net.enabled) return { text: 'OFF', cls: 'muted', sub: 'set LEDGER_BACKEND=fabric' };
  if (net.connected) return { text: 'UP', cls: 'ok', sub: `sequence ${net.seq}` };
  return { text: 'DOWN', cls: 'danger', sub: net.error || 'no connection' };
}
function validationStateTone(v) {
  if (!v || v.error) return 'tone-muted';
  return v.validation.valid ? 'tone-green' : '';
}
function validationStateCls(v) {
  if (!v || v.error) return 'muted';
  return v.validation.valid ? 'ok' : 'danger';
}
function validationStateText(v) {
  if (!v || v.error) return '—';
  return v.validation.valid ? 'PASS' : 'FAIL';
}

function shortHash(value) {
  if (!value) return '—';
  return value;
}

function renderRail(blocks, brokenHeights, chain) {
  if (!chain || chain.error) return '<div class="muted small">unavailable</div>';
  if (!blocks.length) return emptyState('No audit events yet.');
  const ordered = [...blocks].slice(-RAIL_LIMIT).sort((a, b) => a.height - b.height);
  return `
    <div class="chain-rail">
      ${ordered.map((b, i) => {
        const broken = brokenHeights.has(b.height);
        const next = ordered[i + 1];
        const linkBroken = next ? brokenHeights.has(next.height) : false;
        return `
          <div class="link-card${broken ? ' broken' : ''}">
            <div class="link-seq">${b.height}</div>
            <div class="link-body">
              <div class="link-type">${escapeHtml(b.type)}</div>
              <div class="link-meta">
                <span class="link-actor">${escapeHtml(b.actorId ?? 'system')}</span>
                ${b.subjectId ? `<span class="link-arrow">→</span> <span class="link-actor">${escapeHtml(b.subjectId)}</span>` : ''}
                ${broken ? '<span class="badge danger">chain broken</span>' : ''}
              </div>
              <div class="link-time">${fmtDate(b.timestamp)}</div>
            </div>
            <div class="link-hash" title="block hash">${escapeHtml(shortHash(b.hash ?? ''))}</div>
          </div>
          ${i < ordered.length - 1 ? `
            <div class="link-conn${linkBroken ? ' broken' : ''}">
              <span class="link-node"></span>
              <span class="link-prev" title="next block prev-hash">${next ? escapeHtml(shortHash(next.prevHash ?? '')) : ''}</span>
            </div>` : ''}
        `;
      }).join('')}
    </div>
    ${ordered.length < blocks.length ? `<div class="muted small mt">Showing the latest ${ordered.length} of ${blocks.length} blocks (oldest ≤ height ${ordered[0].height}).</div>` : ''}
  `;
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