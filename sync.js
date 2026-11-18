/* ============================================================================
   Cloud — sign in with email + password, and keep one copy of your data in
   your own Firebase project (Firestore document  users/<your id>).

   Plain web requests to Firebase's public API; no library to load.
   Errors carry a .code:  'wrong' | 'too-many' | 'setup' | 'offline' |
                          'signed-out' | 'error'
   ============================================================================ */

const Cloud = (function () {
  'use strict';

  const cfg = typeof CLOUD_CONFIG === 'object' && CLOUD_CONFIG ? CLOUD_CONFIG : {};
  const enabled = !!(cfg.apiKey && cfg.projectId);
  const AUTH_KEY = 'sva.auth';
  const key = encodeURIComponent(cfg.apiKey || '');

  let auth = null;              // { uid, email, refreshToken } — kept so you stay signed in
  let token = null;             // short-lived access token, memory only
  let tokenUntil = 0;

  try {
    auth = JSON.parse(localStorage.getItem(AUTH_KEY));
    if (!auth || !auth.uid || !auth.refreshToken) auth = null;
  } catch (e) { auth = null; }

  function fail(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
  }

  function remember() {
    try {
      if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) { /* storage blocked: you will just have to sign in again next time */ }
  }

  async function call(url, opts) {
    let res;
    try { res = await fetch(url, opts); }
    catch (e) { throw fail('offline'); }
    let body = null;
    try { body = await res.json(); } catch (e) { /* empty or not JSON */ }
    return { res, body };
  }

  function setToken(value, seconds) {
    token = value;
    tokenUntil = Date.now() + (parseInt(seconds, 10) || 3600) * 1000 - 60000;
  }

  async function signIn(email, password) {
    const { res, body } = await call('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    if (!res.ok || !body) {
      const m = (body && body.error && body.error.message) || '';
      if (/API key|CONFIGURATION_NOT_FOUND|OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/i.test(m)) throw fail('setup', m);
      if (/TOO_MANY/.test(m)) throw fail('too-many', m);
      if (res.status === 400) throw fail('wrong', m);
      throw fail('error', m);
    }
    auth = { uid: body.localId, email: body.email, refreshToken: body.refreshToken };
    setToken(body.idToken, body.expiresIn);
    remember();
  }

  function signOut() {
    auth = null;
    token = null;
    remember();
  }

  async function idToken() {
    if (!auth) throw fail('signed-out');
    if (token && Date.now() < tokenUntil) return token;
    const { res, body } = await call('https://securetoken.googleapis.com/v1/token?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(auth.refreshToken),
    });
    if (!res.ok || !body) {
      // 400 = the session was ended (password changed, account removed…)
      if (res.status === 400) { signOut(); throw fail('signed-out'); }
      throw fail('error');
    }
    setToken(body.id_token, body.expires_in);
    if (body.refresh_token && auth) { auth.refreshToken = body.refresh_token; remember(); }
    return token;
  }

  function docUrl() {
    return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(cfg.projectId) +
      '/databases/(default)/documents/users/' + encodeURIComponent(auth.uid);
  }

  function check(res) {
    if (res.ok) return;
    if (res.status === 401) { token = null; throw fail('error'); }
    if (res.status === 403) throw fail('setup');          // database rules not in place
    throw fail('error', 'HTTP ' + res.status);
  }

  /* Your saved data, or null when nothing has been saved yet. */
  async function pull() {
    const t = await idToken();
    const { res, body } = await call(docUrl(), { headers: { Authorization: 'Bearer ' + t } });
    if (res.status === 404) return null;
    check(res);
    try {
      const data = JSON.parse(body.fields.data.stringValue);
      return data && typeof data === 'object' ? data : null;
    } catch (e) { return null; }
  }

  async function push(data) {
    const t = await idToken();
    const payload = JSON.stringify({
      fields: {
        data: { stringValue: JSON.stringify(data) },
        updated: { integerValue: String(data.updated || 0) },
      },
    });
    const { res } = await call(docUrl(), {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: payload,
      keepalive: payload.length < 60000,     // lets a save finish while the tab is closing
    });
    check(res);
  }

  return { enabled, user: () => auth, signIn, signOut, pull, push };
})();
