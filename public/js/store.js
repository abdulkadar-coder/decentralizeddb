// Session storage for the SPA. Tokens are kept in localStorage for persistence
// across refreshes. NOTE: token-in-localStorage is XSS-exposed; a hardened
// deployment should move to SameSite httpOnly cookies with a CSRF defense once
// refresh tokens are introduced (see SECURITY.md - future enhancements).
const TOKEN_KEY = 'zt.hrms.token';
const USER_KEY = 'zt.hrms.user';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getCachedUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(session) {
  try {
    localStorage.setItem(TOKEN_KEY, session.token);
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  } catch {
    /* private-mode browsers: keep session in memory only */
  }
}

export function refreshCachedUser(user) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}