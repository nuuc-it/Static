// app/page-resource.js — resource.html controller. Full record, warnings, and — when
// the viewer's team owns the record — retire. Calls get_resource, retire_resource.
//
// The reader-facing "report a problem" workflow was pulled from this page's mockup
// (2026-09-12, pre-NDocs-6sa) at the product owner's direction — the whole findings
// capability may be retired, pending confirmation before that becomes permanent. The
// mock-backend.js report_problem handler and its webapp-actions.md route are untouched;
// only this page's entry point to it is gone.
(function () {
  'use strict';

  var ui = NDocsUI;
  var detailEl;
  var currentResourceId;

  function resourceIdFromQuery() {
    var params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  function renderFindings(openFindings) {
    if (!openFindings.length) return null;
    var list = ui.el('ul', { class: 'ndocs-findings-list' });
    openFindings.forEach(function (f) {
      list.appendChild(ui.el('li', { text: f.kind + (f.note ? ': ' + f.note : '') }));
    });
    return ui.el('div', {}, [ui.el('h3', { text: 'Open findings' }), list]);
  }

  function renderRetire(data) {
    if (!data.canRetire) return null;
    var button = ui.el('button', { type: 'button', text: 'Retire this resource' });
    button.addEventListener('click', function () {
      ui.confirmDialog('Retire "' + data.record.title + '"?').then(function (confirmed) {
        if (!confirmed) return;
        NDocsTransport.call('retire_resource', {
          resourceId: data.record.resource_id, rev: data.record.rev,
          disposition: 'archived', reason: 'Retired from the mockup'
        }).then(function () {
          ui.toast('Resource retired.', 'info');
          load();
        }).catch(function (err) {
          ui.toast('Could not retire: ' + err.message, 'warn');
        });
      });
    });
    return button;
  }

  function load() {
    ui.setBusy(detailEl, true);
    NDocsTransport.call('get_resource', { resourceId: currentResourceId }).then(function (data) {
      ui.setBusy(detailEl, false);
      detailEl.textContent = '';
      detailEl.appendChild(NDocsRecords.detailCard(data.record));
      var findingsNode = renderFindings(data.openFindings);
      if (findingsNode) detailEl.appendChild(findingsNode);
      var retireButton = renderRetire(data);
      if (retireButton) detailEl.appendChild(retireButton);
    }).catch(function (err) {
      ui.setBusy(detailEl, false);
      if (err.name === 'NotAuthorized') {
        detailEl.textContent = '';
        detailEl.appendChild(ui.el('p', { text: 'You are not authorized to view this resource.' }));
        return;
      }
      detailEl.textContent = '';
      detailEl.appendChild(ui.el('p', { text: 'Resource not found.' }));
    });
  }

  function init() {
    detailEl = document.getElementById('ndocs-resource-detail');

    currentResourceId = resourceIdFromQuery();
    if (!currentResourceId) {
      ui.toast('No resource id in the link.', 'warn');
      return;
    }

    NDocsTransport.call('whoami', {}).then(function (principal) {
      NDocsSession.setPrincipal(principal);
    }).catch(function () { /* the caller is already known-signed-in by the time start() runs */ });

    load();
  }

  // Stage 6 (`NDocs-2a9`): same "the page decides when a session exists" contract as
  // `page-search.js` — `resource.html` calls `NDocsPageResource.start()` only after
  // `NDocsSession.resume()` succeeds (or a fresh sign-in completes), not on a bare
  // `DOMContentLoaded`.
  window.NDocsPageResource = { start: init };
})();
