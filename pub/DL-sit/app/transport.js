// app/transport.js — the one seam between every page and the backend. Per
// docs/interfaces/webapp-actions.md: POST, Content-Type: text/plain, JSON body, always
// HTTP 200, failure in the envelope — reflected here as thrown NotAuthorized/Stale/
// Unavailable/TransportError instead of an ok:false envelope, so callers use try/catch.
//
// ONE BACKEND PER BUILD (NDocs-g2u). Which backend a build talks to is decided by whether
// the deploy pipeline stamped a real Web App URL into app/config.js's WEBAPP_URL — not by an
// environment name, which would have to be kept in step by hand:
//   - stamped (the published SIT/PROD static build)  -> the real Web App over fetch();
//   - unstamped (the local mockup over file:// or the Playwright static server, where the
//     value is still the literal placeholder token) -> app/mock-backend.js.
// No single build can therefore reach both, which is what Stage 6's "there is never a
// release with two live backends" requires. NDocs-2a9 (Stage 6) retires the mock branch
// altogether and publishes the mockup pages against this same real path.
var NDocsTransport = (function () {
  'use strict';

  function NotAuthorized(message) { this.name = 'NotAuthorized'; this.message = message; }
  NotAuthorized.prototype = Object.create(Error.prototype);

  function Stale(message, rev) { this.name = 'Stale'; this.message = message; this.rev = rev; }
  Stale.prototype = Object.create(Error.prototype);

  function Unavailable(message) { this.name = 'Unavailable'; this.message = message; }
  Unavailable.prototype = Object.create(Error.prototype);

  function TransportError(message) { this.name = 'Transport'; this.message = message; }
  TransportError.prototype = Object.create(Error.prototype);

  // A non-JSON body is not an error code — it means the deployment is mid-propagation
  // (webapp-actions.md §Error codes). Retry with backoff before surfacing Transport.
  var RETRY_DELAYS_MS = [400, 1200, 3000];

  function hasRealBackend() {
    return /^https:\/\//.test(NDOCS_CONFIG.WEBAPP_URL);
  }

  function envelopeToError(envelope) {
    if (envelope.code === 'not_authorized') return new NotAuthorized(envelope.error);
    if (envelope.code === 'stale_record') return new Stale(envelope.error, envelope.data && envelope.data.rev);
    if (envelope.code === 'unavailable') return new Unavailable(envelope.error);
    var err = new TransportError(envelope.error);
    err.code = envelope.code;
    err.data = envelope.data;
    return err;
  }

  // The request envelope, webapp-actions.md §Request envelope. `assertion` is attached for
  // every call; a route whose gate is `open` simply ignores it, and omitting it on the
  // others is what produces a not_authorized the caller cannot explain.
  function requestBody(action, payload) {
    var body = {
      action: action,
      clientVersion: NDOCS_CONFIG.VERSION,
      initiatedAt: Date.now()
    };
    var assertion = NDocsSession.assertion();
    if (assertion) body.assertion = assertion;
    var data = payload || {};
    for (var key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) body[key] = data[key];
    }
    return JSON.stringify(body);
  }

  function postOnce(body) {
    return fetch(NDOCS_CONFIG.WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body
    }).then(function (res) {
      return res.text();
    });
  }

  function postWithRetry(body, attempt) {
    return postOnce(body).then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        if (attempt >= RETRY_DELAYS_MS.length) {
          throw new TransportError(
            'The backend returned a non-JSON response ' + (attempt + 1) + ' times — the ' +
            'deployment may still be propagating.'
          );
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, RETRY_DELAYS_MS[attempt]);
        }).then(function () {
          return postWithRetry(body, attempt + 1);
        });
      }
    }, function (networkError) {
      throw new TransportError(networkError && networkError.message ? networkError.message : 'Network error');
    });
  }

  // call(action, payload) -> Promise<data>
  function call(action, payload) {
    if (!hasRealBackend()) {
      return NDocsMockBackend.call(action, payload).then(function (envelope) {
        if (envelope.ok) return envelope.data;
        throw envelopeToError(envelope);
      });
    }
    return postWithRetry(requestBody(action, payload), 0).then(function (envelope) {
      if (envelope.ok) {
        // `version` answers flat, not wrapped (webapp-actions.md §Meta) — every other route
        // carries its payload under `data`.
        return envelope.data === undefined ? envelope : envelope.data;
      }
      throw envelopeToError(envelope);
    });
  }

  return {
    call: call,
    hasRealBackend: hasRealBackend,
    NotAuthorized: NotAuthorized,
    Stale: Stale,
    Unavailable: Unavailable,
    TransportError: TransportError
  };
})();
