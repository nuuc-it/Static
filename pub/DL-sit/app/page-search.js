// app/page-search.js — catalog.html's controller (NDocs-utv, Stage 15.5). Search box and
// labeled filters are always visible (no page-level disclosure to expand first); results
// render as list rows inside a section card, not a table, per
// docs/interfaces/ux-components.md's catalog composition row. "+ Add document to the
// catalog" expands an in-page panel (app/drop-register.js, unchanged — it already supports
// both a drop target and a paste/type fallback) and moves focus to its URL field.
(function () {
  'use strict';

  var ui = NDocsUI;
  var resultsEl, statusEl, formEl, qInput;
  var lastQuery = { q: '', teamId: '', type: '', audience: '', status: '' };

  function wireAddPanel() {
    var toggle = document.getElementById('ndocs-add-toggle');
    var panel = document.getElementById('ndocs-add-panel');
    var closeBtn = document.getElementById('ndocs-add-close');
    if (!toggle || !panel) return;

    function open() {
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      var urlInput = panel.querySelector('.ndocs-drop-url');
      if (urlInput) urlInput.focus();
    }
    function close() {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
    toggle.addEventListener('click', function () {
      if (panel.hidden) open(); else close();
    });
    if (closeBtn) closeBtn.addEventListener('click', close);
  }

  function renderFacets(vocab) {
    var teamSelect = document.getElementById('ndocs-filter-team');
    var typeSelect = document.getElementById('ndocs-filter-type');
    var audienceSelect = document.getElementById('ndocs-filter-audience');

    teamSelect.textContent = '';
    teamSelect.appendChild(ui.el('option', { value: '', text: 'All teams' }));
    (vocab.teams || []).forEach(function (t) {
      teamSelect.appendChild(ui.el('option', { value: t.teamId, text: t.name }));
    });

    typeSelect.textContent = '';
    typeSelect.appendChild(ui.el('option', { value: '', text: 'All types' }));
    // `vocab.vocab` is `null` until a real controlled-vocabulary source exists — this build
    // simply offers no type/audience options rather than throwing on `null.type`.
    ((vocab.vocab && vocab.vocab.type) || []).forEach(function (t) {
      typeSelect.appendChild(ui.el('option', { value: t, text: t }));
    });

    audienceSelect.textContent = '';
    audienceSelect.appendChild(ui.el('option', { value: '', text: 'All audiences' }));
    ((vocab.vocab && vocab.vocab.audience) || []).forEach(function (a) {
      audienceSelect.appendChild(ui.el('option', { value: a, text: a }));
    });

    [teamSelect, typeSelect, audienceSelect, document.getElementById('ndocs-filter-status')]
      .forEach(function (sel) { sel.addEventListener('change', runSearch); });
  }

  function resultRow(record) {
    var badges = ui.el('div', { class: 'badges' });
    if (record.type) badges.appendChild(ui.el('span', { class: 'badge', text: record.type }));
    var status = NDocsRecords.statusBadge(record);
    if (status) badges.appendChild(ui.el('span', { class: 'badge badge--' + status.kind, text: status.text }));

    // UC-22: a folder is named by its leaf, the full path carried whole as the tooltip
    // (never truncated into ambiguity) — the same folderCell() every listing uses, so a
    // result row and team.html's inventory table read identically for the same record.
    var metaLine = ui.el('p', { class: 'meta' });
    if (record.team_id) { metaLine.appendChild(document.createTextNode(record.team_id + ' · ')); }
    metaLine.appendChild(NDocsRecords.folderCell(record));
    if (record.drive_modified_at) {
      metaLine.appendChild(document.createTextNode(' · updated ' + NDocsRecords.dateOrDash(record.drive_modified_at)));
    }
    var body = [
      ui.el('a', {
        class: 'result-title', href: 'resource.html?id=' + encodeURIComponent(record.resource_id), text: record.title
      }),
      metaLine
    ];
    if (record.purpose) body.push(ui.el('p', { text: record.purpose }));

    return ui.el('li', { class: 'result-item' }, [
      ui.el('div', { class: 'result-head' }, [
        ui.el('div', {}, body),
        badges
      ])
    ]);
  }

  function isDefaultQuery() {
    return !lastQuery.q && !lastQuery.teamId && !lastQuery.type &&
      !lastQuery.audience && (!lastQuery.status || lastQuery.status === '');
  }

  function renderResults(data) {
    if (!data.results.length) {
      var message = isDefaultQuery()
        ? 'No resources have been registered in the catalog yet.'
        : 'No results match these filters. Try a different search or clear a filter.';
      NDocsShell.region(resultsEl, 'empty', { message: message });
    } else {
      var list = ui.el('ol', { class: 'result-list' });
      data.results.forEach(function (record) { list.appendChild(resultRow(record)); });
      NDocsShell.region(resultsEl, 'populated', { node: list });
    }
    var countText = data.total + ' result' + (data.total === 1 ? '' : 's');
    statusEl.textContent = countText;
    ui.announce(countText);
  }

  function runSearch() {
    var teamSelect = document.getElementById('ndocs-filter-team');
    var typeSelect = document.getElementById('ndocs-filter-type');
    var audienceSelect = document.getElementById('ndocs-filter-audience');
    var statusSelect = document.getElementById('ndocs-filter-status');

    lastQuery = {
      q: qInput.value,
      teamId: teamSelect.value,
      type: typeSelect.value,
      audience: audienceSelect.value,
      status: statusSelect.value
    };

    var filters = {};
    if (lastQuery.teamId) filters.teamId = lastQuery.teamId;
    if (lastQuery.type) filters.type = lastQuery.type;
    if (lastQuery.audience) filters.audience = lastQuery.audience;
    var includeRetired = false;
    if (lastQuery.status === 'all') includeRetired = true;
    if (lastQuery.status === 'retired') { filters.status = 'retired'; includeRetired = true; }

    NDocsShell.region(resultsEl, 'loading', { loadingText: 'Searching…' });
    NDocsTransport.call('search_resources', {
      q: lastQuery.q, filters: filters, includeRetired: includeRetired, page: 1, pageSize: 50
    }).then(renderResults).catch(function (err) {
      NDocsShell.region(resultsEl, 'error', {
        message: 'Search failed: ' + err.message,
        onRetry: runSearch
      });
    });
  }

  function start() {
    resultsEl = document.getElementById('ndocs-results');
    statusEl = document.getElementById('ndocs-search-status');
    formEl = document.getElementById('ndocs-search-form');
    qInput = document.getElementById('ndocs-search-q');

    formEl.addEventListener('submit', function (e) { e.preventDefault(); runSearch(); });
    wireAddPanel();

    return Promise.all([
      NDocsTransport.call('whoami', {}),
      NDocsVocab.load()
    ]).then(function (both) {
      var principal = both[0];
      NDocsSession.setPrincipal(principal);
      renderFacets(both[1]);
      var addPanel = document.getElementById('ndocs-add-panel');
      if (addPanel && typeof NDocsDropRegister !== 'undefined') {
        NDocsDropRegister.mount(addPanel.querySelector('.add-document-panel__body'), {
          principal: principal,
          onRegistered: function (record) {
            ui.announce('Added ' + record.doc_id + '.');
            window.location.href = 'resource.html?id=' + encodeURIComponent(record.resource_id) + '&edit=1&new=1';
          }
        });
      }
      runSearch();
      return principal;
    });
  }

  window.NDocsPageSearch = { start: start };
})();
