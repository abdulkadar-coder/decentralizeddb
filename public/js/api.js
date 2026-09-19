// Thin typed wrapper around fetch for the ZeroTrust HRMS API. All requests are
// same-origin (the SPA is served by the same Express app), so no CORS is
// involved. Never puts the bearer token in URLs.

import { getToken } from './store.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseError(res, fallback) {
  try {
    const body = await res.json();
    if (body && body.error && typeof body.error.message === 'string') {
      return new ApiError(res.status, body.error.code || 'INTERNAL_ERROR', body.error.message);
    }
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, 'INTERNAL_ERROR', fallback || `Request failed (HTTP ${res.status})`);
}

function headersFor(extra = {}) {
  const headers = new Headers(extra);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

async function raw(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) throw await parseError(res);
  return res;
}

async function body(path, options = {}) {
  const res = await raw(path, options);
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get(path) {
    return body(path, { method: 'GET', headers: headersFor() });
  },

  post(path, data, extra = {}) {
    const headers = headersFor(extra.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return body(path, { method: 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data) });
  },

  patch(path, data) {
    const headers = headersFor();
    headers.set('Content-Type', 'application/json');
    return body(path, { method: 'PATCH', headers, body: JSON.stringify(data) });
  },

  del(path) {
    const headers = headersFor();
    return body(path, { method: 'DELETE', headers });
  },

  // Upload raw file bytes (the API contract is NOT multipart: body is the file,
  // the filename travels in the X-Filename header).
  uploadFile(path, file) {
    const headers = headersFor();
    headers.set('X-Filename', file.name);
    if (file.type) headers.set('Content-Type', file.type);
    return body(path, { method: 'POST', headers, body: file });
  },

  // Download decrypted bytes (authorized only). Returns a Blob; the caller
  // drives the save with its own filename from document metadata.
  async download(path) {
    const res = await raw(path, { method: 'GET', headers: headersFor() });
    return res.blob();
  },

  // ---- auth helpers ----
  async login(username, password) {
    const token = getToken();
    const headers = new Headers(token ? { Authorization: `Bearer ${token}` } : {});
    headers.set('Content-Type', 'application/json');
    return body('/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ username, password }) });
  },

  async me() {
    return body('/api/auth/me', { method: 'GET', headers: headersFor() });
  },
};