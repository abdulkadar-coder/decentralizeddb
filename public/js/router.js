// Minimal hash router: #/dashboard, #/employees, #/employees/<id>, #/audit, ...
// Hash routing keeps every route a plain HTTP GET of the same document (works
// with the static SPA fallback and simple deployments).

export function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (!raw) return { path: '', params: [] };
  const [path] = raw.split('?');
  const params = path.split('/').filter(Boolean);
  return { path: params.join('/'), params };
}

export function currentPath() {
  return parseHash().path;
}

export function navigate(path) {
  window.location.hash = `#/${path}`;
}

export function link(path, label, extraClass = '') {
  return `<a href="#/${path}" class="${extraClass}" data-route="${escapeAttr(path)}">${escapeAttr(label)}</a>`;
}

function escapeAttr(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function onNavigate(handler) {
  window.addEventListener('hashchange', () => handler(parseHash()));
  window.addEventListener('load', () => handler(parseHash()));
}