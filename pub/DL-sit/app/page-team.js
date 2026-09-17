// app/page-team.js — team.html controller (Stage 7 `team-read`, `NDocs-6hk`). Team
// configuration and its resources grouped by containing folder (UC-22), read-only. Calls
// whoami, list_team_inventory.
//
// This file used to drive the Stage 1 mockup's team.html: drop-to-register, the candidate
// queue, and the certification sheet, all against `app/mock-backend.js` (retired at Stage 6,
// `NDocs-2a9`) and field names (`membershipGroup`, `notifyAddress`) the real `Contract.js`
// (Stage 5) never had. Rewritten in place for the real cutover rather than kept alongside a
// second copy — the same "delete the mock, don't half-serve it" discipline `page-resource.js`
// and `page-search.js` already went through. Register/candidates/certify panels return in
// Stages 8/12/11, once `inspect_url`/`register_resource`, `scan_folders`/`admin_list_
// candidates`, and `get_certification`/`certify_resources` exist to back them — adding their
// markup ahead of that would be exactly this stage's own "Must not: offer any write UI."
//
// Stage 10 (`findings`, `NDocs-0ti`) adds the findings panel and the inventory's "Open
// findings" column below — this page's own read surface, `list_findings`/`resolve_finding`,
// same "resolution is a write, but a narrow one this page's team-member gate already covers"
// reasoning `page-resource.js`'s retire button uses.
(function () {
  'use strict';

  var ui = NDocsUI;
  var configEl, inventoryEl, findingsEl;
  var currentTeamId;
  var FINDING_RESOLUTIONS = ['accept', 'reject', 'fixed', 'wont_fix'];

  function teamIdFromQuery() {
    var params = new URLSearchParams(window.location.search);
    return params.get('team');
  }

  // The team's own configuration (UC-22) — every field a team lead would check against
  // what they expect, `Contract.js`'s own field names (`_teamFullConfigView`,
  // `TeamService.js`), not the mockup's draft ones.
  function renderConfig(team) {
    var fields = [
      ['Name', team.name], ['State', team.state], ['Doc ID prefix', team.docIdPrefix],
      ['Review cadence (months)', team.reviewCadenceMonths],
      ['Member group', team.member_group], ['Notify addresses', team.notify_emails],
      ['Scan consent', team.scan_consent ? 'on' : 'off'],
      ['Configuration state', team.configState],
      ['Excluded folders', (team.excludedFolders || []).join(', ') || '—']
    ];
    var dl = ui.el('dl', { class: 'ndocs-detail-fields' });
    fields.forEach(function (pair) {
      dl.appendChild(ui.el('dt', { text: pair[0] }));
      dl.appendChild(ui.el('dd', {
        text: (pair[1] === undefined || pair[1] === null || pair[1] === '') ? '—' : String(pair[1])
      }));
    });
    return ui.el('div', { class: 'ndocs-detail-card' }, [ui.el('h2', { text: team.name }), dl]);
  }

  // One heading + table per folder, unresolved last — it is the exception this view exists
  // to surface (this stage's own "Must not: hide it"), not the common case. `records.js`'s
  // resultsTable already hides the folder column inside a group, since the heading names it.
  // `findingCounts` (Stage 10, `NDocs-0ti`) is `{resourceId: {open, blocking}}` from
  // `list_team_inventory`; `records.js`'s column wants a plain count per id.
  function renderInventory(data) {
    inventoryEl.textContent = '';
    if (!data.records.length) {
      inventoryEl.appendChild(ui.el('p', { text: 'This team has no catalogued resources yet.' }));
      return;
    }
    var openCounts = {};
    Object.keys(data.findingCounts || {}).forEach(function (id) {
      openCounts[id] = data.findingCounts[id].open;
    });
    var byFolder = {};
    data.records.forEach(function (r) {
      var key = r.drive_folder_id || '';
      (byFolder[key] = byFolder[key] || []).push(r);
    });
    var resolvedFolders = data.folders.filter(function (f) { return f.folderId; });
    var unresolvedFolder = data.folders.filter(function (f) { return !f.folderId; })[0];
    var ordered = unresolvedFolder ? resolvedFolders.concat([unresolvedFolder]) : resolvedFolders;

    ordered.forEach(function (folder) {
      var records = byFolder[folder.folderId || ''] || [];
      var heading;
      if (folder.folderId) {
        heading = folder.url
          ? ui.el('a', { href: folder.url, target: '_blank', rel: 'noopener', text: (folder.name || folder.folderId) + ' (' + folder.count + ')' })
          : ui.el('span', { text: (folder.name || folder.folderId) + ' (' + folder.count + ')' });
      } else {
        heading = ui.el('span', { class: 'ndocs-folder--unresolved', text: 'Unresolved folder (' + folder.count + ')' });
      }
      inventoryEl.appendChild(ui.el('h3', {}, [heading]));
      inventoryEl.appendChild(NDocsRecords.resultsTable(records, { hideFolder: true, findingCounts: openCounts }));
    });
  }

  // The team findings list (Stage 10, `NDocs-0ti`) — every open exception against this
  // team, whatever kind produced it (ADR-0006). One resolution control per row: a
  // resolution select plus a note, calling `resolve_finding` and reloading on success.
  function renderFindings(findings) {
    findingsEl.textContent = '';
    findingsEl.appendChild(ui.el('h2', { text: 'Findings' }));
    if (!findings.length) {
      findingsEl.appendChild(ui.el('p', { text: 'No open findings.' }));
      return;
    }
    var table = ui.el('table', { class: 'ndocs-table' });
    var thead = ui.el('thead', {}, [ui.el('tr', {}, [
      ui.el('th', { text: 'Kind' }), ui.el('th', { text: 'Resource' }),
      ui.el('th', { text: 'Detected' }), ui.el('th', { text: 'Resolve' })
    ])]);
    var tbody = ui.el('tbody', {});
    findings.forEach(function (f) {
      var select = ui.el('select', {});
      FINDING_RESOLUTIONS.forEach(function (r) {
        select.appendChild(ui.el('option', { value: r, text: r }));
      });
      var note = ui.el('input', { type: 'text', placeholder: 'note (optional)' });
      var button = ui.el('button', { type: 'button', text: 'Resolve' });
      button.addEventListener('click', function () {
        NDocsTransport.call('resolve_finding', {
          findingId: f.finding_id, rev: f.rev, resolution: select.value, note: note.value || undefined
        }).then(function () {
          ui.toast('Finding resolved.', 'info');
          load();
        }).catch(function (err) {
          ui.toast('Could not resolve: ' + err.message, 'warn');
        });
      });
      var resourceLink = f.resource_id
        ? ui.el('a', { href: 'resource.html?id=' + encodeURIComponent(f.resource_id), text: f.resource_id })
        : ui.el('span', { text: '—' });
      tbody.appendChild(ui.el('tr', {}, [
        ui.el('td', { text: f.kind }),
        ui.el('td', {}, [resourceLink]),
        ui.el('td', { text: f.detected_at ? new Date(f.detected_at).toLocaleDateString() : '—' }),
        ui.el('td', {}, [select, note, button])
      ]));
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    findingsEl.appendChild(table);
  }

  function load() {
    ui.setBusy(inventoryEl, true);
    NDocsTransport.call('list_team_inventory', { teamId: currentTeamId, groupBy: 'folder' }).then(function (data) {
      ui.setBusy(inventoryEl, false);
      configEl.textContent = '';
      configEl.appendChild(renderConfig(data.team));
      renderInventory(data);
    }).catch(function (err) {
      ui.setBusy(inventoryEl, false);
      configEl.textContent = '';
      inventoryEl.textContent = '';
      if (err.name === 'NotAuthorized') {
        configEl.appendChild(ui.el('p', { text: 'You are not a member of this team.' }));
        return;
      }
      configEl.appendChild(ui.el('p', { text: 'Team not found.' }));
    });

    NDocsTransport.call('list_findings', { teamId: currentTeamId, state: 'open' }).then(function (data) {
      renderFindings(data.findings);
    }).catch(function () {
      // Same team-membership gate as list_team_inventory above; a refusal here already
      // shows on the config/inventory panel, so this call fails silently rather than
      // duplicating that message.
    });
  }

  function init() {
    configEl = document.getElementById('ndocs-team-config');
    inventoryEl = document.getElementById('ndocs-team-inventory');
    findingsEl = document.getElementById('ndocs-team-findings');

    currentTeamId = teamIdFromQuery();
    if (!currentTeamId) {
      ui.toast('No team in the link.', 'warn');
      return;
    }

    NDocsTransport.call('whoami', {}).then(function (principal) {
      NDocsSession.setPrincipal(principal);
    }).catch(function () { /* the caller is already known-signed-in by the time start() runs */ });

    load();
  }

  // Same "the page decides when a session exists" contract as page-search.js/
  // page-resource.js (Stage 6, `NDocs-2a9`) — team.html calls NDocsPageTeam.start() only
  // once a session is confirmed, never on a bare DOMContentLoaded.
  window.NDocsPageTeam = { start: init };
})();
