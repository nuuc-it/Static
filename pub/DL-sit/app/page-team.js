// app/page-team.js — team.html controller (Stage 15.6, `NDocs-c71`; disclosure-section pass
// 2026-09-19). Rebuilt onto the shared UI system (ADR-0012): team entity summary panel; "Needs
// your attention" task cards (open certification, waiting scan candidates) ordered by urgency
// and absent entirely when there is no work — not shown empty; Inventory, Scanning, and
// Certification are each a deep-linkable `<details>` disclosure section (`#inventory`,
// `#candidates`, `#certify`), same convention as `tools.html` ("never a tab widget",
// ux-components.md) — a team with many folders/candidates never forces one giant always-open
// page; folder rows inside Inventory stay their own nested disclosures; open findings is a
// separate maintenance disclosure (`#findings`); scan job state announced via
// `NDocsUI.announce`. Calls whoami, list_team_inventory, list_findings, get_certification,
// certify_resources, admin_list_candidates, scan_folders, dismiss_candidate, register_resource,
// admin_set_team_state, admin_reassign_resources.
//
// Candidate review (`#candidates`) is not limited to the `proposed` queue: a state selector
// also shows `ignored`/`unevaluable` candidates — scan results that were previously completely
// invisible in the UI (a document auto-ignored by the throwaway-filename/title-collision rule
// had no way to be seen or reconsidered short of reading the `Candidates` sheet directly).
// `approved`/`discarded` are deliberately not offered here: `approved` is already visible as a
// real resource in Inventory, and `discarded` is meant to stay out of sight (that is the whole
// point of dismissing something). Only `proposed` gets the full Register form — `register_
// resource`'s `fromCandidateId` path refuses server-side unless `triage_state === 'proposed'`
// (`RegistryService.js`) — `ignored`/`unevaluable` rows get view + Dismiss only.
(function () {
  'use strict';

  var ui = NDocsUI;
  var summaryEl, tasksEl, inventoryEl, certifyEl, candidatesEl, findingsEl;
  var currentTeamId, currentPrincipal;
  var FINDING_RESOLUTIONS = ['accept', 'reject', 'fixed', 'wont_fix'];
  var CERT_DISPOSITIONS = ['superseded', 'archived', 'withdrawn'];
  var TEAM_STATES = ['active', 'inactive', 'merged'];
  var CANDIDATE_STATES = ['proposed', 'ignored', 'unevaluable'];
  var CANDIDATE_STATE_LABELS = { proposed: 'Waiting review', ignored: 'Ignored by scan', unevaluable: 'Unevaluable' };
  var latestCycle = null;
  var latestCandidateCount = 0;
  var currentCandidateState = 'proposed';
  // Bulk-reassign selection persists across every per-folder table `renderInventory` draws.
  var reassignSelection = new Set();

  // A fragment link (from a task card's own href, or an external deep link) should land on an
  // OPEN section, not a collapsed one — same rule `page-tools.js`'s `load()` applies.
  function openIfLinked(details) {
    if (window.location.hash === '#' + details.id) details.open = true;
  }

  function teamIdFromQuery() {
    var params = new URLSearchParams(window.location.search);
    return params.get('team');
  }

  // ---- team entity summary panel ----

  function renderSummary(team) {
    var badges = ui.el('div', { class: 'badges' }, [
      ui.el('span', { class: 'badge ' + (team.state === 'active' ? 'badge--success' : 'badge--info'), text: team.state })
    ]);
    if (team.configState && team.configState !== 'ok') {
      badges.appendChild(ui.el('span', { class: 'badge badge--danger', text: 'Configuration: ' + team.configState }));
    }
    var top = ui.el('div', { class: 'entity-summary-top' }, [
      ui.el('div', {}, [
        ui.el('div', { class: 'eyebrow', text: 'Team · ' + (team.docIdPrefix || '—') }),
        ui.el('h1', { text: team.name }),
        badges
      ])
    ]);
    var metaPairs = [
      ['Member group', team.member_group || '—'],
      ['Notify addresses', team.notify_emails || '—'],
      ['Review cadence', team.reviewCadenceMonths ? team.reviewCadenceMonths + ' months' : '—']
    ];
    var meta = ui.el('div', { class: 'entity-summary-meta' });
    metaPairs.forEach(function (pair) {
      meta.appendChild(ui.el('div', {}, [
        ui.el('span', { class: 'hero-meta-label', text: pair[0] }),
        ui.el('span', { class: 'hero-meta-value', text: pair[1] })
      ]));
    });
    var children = [ui.el('div', { class: 'entity-summary' }, [top, meta])];
    if (currentPrincipal && currentPrincipal.isAdmin) {
      children.push(renderTeamStateControl(team));
    }
    summaryEl.textContent = '';
    children.forEach(function (n) { summaryEl.appendChild(n); });
  }

  function renderTeamStateControl(team) {
    var stateSelect = ui.el('select', { id: 'ndocs-team-state' });
    TEAM_STATES.forEach(function (s) {
      var opt = ui.el('option', { value: s, text: s });
      if (s === team.state) opt.setAttribute('selected', 'selected');
      stateSelect.appendChild(opt);
    });
    var successorInput = ui.el('input', { type: 'text', placeholder: 'Successor team id (if merged)' });
    var apply = ui.el('button', { type: 'button', class: 'button', text: 'Apply' });
    apply.addEventListener('click', function () {
      apply.disabled = true;
      NDocsTransport.call('admin_set_team_state', {
        teamId: team.teamId, state: stateSelect.value, successorTeamId: successorInput.value || undefined
      }).then(function (result) {
        ui.toast('Updated. ' + result.affectedResources + ' resource(s) still assigned to this team.', 'info');
        load();
      }).catch(function (err) {
        apply.disabled = false;
        ui.toast('Could not update: ' + err.message, 'warn');
      });
    });
    return ui.el('div', { class: 'surface' }, [
      ui.el('div', { class: 'section-kicker', text: 'Administrator' }),
      // h2, not h3 — this renders directly after the entity summary's h1, before any of the
      // page's h2 section cards, so it must not skip a level (ux-components.md "logical
      // heading order").
      ui.el('h2', { class: 'section-title', text: 'Team state' }),
      ui.el('div', { class: 'form-grid' }, [
        ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-team-state', text: 'State' }), stateSelect]),
        ui.el('div', { class: 'field' }, [ui.el('label', { text: 'Successor team' }), successorInput])
      ]),
      ui.el('div', { class: 'button-row' }, [apply])
    ]);
  }

  // ---- "Needs your attention" task cards, urgency-ordered, absent when empty ----

  function renderTasks() {
    var cards = [];
    var hasCertTask = latestCycle && latestCycle.state !== 'certified_empty' && latestCycle.state !== 'certified';
    var overdue = false;
    if (hasCertTask) {
      var dueAt = latestCycle.due_at ? new Date(latestCycle.due_at) : null;
      overdue = !!(dueAt && dueAt.getTime() < Date.now());
      var card = ui.el('div', { class: 'task-card ' + (overdue ? 'task-card--attention' : 'task-card--info') }, [
        ui.el('div', { class: 'task-icon', 'aria-hidden': 'true', text: overdue ? '!' : '✓' }),
        ui.el('div', {}, [
          ui.el('p', { class: 'task-title', text: overdue ? 'Certification overdue' : 'Certification due' }),
          ui.el('p', { class: 'task-copy', text: dueAt ? 'Due ' + dueAt.toLocaleDateString() : 'Open cycle, no due date recorded.' })
        ])
      ]);
      var certifyBtn = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Certify now' });
      certifyBtn.addEventListener('click', function () { focusSection(certifyEl); });
      card.appendChild(certifyBtn);
      // Urgency ordering: overdue certification is the most urgent thing on the page —
      // it always sorts first, ahead of a merely-due certification and candidates alike.
      if (overdue) cards.unshift(card); else cards.push(card);
    }
    if (latestCandidateCount > 0) {
      // No "Review" button here, unlike the certification card above: the candidates
      // disclosure this would scroll to sits immediately below this task grid in the DOM
      // (static-src/team.html) and is already auto-opened whenever this card is shown
      // (`renderCandidates`'s `if (state === 'proposed' && candidates.length > 0) details.open
      // = true`) — a button pointing at content already visible one scroll away duplicated the
      // section instead of navigating to it.
      var cCard = ui.el('div', { class: 'task-card task-card--info' }, [
        ui.el('div', { class: 'task-icon', 'aria-hidden': 'true', text: String(latestCandidateCount) }),
        ui.el('div', {}, [
          ui.el('p', { class: 'task-title', text: latestCandidateCount + ' scan candidate' + (latestCandidateCount === 1 ? '' : 's') + ' waiting' }),
          ui.el('p', { class: 'task-copy', text: 'Found in tracked folders, not yet catalogued.' })
        ])
      ]);
      cards.push(cCard);
    }

    tasksEl.textContent = '';
    if (!cards.length) return; // absent entirely when there is no work — never shown empty
    tasksEl.appendChild(ui.el('div', { class: 'section-kicker', text: 'Needs your attention' }));
    tasksEl.appendChild(ui.el('div', { class: 'task-grid' }, cards));
  }

  function focusSection(el) {
    if (!el) return;
    var details = el.querySelector('details.disclosure');
    if (details) details.open = true;
    el.setAttribute('tabindex', '-1');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus();
  }

  // ---- inventory by folder (dominant section card) ----

  function renderInventory(data, principal) {
    inventoryEl.textContent = '';
    reassignSelection.clear();
    var body = ui.el('div', {});
    if (!data.records.length) {
      body.appendChild(ui.el('div', { class: 'empty-state' }, [
        ui.el('p', { text: 'This team has no catalogued resources yet.' })
      ]));
    } else {
      var isAdmin = !!(principal && principal.isAdmin);
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

      ordered.forEach(function (folder, idx) {
        var records = byFolder[folder.folderId || ''] || [];
        var label = folder.folderId ? (folder.name || folder.folderId) : 'Unresolved folder';
        var summary = ui.el('summary', {}, [
          document.createTextNode(label),
          ui.el('span', { class: 'summary-meta', text: folder.count + ' resource' + (folder.count === 1 ? '' : 's') })
        ]);
        var content = ui.el('div', { class: 'disclosure-content' }, [
          NDocsRecords.resultsTable(records, {
            hideFolder: true, findingCounts: openCounts,
            selectable: isAdmin, selectedIds: isAdmin ? reassignSelection : undefined
          })
        ]);
        var details = ui.el('details', { class: 'disclosure' }, [summary, content]);
        if (idx === 0) details.open = true;
        body.appendChild(details);
      });

      if (isAdmin) body.appendChild(renderBulkReassign());
    }

    var summary = ui.el('summary', {}, [
      document.createTextNode('Resources by folder'),
      ui.el('span', { class: 'summary-meta', text: data.records.length + ' resource' + (data.records.length === 1 ? '' : 's') })
    ]);
    // The dominant content of the page (ux-components.md's "inventory-by-folder as the
    // dominant section card") — open by default, unlike Scanning/Certification which only
    // open when there's a task or a deep link, per this pass's own disclosure-section rule.
    var details = ui.el('details', { class: 'disclosure', id: 'inventory', open: 'open' }, [
      summary, ui.el('div', { class: 'disclosure-content' }, [body])
    ]);
    openIfLinked(details);
    inventoryEl.appendChild(details);
  }

  function renderBulkReassign() {
    var toTeamSelect = ui.el('select', { id: 'ndocs-bulk-reassign-team' });
    toTeamSelect.appendChild(ui.el('option', { value: '', text: '(unresolved queue)' }));
    var vocabData = NDocsVocab.current();
    (vocabData && vocabData.teams || []).forEach(function (t) {
      toTeamSelect.appendChild(ui.el('option', { value: t.teamId, text: t.name }));
    });
    var reassign = ui.el('button', { type: 'button', class: 'button', text: 'Reassign selected' });
    reassign.addEventListener('click', function () {
      var ids = Array.from(reassignSelection);
      if (!ids.length) { ui.toast('Select at least one resource.', 'warn'); return; }
      var destName = toTeamSelect.options[toTeamSelect.selectedIndex] ? toTeamSelect.options[toTeamSelect.selectedIndex].text : '(unresolved queue)';
      ui.confirm({
        title: 'Reassign resources',
        body: 'Move ' + ids.length + ' resource(s) to ' + destName + '.',
        confirmLabel: 'Reassign'
      }).then(function (confirmed) {
        if (!confirmed) return;
        reassign.disabled = true;
        NDocsTransport.call('admin_reassign_resources', { resourceIds: ids, toTeamId: toTeamSelect.value || undefined })
          .then(function (result) {
            reassign.disabled = false;
            ui.toast('Applied: ' + result.applied.length + ', skipped: ' + result.skipped.length + '.', 'info');
            load();
          }).catch(function (err) {
            reassign.disabled = false;
            ui.toast('Could not reassign: ' + err.message, 'warn');
          });
      });
    });
    return ui.el('div', { class: 'surface' }, [
      ui.el('div', { class: 'field' }, [
        ui.el('label', { for: 'ndocs-bulk-reassign-team', text: 'Reassign selected resources (administrator)' }),
        toTeamSelect
      ]),
      ui.el('div', { class: 'button-row' }, [reassign])
    ]);
  }

  // ---- findings — separate maintenance section ----

  function renderFindings(findings) {
    findingsEl.textContent = '';
    var summary = ui.el('summary', {}, [
      document.createTextNode('Open findings'),
      ui.el('span', { class: 'summary-meta', text: findings.length + ' open' })
    ]);
    var body;
    if (!findings.length) {
      body = ui.el('div', { class: 'disclosure-content' }, [
        ui.el('div', { class: 'empty-state' }, [ui.el('p', { text: 'No open findings.' })])
      ]);
    } else {
      var list = ui.el('div', {});
      findings.forEach(function (f) {
        var select = ui.el('select', { 'aria-label': 'Resolution for ' + f.kind });
        FINDING_RESOLUTIONS.forEach(function (r) { select.appendChild(ui.el('option', { value: r, text: r })); });
        var note = ui.el('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Resolution note' });
        var button = ui.el('button', { type: 'button', class: 'button', text: 'Resolve' });
        button.addEventListener('click', function () {
          NDocsTransport.call('resolve_finding', {
            findingId: f.finding_id, rev: f.rev, resolution: select.value, note: note.value || undefined
          }).then(function () {
            ui.announce('Finding resolved.');
            ui.toast('Finding resolved.', 'info');
            load();
          }).catch(function (err) { ui.toast('Could not resolve: ' + err.message, 'warn'); });
        });
        var resourceLink = f.resource_id
          ? ui.el('a', { href: 'resource.html?id=' + encodeURIComponent(f.resource_id), text: f.resource_id })
          : ui.el('span', { text: '—' });
        list.appendChild(ui.el('div', { class: 'status-panel status-panel--danger' }, [
          ui.el('div', {}, [
            ui.el('strong', { text: f.kind }),
            ui.el('p', {}, [document.createTextNode('Resource: '), resourceLink, document.createTextNode(' · detected ' + NDocsRecords.dateOrDash(f.detected_at))])
          ]),
          ui.el('div', { class: 'button-row' }, [select, note, button])
        ]));
      });
      body = ui.el('div', { class: 'disclosure-content' }, [list]);
    }
    var details = ui.el('details', { class: 'disclosure', id: 'findings' }, [summary, body]);
    if (findings.length) details.open = true;
    openIfLinked(details);
    findingsEl.appendChild(details);
  }

  // ---- certify panel ----

  function renderCertify(cycle, entries) {
    certifyEl.textContent = '';
    latestCycle = cycle;
    if (cycle.state === 'certified_empty') {
      renderTasks();
      return;
    }
    var rows = [];
    var table = ui.el('table', { class: 'ndocs-table' });
    var thead = ui.el('thead', {}, [ui.el('tr', {}, [
      ui.el('th', { text: 'Confirmed' }), ui.el('th', { text: 'Title' }), ui.el('th', { text: 'Doc ID' }),
      ui.el('th', { text: 'Open findings' }), ui.el('th', { text: 'Disposition' }),
      ui.el('th', { text: 'Successor / note' })
    ])]);
    var tbody = ui.el('tbody', {});

    entries.forEach(function (entry) {
      var record = entry.record;
      var checkbox = ui.el('input', { type: 'checkbox', checked: 'checked', 'aria-label': 'Confirm ' + record.title });
      var select = ui.el('select', { disabled: 'disabled', 'aria-label': 'Disposition for ' + record.title });
      select.appendChild(ui.el('option', { value: '', text: '—' }));
      CERT_DISPOSITIONS.forEach(function (d) { select.appendChild(ui.el('option', { value: d, text: d })); });
      var successor = ui.el('input', { type: 'text', placeholder: 'Successor resource id', disabled: 'disabled' });
      var note = ui.el('input', { type: 'text', placeholder: 'Note', disabled: 'disabled' });

      checkbox.addEventListener('change', function () {
        var confirmed = checkbox.checked;
        select.disabled = confirmed;
        successor.disabled = confirmed;
        note.disabled = confirmed;
        if (confirmed) { select.value = ''; successor.value = ''; }
      });

      tbody.appendChild(ui.el('tr', {}, [
        ui.el('td', {}, [checkbox]),
        ui.el('td', { text: record.title }),
        ui.el('td', { text: record.doc_id }),
        ui.el('td', { text: String((entry.openFindings || []).length) }),
        ui.el('td', {}, [select]),
        ui.el('td', {}, [successor, note])
      ]));

      rows.push({ resourceId: record.resource_id, checkbox: checkbox, select: select, successor: successor, note: note });
    });

    table.appendChild(thead);
    table.appendChild(tbody);

    var submit = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Submit certification' });
    submit.addEventListener('click', function () {
      var confirmedIds = [];
      var exceptions = [];
      var invalid = false;

      rows.forEach(function (row) {
        if (row.checkbox.checked) { confirmedIds.push(row.resourceId); return; }
        if (!row.select.value) { invalid = true; return; }
        if (row.select.value === 'superseded' && !row.successor.value) { invalid = true; return; }
        exceptions.push({
          resourceId: row.resourceId, disposition: row.select.value,
          note: row.note.value || undefined, successorId: row.successor.value || undefined
        });
      });

      if (invalid) {
        ui.toast('Every unchecked resource needs a disposition (and a successor for "superseded").', 'warn');
        return;
      }

      submit.disabled = true;
      NDocsTransport.call('certify_resources', {
        teamId: currentTeamId, cycleId: cycle.cycle_id, confirmedIds: confirmedIds, exceptions: exceptions
      }).then(function () {
        ui.announce('Certification submitted.');
        ui.toast('Certification submitted.', 'info');
        load();
      }).catch(function (err) {
        submit.disabled = false;
        ui.toast('Could not submit: ' + err.message, 'warn');
      });
    });

    var overdue = cycle.due_at && new Date(cycle.due_at).getTime() < Date.now();
    var summary = ui.el('summary', {}, [
      document.createTextNode('Certify this inventory'),
      ui.el('span', { class: 'summary-meta', text: cycle.state + (cycle.due_at ? ' · due ' + new Date(cycle.due_at).toLocaleDateString() : '') })
    ]);
    var details = ui.el('details', { class: 'disclosure', id: 'certify' }, [
      summary,
      ui.el('div', { class: 'disclosure-content' }, [
        ui.el('p', { text: 'Cycle ' + cycle.state + (cycle.due_at ? ' — due ' + new Date(cycle.due_at).toLocaleDateString() : '') + '. Every resource below starts confirmed; uncheck one to record an exception instead.' }),
        table,
        ui.el('div', { class: 'button-row' }, [submit])
      ])
    ]);
    // Open when this is an active task (matches the "Certify now" task card's own overdue/due
    // condition, `renderTasks`) — never open for a routine, not-yet-due cycle by default.
    if (overdue || cycle.state !== 'certified') details.open = true;
    openIfLinked(details);
    certifyEl.appendChild(details);
    renderTasks();
  }

  // ---- scan candidates panel ----

  function driveFileUrl(fileId) { return 'https://drive.google.com/open?id=' + encodeURIComponent(fileId); }
  function driveFolderUrl(folderId) { return 'https://drive.google.com/drive/folders/' + encodeURIComponent(folderId); }

  // Groups in first-occurrence order (candidates already arrive sorted by `first_seen_at` —
  // `ScanService_listCandidates` — so this doesn't re-sort within a folder) so the folder
  // itself is said once, not per document (2026-09-19, vertical-space pass).
  function groupCandidatesByFolder(candidates) {
    var order = [];
    var byKey = {};
    candidates.forEach(function (c) {
      var key = c.drive_folder_id || c.drive_folder_path || c.drive_folder_name || '(none)';
      if (!byKey[key]) {
        byKey[key] = { folderId: c.drive_folder_id, folderName: c.drive_folder_name, folderPath: c.drive_folder_path, items: [] };
        order.push(key);
      }
      byKey[key].items.push(c);
    });
    return order.map(function (key) { return byKey[key]; });
  }

  // One candidate row — compact: a linked filename, one meta line (modified date/by), the
  // reason ONLY when it's not the generic proposed-queue boilerplate (every `proposed`
  // candidate carries the identical "New document in a tracked folder..." text — showing it
  // once per row said nothing an entry-by-entry read needed), then the disposition controls.
  // `proposed` gets the full Register form; `ignored`/`unevaluable` get Dismiss only —
  // `register_resource`'s `fromCandidateId` refuses server-side on any other `triage_state`.
  function renderCandidateRow(c, state, vocab) {
    var dismissFile = ui.el('button', { type: 'button', class: 'button', text: 'Dismiss this file' });
    dismissFile.addEventListener('click', function () { dismiss(c, 'file', dismissFile); });
    var dismissFolder = ui.el('button', { type: 'button', class: 'button', text: 'Dismiss everything in this folder' });
    dismissFolder.addEventListener('click', function () {
      ui.confirm({
        title: 'Dismiss this folder', danger: true,
        body: 'Stop scanning "' + (c.drive_folder_name || c.drive_folder_id) + '" for this team entirely?',
        confirmLabel: 'Dismiss folder'
      }).then(function (confirmed) { if (confirmed) dismiss(c, 'folder', dismissFolder); });
    });

    var nameLink = c.drive_file_id
      ? ui.el('a', { href: driveFileUrl(c.drive_file_id), target: '_blank', rel: 'noopener', class: 'section-title', text: c.drive_filename })
      // `<a>`/`<strong>`, never a heading — same choice `renderFindings`'s row title makes
      // (`f.kind`): the disclosure `<summary>` above is not itself a heading, so an `<h3>` here
      // would skip level 2 for a non-admin viewer (`tests/journeys/ux-a11y.spec.js`'s "no
      // skipped heading level" check, already broken once by this exact page/pattern).
      : ui.el('strong', { class: 'section-title', text: c.drive_filename });

    var metaBits = [];
    var typeLabel = NDocsRecords.mimeTypeLabel(c.mime_type);
    if (typeLabel) metaBits.push(typeLabel);
    metaBits.push('Modified ' + NDocsRecords.dateOrDash(c.drive_modified_at));
    if (c.drive_modified_by) metaBits.push('by ' + c.drive_modified_by);

    var titleRow = [nameLink];
    if (state !== 'proposed') titleRow.push(ui.el('span', { class: 'badge badge--info', text: CANDIDATE_STATE_LABELS[state] || state }));

    var children = [
      ui.el('div', { class: 'badges' }, titleRow),
      ui.el('p', { class: 'field-help', text: metaBits.join(' · ') })
    ];
    if (state !== 'proposed' && c.reason) children.push(ui.el('p', { class: 'field-help', text: c.reason }));

    if (state === 'proposed') {
      var proposed = c.proposed_fields || {};
      // Same fallback `RegistryService_inspect` applies for manual URL registration
      // (src/RegistryService.js:110-112, "never hand the human a blank field when a name
      // already exists") — applied here client-side only, as the form's starting value, since
      // ScanService's `proposed_fields.title` intentionally stays unset server-side (a
      // filename match there would skew dedup/judging).
      var fallbackTitle = proposed.title ? '' : (c.drive_filename || '');
      var titleInput = ui.el('input', { type: 'text', value: proposed.title || fallbackTitle, 'aria-label': 'Title for ' + c.drive_filename });
      if (!proposed.title && !fallbackTitle) titleInput.placeholder = 'No title found — give it one';
      var purposeInput = ui.el('input', { type: 'text', value: proposed.purpose || '', 'aria-label': 'Purpose for ' + c.drive_filename });
      var typeSelect = ui.el('select', { 'aria-label': 'Type for ' + c.drive_filename });
      (vocab.type || []).forEach(function (t) { typeSelect.appendChild(ui.el('option', { value: t, text: t })); });
      var audienceSelect = ui.el('select', { 'aria-label': 'Audience for ' + c.drive_filename });
      (vocab.audience || []).forEach(function (a) { audienceSelect.appendChild(ui.el('option', { value: a, text: a })); });

      var promote = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Register' });
      promote.addEventListener('click', function () {
        if (!titleInput.value) { ui.toast('Title is required.', 'warn'); return; }
        promote.disabled = true;
        NDocsTransport.call('register_resource', {
          teamId: currentTeamId, fromCandidateId: c.candidate_id,
          fields: { title: titleInput.value, purpose: purposeInput.value, type: typeSelect.value, audience: audienceSelect.value },
          derived: {}
        }).then(function (result) {
          ui.announce('Registered ' + result.record.doc_id + '.');
          ui.toast('Registered ' + result.record.doc_id + '.', 'info');
          loadCandidates(currentCandidateState);
        }).catch(function (err) {
          promote.disabled = false;
          if (err.code === 'validation_failed') {
            ui.toast('Fix these fields: ' + ((err.data && err.data.fields) || []).join(', '), 'warn');
            return;
          }
          ui.toast('Could not register: ' + err.message, 'warn');
        });
      });

      children.push(
        ui.el('div', { class: 'form-grid' }, [
          ui.el('div', { class: 'field' }, [ui.el('label', { text: 'Title' }), titleInput]),
          ui.el('div', { class: 'field' }, [ui.el('label', { text: 'Purpose' }), purposeInput]),
          ui.el('div', { class: 'field' }, [ui.el('label', { text: 'Type' }), typeSelect]),
          ui.el('div', { class: 'field' }, [ui.el('label', { text: 'Audience' }), audienceSelect])
        ]),
        ui.el('div', { class: 'button-row' }, [promote, dismissFile, dismissFolder])
      );
    } else {
      // Ignored/unevaluable — a rule already decided this isn't ready to register (or can't be
      // read at all); the only meaningful disposition here is silencing it, same as `proposed`.
      children.push(ui.el('div', { class: 'button-row' }, [dismissFile, dismissFolder]));
    }

    return ui.el('div', { class: 'candidate-row' }, children);
  }

  // One folder's documents, nested inside the candidates disclosure the same way Inventory
  // nests per-folder `<details>` inside `#inventory` — the folder is said once, in a header
  // that is itself a link to the Drive folder, not repeated on every document underneath.
  function renderCandidateFolderGroup(group, state, vocab) {
    var label = group.folderId ? (group.folderName || group.folderId) : 'Unresolved folder';
    var labelNode = group.folderId
      ? ui.el('a', { href: driveFolderUrl(group.folderId), target: '_blank', rel: 'noopener', text: label })
      : document.createTextNode(label);
    if (group.folderId) {
      // A link inside a `<summary>` would otherwise also toggle the disclosure on click
      // (the click bubbles to `<summary>`'s default handler) — stop it there so opening the
      // folder in Drive and expanding the list are two independent actions, not one that does
      // both at once.
      labelNode.addEventListener('click', function (e) { e.stopPropagation(); });
    }
    var summary = ui.el('summary', {}, [
      labelNode,
      ui.el('span', { class: 'summary-meta', text: group.items.length + ' document' + (group.items.length === 1 ? '' : 's') })
    ]);
    var content = ui.el('div', { class: 'disclosure-content' });
    group.items.forEach(function (c) { content.appendChild(renderCandidateRow(c, state, vocab)); });
    return ui.el('details', { class: 'disclosure', open: 'open' }, [summary, content]);
  }

  function renderCandidates(candidates, state) {
    state = state || 'proposed';
    currentCandidateState = state;
    candidatesEl.textContent = '';
    if (state === 'proposed') latestCandidateCount = candidates.length;

    var scanButton = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Scan for new' });
    scanButton.addEventListener('click', function () {
      scanButton.disabled = true;
      NDocsTransport.call('scan_folders', { teamId: currentTeamId }).then(function (result) {
        scanButton.disabled = false;
        var msg = 'Scanned ' + result.scanned + ' — ' + result.proposed + ' new, ' +
          result.ignored + ' ignored, ' + result.skippedUnchanged + ' unchanged.';
        ui.announce(msg);
        ui.toast(msg, 'info');
        loadCandidates(currentCandidateState);
      }).catch(function (err) {
        scanButton.disabled = false;
        ui.toast('Could not scan: ' + err.message, 'warn');
      });
    });

    var stateSelect = ui.el('select', { id: 'ndocs-candidate-state', 'aria-label': 'Candidate state to show' });
    CANDIDATE_STATES.forEach(function (s) {
      var opt = ui.el('option', { value: s, text: CANDIDATE_STATE_LABELS[s] });
      if (s === state) opt.setAttribute('selected', 'selected');
      stateSelect.appendChild(opt);
    });
    stateSelect.addEventListener('change', function () { loadCandidates(stateSelect.value); });

    var body;
    if (!candidates.length) {
      body = ui.el('div', { class: 'empty-state' }, [
        ui.el('p', {
          text: state === 'proposed'
            ? 'Nothing waiting for review. Scan to look for new documents.'
            : 'No candidates in this state right now.'
        })
      ]);
    } else {
      var vocab = (NDocsVocab.current() && NDocsVocab.current().vocab) || {};
      var list = ui.el('div', {});
      groupCandidatesByFolder(candidates).forEach(function (group) {
        list.appendChild(renderCandidateFolderGroup(group, state, vocab));
      });
      body = list;
    }

    var summary = ui.el('summary', {}, [
      document.createTextNode('Uncatalogued documents found by scanning'),
      ui.el('span', { class: 'summary-meta', text: candidates.length + ' ' + (CANDIDATE_STATE_LABELS[state] || state).toLowerCase() })
    ]);
    var details = ui.el('details', { class: 'disclosure', id: 'candidates' }, [
      summary,
      ui.el('div', { class: 'disclosure-content' }, [
        ui.el('div', { class: 'button-row' }, [scanButton]),
        ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-candidate-state', text: 'Show' }), stateSelect]),
        body
      ])
    ]);
    // Open when there's a proposed-queue task (matches the "Review" task card) or when a state
    // switch/deep link is what got us here in the first place.
    if (state === 'proposed' && candidates.length > 0) details.open = true;
    if (state !== 'proposed') details.open = true;
    openIfLinked(details);
    candidatesEl.appendChild(details);
    renderTasks();
  }

  function dismiss(candidate, scope, button) {
    button.disabled = true;
    NDocsTransport.call('dismiss_candidate', { candidateId: candidate.candidate_id, rev: candidate.rev, scope: scope }).then(function () {
      ui.announce('Dismissed.');
      ui.toast('Dismissed.', 'info');
      loadCandidates(currentCandidateState);
    }).catch(function (err) {
      button.disabled = false;
      ui.toast('Could not dismiss: ' + err.message, 'warn');
    });
  }

  function loadCandidates(state) {
    state = state || 'proposed';
    NDocsShell.region(candidatesEl, 'loading', { loadingText: 'Loading scan candidates…' });
    NDocsTransport.call('admin_list_candidates', { teamId: currentTeamId, triageState: state }).then(function (data) {
      renderCandidates(data.candidates, state);
    }).catch(function (err) {
      if (err.name === 'NotAuthorized') {
        candidatesEl.textContent = ''; // same team-membership gate as list_team_inventory — a refusal there already shows.
        return;
      }
      NDocsShell.region(candidatesEl, 'error', { message: 'Could not load scan candidates: ' + err.message, onRetry: function () { loadCandidates(state); } });
    });
  }

  function loadCertify() {
    NDocsTransport.call('get_certification', { teamId: currentTeamId }).then(function (data) {
      renderCertify(data.cycle, data.entries);
    }).catch(function (err) {
      certifyEl.textContent = '';
      latestCycle = null;
      if (err.code === 'not_found') { renderTasks(); return; } // no open cycle — a quiet, expected state
      if (err.name === 'NotAuthorized') { renderTasks(); return; } // membership refusal already shown by the inventory panel
      NDocsShell.region(certifyEl, 'error', { message: 'Could not load certification: ' + err.message, onRetry: loadCertify });
    });
  }

  function load() {
    NDocsShell.region(inventoryEl, 'loading', { loadingText: 'Loading inventory…' });
    NDocsTransport.call('list_team_inventory', { teamId: currentTeamId, groupBy: 'folder' }).then(function (data) {
      renderSummary(data.team);
      renderInventory(data, currentPrincipal);
    }).catch(function (err) {
      summaryEl.textContent = '';
      if (err.name === 'NotAuthorized') {
        NDocsShell.region(inventoryEl, 'permission-denied', { message: 'You are not a member of this team.' });
        return;
      }
      NDocsShell.region(inventoryEl, 'error', { message: 'Team not found or could not be loaded.', onRetry: load });
    });

    NDocsTransport.call('list_findings', { teamId: currentTeamId, state: 'open' }).then(function (data) {
      renderFindings(data.findings);
    }).catch(function () {
      // Same team-membership gate as list_team_inventory above; a refusal already shows there.
    });

    loadCertify();
    loadCandidates();
  }

  function init() {
    summaryEl = document.getElementById('ndocs-team-summary');
    tasksEl = document.getElementById('ndocs-team-tasks');
    inventoryEl = document.getElementById('ndocs-team-inventory');
    findingsEl = document.getElementById('ndocs-team-findings');
    certifyEl = document.getElementById('ndocs-team-certify');
    candidatesEl = document.getElementById('ndocs-team-candidates');

    currentTeamId = teamIdFromQuery();
    if (!currentTeamId) {
      NDocsShell.region(inventoryEl, 'error', { message: 'No team in the link.' });
      return Promise.resolve();
    }

    // The candidate promote form's type/audience selects, and the bulk-reassign destination
    // select, need the vocabulary — loaded once here, same "load() once per session" contract
    // page-search.js/page-resource.js already follow.
    NDocsVocab.load().catch(function () { /* degrades to empty selects */ });

    return NDocsTransport.call('whoami', {}).then(function (principal) {
      NDocsSession.setPrincipal(principal);
      currentPrincipal = principal;
      load();
      return principal;
    });
  }

  // Same "the page decides when a session exists" contract as page-search.js/
  // page-resource.js (Stage 6, `NDocs-2a9`).
  window.NDocsPageTeam = { start: init };
})();
