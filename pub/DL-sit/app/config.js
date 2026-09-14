// app/config.js — build-stamped configuration.
//
// Two consumers, one module (NDocs-g2u):
//   - the published static build, where the page that loads this file has already been
//     stamped by the deploy pipeline (tools/static-pages.js, gas-static) and therefore
//     declares STATIC_WEBAPP_URL_ / STATIC_BUILD_VERSION_ / STATIC_BUILD_ENV_ /
//     STATIC_DISPATCH_URL_ / STATIC_GIS_CLIENT_ID_ as real values BEFORE this script tag;
//   - the local mockup (ndocs/*.html over file:// or the Playwright static server), where
//     nothing stamps anything and every value below stays its own placeholder token.
//
// That is why each value reads the stamped global first and falls back to the raw token: the
// same file serves both without a second copy and without a build step (this project's
// CLAUDE.md "reuse, do not re-derive" — GActionSheet stamps its one self-contained page the
// same way, we stamp the page and let the shared modules read what it declared). An
// unstamped build's WEBAPP_URL is therefore not a URL, which is exactly what app/transport.js
// uses to decide there is no real backend to call. Do not hardcode a real value here.
// A `var` declared at the top level of the page's own <script> is a property of `window`, so
// an indexed read is both safe when the name was never declared and free of `eval`.
function _ndocsStamped(name, fallback) {
  var value = (typeof window !== 'undefined') ? window[name] : undefined;
  return (value === null || value === undefined || value === '') ? fallback : value;
}

var NDOCS_CONFIG = Object.freeze({
  WEBAPP_URL: _ndocsStamped('STATIC_WEBAPP_URL_', 'STATIC_WEBAPP_URL_'),
  DISPATCH_URL: _ndocsStamped('STATIC_DISPATCH_URL_', 'STATIC_DISPATCH_URL_'),
  GIS_CLIENT_ID: _ndocsStamped('STATIC_GIS_CLIENT_ID_', 'STATIC_GIS_CLIENT_ID_'),
  VERSION: _ndocsStamped('STATIC_BUILD_VERSION_', 'STATIC_BUILD_VERSION_'),
  ENV: _ndocsStamped('STATIC_BUILD_ENV_', 'STATIC_BUILD_ENV_'),
  AUD: 'ndocs'
});
