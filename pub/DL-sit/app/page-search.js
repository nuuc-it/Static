// app/page-search.js — the catalog listing controller (`catalog.html`, and the Stage 1
// mockup's `ndocs/index.html`). Search box, facet filters, ranked results, browse-by
// dimension. Calls get_bootstrap (via NDocsVocab), whoami, and search_resources (via
// NDocsTransport).
//
// The drop-to-register panel (`#ndocs-drop-toggle`/`#ndocs-drop`) is Stage 8's write
// capability (`NDocs-6o8`) — Stage 6's real published page omits those elements entirely
// (its own "Must not: offer any write UI"), so `wireDropToggle`/the `NDocsDropRegister.mount`
// call below are both no-ops when the elements/module aren't present, which is what lets this
// same controller keep driving the Stage 1 mockup (`ndocs/index.html`, which still has them)
// without a fork.
(function () {
  'use strict';

  var ui = NDocsUI;
  var resultsEl, facetsEl, myTeamsEl, formEl;

  // The disclosure used to be a native <details>; a plain button reads more clearly as
  // an action than a summary triangle, so the show/hide state is tracked here instead.
  function wireDropToggle() {
    var toggle = document.getElementById('ndocs-drop-toggle');
    var panel = document.getElementById('ndocs-drop');
    if (!toggle || !panel) return;
    toggle.addEventListener('click', function () {
      var showing = !panel.hidden;
      panel.hidden = showing;
      toggle.setAttribute('aria-expanded', String(!showing));
    });
  }

  function renderMyTeams(principal) {
    myTeamsEl.textContent = '';
    if (!principal) return;
    principal.teams.forEach(function (t) {
      // No role suffix — teamMember is the only gate a team confers (2026-09-14
      // decision: certification needs no lead role; see ADR-0003 amendment).
      var link = ui.el('a', {
        href: 'team.html?team=' + encodeURIComponent(t.teamId),
        text: t.name
      });
      myTeamsEl.appendChild(link);
      myTeamsEl.appendChild(document.createTextNode(' '));
    });
  }

  function renderFacets(vocab) {
    facetsEl.textContent = '';
    var teamSelect = ui.el('select', { id: 'ndocs-filter-team' });
    teamSelect.appendChild(ui.el('option', { value: '', text: 'All teams' }));
    (vocab.teams || []).forEach(function (t) {
      teamSelect.appendChild(ui.el('option', { value: t.teamId, text: t.name }));
    });
    var typeSelect = ui.el('select', { id: 'ndocs-filter-type' });
    typeSelect.appendChild(ui.el('option', { value: '', text: 'All types' }));
    (vocab.vocab.type || []).forEach(function (t) {
      typeSelect.appendChild(ui.el('option', { value: t, text: t }));
    });
    teamSelect.addEventListener('change', runSearch);
    typeSelect.addEventListener('change', runSearch);
    facetsEl.appendChild(teamSelect);
    facetsEl.appendChild(typeSelect);
  }

  function renderResults(data) {
    resultsEl.textContent = '';
    resultsEl.appendChild(ui.el('p', { text: data.total + ' result' + (data.total === 1 ? '' : 's') }));
    if (data.results.length) resultsEl.appendChild(NDocsRecords.resultsTable(data.results));
  }

  function runSearch() {
    var q = document.getElementById('ndocs-search-q').value;
    var teamSelect = document.getElementById('ndocs-filter-team');
    var typeSelect = document.getElementById('ndocs-filter-type');
    var filters = {};
    if (teamSelect && teamSelect.value) filters.teamId = teamSelect.value;
    if (typeSelect && typeSelect.value) filters.type = typeSelect.value;
    ui.setBusy(resultsEl, true);
    NDocsTransport.call('search_resources', { q: q, filters: filters, page: 1, pageSize: 50 })
      .then(function (data) {
        ui.setBusy(resultsEl, false);
        renderResults(data);
      })
      .catch(function (err) {
        ui.setBusy(resultsEl, false);
        ui.toast('Search failed: ' + err.message, 'warn');
      });
  }

  function init() {
    resultsEl = document.getElementById('ndocs-results');
    facetsEl = document.getElementById('ndocs-facets');
    myTeamsEl = document.getElementById('ndocs-my-teams');
    formEl = document.getElementById('ndocs-search-form');

    NDocsSession.resume();
    formEl.addEventListener('submit', function (e) { e.preventDefault(); runSearch(); });
    wireDropToggle();

    // The drop target needs both the principal (for its team folders) and the vocabulary
    // (for the prefilled entry's controlled values), so it mounts once both have answered.
    Promise.all([
      NDocsTransport.call('whoami', {}),
      NDocsVocab.load()
    ]).then(function (both) {
      var principal = both[0];
      NDocsSession.setPrincipal(principal);
      renderMyTeams(principal);
      renderFacets(both[1]);
      var dropEl = document.getElementById('ndocs-drop');
      if (dropEl && typeof NDocsDropRegister !== 'undefined') {
        NDocsDropRegister.mount(dropEl, { principal: principal });
      }
      runSearch();
    }).catch(function (err) {
      ui.toast('Could not load the catalog: ' + err.message, 'warn');
    });
  }

  // Stage 6 (`NDocs-2a9`): no `DOMContentLoaded` auto-run. `catalog.html` decides WHEN to
  // start this controller — only once a session is confirmed (resumed or freshly signed in)
  // — rather than firing unconditionally and hitting `whoami` before sign-in ever happens.
  // The Stage 1 mockup this used to also serve (`ndocs/index.html`, always "signed in" against
  // the retired `app/mock-backend.js`) is gone, so there is only the one caller to satisfy.
  window.NDocsPageSearch = { start: init };
})();
