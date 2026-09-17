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
(function () {
  'use strict';

  var ui = NDocsUI;
  var configEl, inventoryEl;
  var currentTeamId;

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
  function renderInventory(data) {
    inventoryEl.textContent = '';
    if (!data.records.length) {
      inventoryEl.appendChild(ui.el('p', { text: 'This team has no catalogued resources yet.' }));
      return;
    }
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
      inventoryEl.appendChild(NDocsRecords.resultsTable(records, { hideFolder: true }));
    });
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
  }

  function init() {
    configEl = document.getElementById('ndocs-team-config');
    inventoryEl = document.getElementById('ndocs-team-inventory');

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
