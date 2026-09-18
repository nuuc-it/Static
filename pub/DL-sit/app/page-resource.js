// app/page-resource.js — resource.html controller. Full record, warnings, "report a
// problem", and — when the viewer's team owns the record — retire. Calls get_resource,
// report_problem, retire_resource.
//
// The reader-facing "report a problem" entry point was pulled from this page's mockup
// (2026-09-12, pre-NDocs-6sa) pending confirmation that the whole findings capability
// would stay. ADR-0006 (accepted 2026-09-11) never lapsed, and Stage 10 (`findings`:
// `NDocs-bj5`, `NDocs-0ti`) landed the real `FindingService.js`/`report_problem` route
// against a bead the tracker never deferred — the confirmation this comment was waiting on.
// Restored here against the real route (`FINDING_REPORT_KINDS`, `H_Findings.js`), not the
// old mock-backend.js shape.
(function () {
  'use strict';

  var ui = NDocsUI;
  var detailEl;
  var currentResourceId;
  var currentPrincipal;

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

  var REPORT_KINDS = [
    ['link_broken', 'The link is broken'],
    ['access_reported', "I can't access it"],
    ['outdated_reported', "It's outdated"],
    ['wrong_owner_reported', 'Wrong owning team'],
    ['replaced_reported', 'It has been replaced']
  ];

  function renderReportProblem(resourceId) {
    var select = ui.el('select', {});
    REPORT_KINDS.forEach(function (pair) {
      select.appendChild(ui.el('option', { value: pair[0], text: pair[1] }));
    });
    var note = ui.el('input', { type: 'text', placeholder: 'note (optional)' });
    var button = ui.el('button', { type: 'button', text: 'Report a problem' });
    button.addEventListener('click', function () {
      NDocsTransport.call('report_problem', {
        resourceId: resourceId, kind: select.value, note: note.value || undefined
      }).then(function (data) {
        ui.toast(data.attachedToExisting ? 'Added to an existing report.' : 'Problem reported.', 'info');
        load();
      }).catch(function (err) {
        ui.toast('Could not report the problem: ' + err.message, 'warn');
      });
    });
    return ui.el('div', { class: 'ndocs-report-problem' }, [select, note, button]);
  }

  // Admin-only single-resource reassign-to-team control (admin-UI-restructure addendum,
  // post-Stage-15, 2026-09-17): `admin_reassign_resources`'s single-resource case moved here
  // from the retired `admin.html` — always about the one resource already on screen.
  function renderReassign(record) {
    if (!currentPrincipal || !currentPrincipal.isAdmin) return null;
    var teamSelect = ui.el('select', {});
    teamSelect.appendChild(ui.el('option', { value: '', text: '(unresolved queue)' }));
    var vocabData = NDocsVocab.current();
    (vocabData && vocabData.teams || []).forEach(function (t) {
      var opt = ui.el('option', { value: t.teamId, text: t.name });
      if (t.teamId === record.team_id) opt.setAttribute('selected', 'selected');
      teamSelect.appendChild(opt);
    });
    var button = ui.el('button', { type: 'button', text: 'Reassign' });
    button.addEventListener('click', function () {
      button.disabled = true;
      NDocsTransport.call('admin_reassign_resources', {
        resourceIds: [record.resource_id], toTeamId: teamSelect.value || undefined
      }).then(function (result) {
        button.disabled = false;
        ui.toast('Applied: ' + result.applied.length + ', skipped: ' + result.skipped.length + '.', 'info');
        load();
      }).catch(function (err) {
        button.disabled = false;
        ui.toast('Could not reassign: ' + err.message, 'warn');
      });
    });
    return ui.el('div', { class: 'ndocs-admin-row' }, [
      ui.el('h3', { text: 'Reassign to team (administrator)' }), teamSelect, button
    ]);
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
      detailEl.appendChild(renderReportProblem(data.record.resource_id));
      var retireButton = renderRetire(data);
      if (retireButton) detailEl.appendChild(retireButton);
      var reassignControl = renderReassign(data.record);
      if (reassignControl) detailEl.appendChild(reassignControl);
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

    // The admin-only reassign control needs the team directory (`NDocsVocab`) and
    // `principal.isAdmin` before it can decide whether to render — both loaded once here,
    // and `load()` re-run once they answer so a first-paint viewer who happens to be an
    // admin still sees the control without a manual refresh.
    NDocsVocab.load().catch(function () { /* renderReassign degrades to no control */ });
    NDocsTransport.call('whoami', {}).then(function (principal) {
      NDocsSession.setPrincipal(principal);
      currentPrincipal = principal;
      ui.renderNav(principal);
      load();
    }).catch(function () { /* the caller is already known-signed-in by the time start() runs */ });

    load();
  }

  // Stage 6 (`NDocs-2a9`): same "the page decides when a session exists" contract as
  // `page-search.js` — `resource.html` calls `NDocsPageResource.start()` only after
  // `NDocsSession.resume()` succeeds (or a fresh sign-in completes), not on a bare
  // `DOMContentLoaded`.
  window.NDocsPageResource = { start: init };
})();
