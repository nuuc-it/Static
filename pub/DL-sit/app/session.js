// app/session.js — Google sign-in, assertion cache, principal. Shape per DESIGN.md
// (app/session.js contract) and the proven pattern in
// ../GActionSheet/static-portal/src/index.html (ADR-0003 assertion caching), which this
// module follows rather than re-deriving (this project's CLAUDE.md "reuse, do not
// re-derive"): Google Identity Services hands us an ID token, NUUC-Dispatch exchanges it for
// a signed assertion scoped to `aud: "ndocs"`, and that assertion — never the Google
// credential — is what is cached and what every backend call carries.
//
// NDocs never verifies a Google ID token (Stage 4's "Must not"; the ID token is read here
// only to hand straight to NUUC-Dispatch). The assertion's own `exp` is the session lifetime;
// there is no refresh token.
//
// resume() is synchronous against localStorage and never awaits Google, so first paint can
// show identity before any network call resolves.
var NDocsSession = (function () {
  'use strict';

  var AUTH_STORAGE_KEY = 'ndocs.auth';
  // Treat an assertion as expired five minutes early so a call is never issued against one
  // that expires mid-flight (GActionSheet's AUTH_RENEW_SKEW_SECONDS, same value, same reason).
  var RENEW_SKEW_SECONDS = 300;

  var state = {
    assertion: null,
    email: '',
    sub: '',
    principal: null // set by whoami: { email, sub, isAdmin, teams: [{teamId, name, folders}] }
  };

  /** Payload half of a JWT-compatible assertion; null if it does not parse. Never verifies — verification is the backend's job (src/Gate.js). */
  function decodePayload(jwt) {
    try {
      var seg = String(jwt).split('.')[1];
      return JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (e) {
      return null;
    }
  }

  function save() {
    var payload = decodePayload(state.assertion);
    if (!payload || typeof payload.exp !== 'number') return;
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
        assertion: state.assertion, exp: payload.exp, sub: state.sub, email: state.email
      }));
    } catch (e) { /* private mode / quota — the session still works, it just will not resume */ }
  }

  /** True when a cached, unexpired assertion was restored. Synchronous; touches no network. */
  function resume() {
    var cached;
    try { cached = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null'); }
    catch (e) { cached = null; }
    if (!cached || !cached.assertion) return false;
    if (typeof cached.exp === 'number' &&
        Math.floor(Date.now() / 1000) >= cached.exp - RENEW_SKEW_SECONDS) {
      signOut();
      return false;
    }
    state.assertion = cached.assertion;
    state.email = cached.email || '';
    state.sub = cached.sub || '';
    return true;
  }

  /**
   * Exchange a Google Identity Services credential (an ID token) at NUUC-Dispatch for a
   * signed assertion scoped to this app, then cache it. Call from the GIS callback.
   *
   * Posts as `text/plain` for the same reason every NDocs call does (ADR-0001: keeps the
   * request CORS-simple — Apps Script answers no preflight OPTIONS).
   *
   * @param {string} credential the `credential` field of the GIS CredentialResponse
   * @returns {Promise<{email: string, sub: string}>} rejects, with a message fit to show, if
   *   Google verified the person but NUUC-Dispatch would not issue an assertion for `ndocs`.
   */
  function signIn(credential) {
    if (!credential) return Promise.reject(new Error('No Google credential was supplied.'));
    var url = NDOCS_CONFIG.DISPATCH_URL;
    if (!/^https:\/\//.test(url)) {
      return Promise.reject(new Error(
        'This build has no NUUC-Dispatch URL stamped into it, so it cannot sign anyone in.'
      ));
    }

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'verify_identity',
        idToken: credential,
        aud: NDOCS_CONFIG.AUD
      })
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      var body;
      try { body = JSON.parse(text); }
      catch (e) { throw new Error('NUUC-Dispatch returned something that was not JSON.'); }

      if (!body.verified || !body.assertion) {
        // `unknown_aud` here means NUUC-Dispatch does not (yet) know this app — a deployment
        // fact, not a fault of the person signing in, so say which.
        throw new Error(
          'Google verified your sign-in, but NUUC-Dispatch would not issue an identity ' +
          'assertion for NDocs (' + (body.error || 'not verified') + ').'
        );
      }
      state.assertion = body.assertion;
      state.sub = body.sub || '';
      state.email = body.email || '';
      save();
      return { email: state.email, sub: state.sub };
    });
  }

  function signOut() {
    state.assertion = null;
    state.email = '';
    state.sub = '';
    state.principal = null;
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (e) { /* ignore */ }
    // Stop GIS from silently re-selecting the same account on the next load; otherwise
    // "sign out" is indistinguishable from a page refresh.
    try {
      if (window.google && google.accounts && google.accounts.id) {
        google.accounts.id.disableAutoSelect();
      }
    } catch (e) { /* GIS not loaded on this page */ }
  }

  function principal() {
    return state.principal;
  }

  // setPrincipal(p) — recorded by a page after calling `whoami`. The backend's answer is the
  // only source of `isAdmin` and of team membership; a page never infers either locally
  // (DESIGN.md §Front End).
  function setPrincipal(p) {
    state.principal = p;
  }

  function assertion() {
    return state.assertion;
  }

  function email() {
    return state.email;
  }

  return {
    resume: resume,
    signIn: signIn,
    signOut: signOut,
    principal: principal,
    setPrincipal: setPrincipal,
    assertion: assertion,
    email: email
  };
})();
