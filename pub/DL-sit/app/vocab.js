// app/vocab.js — load() once per session: controlled values, field metadata with
// authority classes, team directory, build version. Cached in sessionStorage keyed by
// build version, per DESIGN.md's app/vocab.js contract (backed by get_bootstrap,
// docs/interfaces/webapp-actions.md §Meta).
var NDocsVocab = (function () {
  'use strict';

  var CACHE_KEY_PREFIX = 'ndocs.vocab.';
  var loaded = null; // { vocab, fields, teams, provisions, config }

  function cacheKey() {
    return CACHE_KEY_PREFIX + NDOCS_CONFIG.VERSION;
  }

  function load() {
    if (loaded) return Promise.resolve(loaded);

    var cached;
    try { cached = JSON.parse(sessionStorage.getItem(cacheKey()) || 'null'); }
    catch (e) { cached = null; }
    if (cached) {
      loaded = cached;
      return Promise.resolve(loaded);
    }

    return NDocsTransport.call('get_bootstrap', {}).then(function (data) {
      loaded = data;
      try { sessionStorage.setItem(cacheKey(), JSON.stringify(data)); }
      catch (e) { /* ignore quota errors */ }
      return loaded;
    });
  }

  function current() {
    return loaded;
  }

  return {
    load: load,
    current: current
  };
})();
