// app/page-team.js — team.html controller (Stage 15.6, `NDocs-c71`; disclosure-section pass
// 2026-09-19; persistent-shell/grouped-table pass 2026-09-20, `NDocs-ei1`). Rebuilt onto the
// shared UI system (ADR-0012): team entity summary panel; admin-only Team Settings, Inventory,
// Scanning, and Certification are each a deep-linkable `NDocsShell.section()` disclosure
// (`#team-settings`, `#inventory`, `#candidates`, `#certify`), same convention as `tools.html`
// ("never a tab widget", ux-components.md) — a team with many folders/candidates never forces
// one giant always-open page. Every section's shell renders synchronously before its data is
// fetched, with a "loading…"/"syncing…" indicator in its summary count slot while the fetch is
// outstanding (`NDocs-ei1`) — no section is ever silently absent while the page loads. Inventory
// is one Grouped listing table, rows grouped by folder (alphabetized), not a `<details>` nested
// per folder — see ux-components.md's Grouped listing table component. "Needs your attention"
// task cards (open certification only) are ordered by urgency and absent entirely when there is
// no work — not shown empty. Open findings is a separate maintenance disclosure (`#findings`);
// scan job state announced via `NDocsUI.announce`. Calls whoami, list_team_inventory,
// list_findings, get_certification, certify_resources, admin_list_candidates, scan_folders,
// dismiss_candidate, register_resource, admin_set_team_state, admin_reassign_resources,
// affirm_current, add_note, bulk_retire.
//
// The inventory selection drives a Bulk action bar (`NDocs-82s.7`, ux-components.md §Bulk
// action bar) rather than the single admin-only reassign control this page carried before:
// confirm-still-current, add-a-comment and archive are `teamMember` routes, so every team
// member selects rows; only Reassign is admin-only and it is absent, not disabled, for anyone
// else. Supersession stays on resource.html — it needs a successor per document.
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
  var summaryEl, settingsEl, tasksEl, inventoryEl, certifyEl, candidatesEl, findingsEl;
  var currentTeamId, currentPrincipal;
  // Every disclosure section's persistent shell (NDocsShell.section, `NDocs-ei1`) — built
  // once in `buildSections()`, before any fetch, so no section is ever absent from the page
  // while its data loads. `summaryEl`/`tasksEl` are not disclosures (ux-components.md "loading
  // is shown on the summary line... region-loading in the body applies only to non-disclosure
  // regions") and stay on `NDocsShell.region` directly.
  var sections = {};
  var FINDING_RESOLUTIONS = ['accept', 'reject', 'fixed', 'wont_fix'];
  var CERT_DISPOSITIONS = ['superseded', 'archived', 'withdrawn'];
  var TEAM_STATES = ['active', 'inactive', 'merged'];
  var CANDIDATE_STATES = ['proposed', 'ignored', 'unevaluable'];
  var CANDIDATE_STATE_LABELS = { proposed: 'Waiting review', ignored: 'Ignored by scan', unevaluable: 'Unevaluable' };
  var latestCycle = null;
  // The records the inventory last drew, so a bulk confirmation can name the selected ones by
  // Doc ID and title without re-fetching them.
  var latestRecords = [];
  var currentCandidateState = 'proposed';
  // The inventory selection the Bulk action bar acts on (`NDocs-82s.7`). Cleared on every
  // re-render `renderInventory` draws — the bar's own disabled state is derived from this Set's
  // size through `NDocsRecords`' `onSelectionChange`, never from a separately tracked count.
  var inventorySelection = new Set();
  var bulkBar = null;

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
    summaryEl.textContent = '';
    summaryEl.appendChild(ui.el('div', { class: 'entity-summary' }, [top, meta]));

    // Team Settings (admin-only) is a persistent disclosure shell (`sections.settings`, built
    // once in `buildSections`), not part of the summary render — `whoami` (already resolved by
    // the time `load()` runs) decides whether it stays.
    if (currentPrincipal && currentPrincipal.isAdmin) {
      sections.settings.populate(renderTeamStateControl(team), '');
    } else {
      sections.settings.remove();
    }
  }

  // Content ONLY — no kicker/h2/wrapper of its own. Those used to be needed because this
  // rendered directly after the entity summary's h1 as a bare `.surface`; now it fills
  // `sections.settings`'s disclosure body, whose `<summary>Team Settings</summary>` already
  // says what this is (ux-components.md "logical heading order" is unaffected — there is
  // nothing here that could skip a level).
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
    return ui.el('div', {}, [
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
    // No task card for waiting scan candidates (NDocs-fkm/2): the "Uncatalogued documents
    // found by scanning" disclosure just below already carries the same count in its own
    // summary line and auto-opens whenever candidates are proposed
    // (`renderCandidates`'s `if (state === 'proposed' && candidates.length > 0) details.open =
    // true`) — a second card here said nothing that section doesn't already say on its own.

    tasksEl.textContent = '';
    if (!cards.length) return; // absent entirely when there is no work — never shown empty
    tasksEl.appendChild(ui.el('div', { class: 'section-kicker', text: 'Needs your attention' }));
    tasksEl.appendChild(ui.el('div', { class: 'task-grid' }, cards));
  }

  // ux-components.md "loading is shown on the summary line... region-loading in the body
  // applies only to non-disclosure regions" — Tasks is not a disclosure (it is deliberately
  // absent, not collapsed, when there is no work), so it gets a plain `region()` loading state
  // rather than a `NDocsShell.section()` shell. `renderTasks` (called once `latestCycle` is
  // known) always replaces this, whether or not it ends up rendering any cards.
  function renderTasksLoading() {
    NDocsShell.region(tasksEl, 'loading', { loadingText: 'Checking for pending work…' });
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

  // Alphabetical, locale-aware, "Folder 2" before "Folder 10" — `sensitivity: 'base'` so case
  // never reshuffles the list. The unresolved folder (no `folderId`) has no name to sort by
  // and stays last, matching where it already sorted under the old first-occurrence order.
  var FOLDER_COLLATOR = (typeof Intl !== 'undefined' && Intl.Collator)
    ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
    : null;

  function renderInventory(data, principal) {
    inventorySelection.clear();
    bulkBar = null;
    latestRecords = data.records || [];
    if (!data.records.length) {
      sections.inventory.empty({ message: 'This team has no catalogued resources yet.', meta: '0 resources' });
      return;
    }
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
    var resolvedFolders = data.folders.filter(function (f) { return f.folderId; }).slice();
    var unresolvedFolder = data.folders.filter(function (f) { return !f.folderId; })[0];
    if (FOLDER_COLLATOR) {
      resolvedFolders.sort(function (a, b) {
        return FOLDER_COLLATOR.compare(a.name || a.folderId, b.name || b.folderId);
      });
    }
    var ordered = unresolvedFolder ? resolvedFolders.concat([unresolvedFolder]) : resolvedFolders;

    var groups = ordered.map(function (folder) {
      var labelNode = folder.folderId
        ? (folder.url
          ? ui.el('a', { class: 'ndocs-folder', href: folder.url, title: folder.path || folder.name || folder.folderId, target: '_blank', rel: 'noopener', text: folder.name || folder.folderId })
          : ui.el('span', { class: 'ndocs-folder', title: folder.path || folder.name || folder.folderId, text: folder.name || folder.folderId }))
        : ui.el('span', { class: 'ndocs-folder ndocs-folder--unresolved', text: 'Unresolved folder' });
      return { labelNode: labelNode, count: folder.count, records: byFolder[folder.folderId || ''] || [] };
    });

    // Selection is offered to every team member, not only an admin: the lifecycle actions in
    // the bar (confirm current, comment, archive) are `teamMember` routes. Which actions appear
    // over the selection is the bar's decision, not the table's (ux-components.md).
    var body = ui.el('div', {}, [
      NDocsRecords.groupedResultsTable(groups, {
        hideFolder: true, findingCounts: openCounts,
        selectable: true, selectedIds: inventorySelection,
        onSelectionChange: function (count) { if (bulkBar) bulkBar.setCount(count); }
      })
    ]);
    body.appendChild(renderBulkActions(isAdmin));

    var metaText = data.records.length + ' resource' + (data.records.length === 1 ? '' : 's');
    sections.inventory.populate(body, metaText);
    // The dominant content of the page (ux-components.md's "inventory-by-folder as the
    // dominant section card") — stays open (set at shell construction), unlike Scanning/
    // Certification which only open when there's a task or a deep link.
  }

  // ---- bulk action bar (ux-components.md §Bulk action bar, `NDocs-82s.7`) ----

  // One bar over the inventory selection, replacing the single hardcoded reassign control this
  // page used to carry. Order is the Action bar's: primary, secondary, admin-only, then the
  // destructive one with visible separation. Every action opens the Confirmation dialog naming
  // the affected records first (ADR-0012 §8 — bulk and destructive operations require a review
  // step) and reports applied/skipped counts, never a bare "done".
  //
  // With nothing selected every action is `disabled`, so the bar states the precondition before
  // the click rather than toasting "select at least one" after it. An action the viewer is not
  // entitled to — Reassign, administrator-only — is ABSENT, not disabled: a disabled control
  // here means "nothing is selected" and the two must not be confused.
  //
  // Supersession is deliberately not here: it needs a successor per document
  // (`bulk_retire` refuses `superseded`), so it stays on resource.html.
  function renderBulkActions(isAdmin) {
    var countEl = ui.el('span', { class: 'ndocs-bulk-bar__count', role: 'status', text: '0 selected' });
    var actions = [];

    function action(spec) {
      var button = ui.el('button', { type: 'button', class: spec.class || 'button', text: spec.label });
      button.disabled = true;
      button.addEventListener('click', function () { spec.run(button); });
      actions.push(button);
      return button;
    }

    // `selectedRecords()` is read at click time, not at render time: the selection changes
    // under the bar without it being rebuilt.
    function selectedIds() { return Array.from(inventorySelection); }

    function confirmThen(spec, run) {
      var ids = selectedIds();
      if (!ids.length) return;
      ui.confirm({
        title: spec.title,
        body: [ui.el('p', { text: spec.consequence }), affectedList(ids)].concat(spec.extra || []),
        confirmLabel: spec.confirmLabel,
        danger: !!spec.danger
      }).then(function (confirmed) {
        if (confirmed) run(ids);
      });
    }

    function call(actionName, payload, verb) {
      setBusy(true);
      NDocsTransport.call(actionName, payload)
        .then(function (result) {
          setBusy(false);
          var applied = (result.applied || []).length;
          var skipped = (result.skipped || []).length;
          var message = verb + ' ' + applied + ' resource' + (applied === 1 ? '' : 's') +
            (skipped ? ', skipped ' + skipped : '') + '.';
          ui.announce(message);
          ui.toast(message, skipped ? 'warn' : 'info');
          load();
        })
        .catch(function (err) {
          setBusy(false);
          ui.toast('Could not ' + verb.toLowerCase() + ': ' + err.message, 'warn');
        });
    }

    var affirm = action({
      label: 'Confirm still current', class: 'button button--primary',
      run: function () {
        confirmThen({
          title: 'Confirm still current',
          consequence: 'This records today as the date these were last confirmed current. It does not change when the team\'s next review is due.',
          confirmLabel: 'Confirm still current'
        }, function (ids) {
          call('affirm_current', { teamId: currentTeamId, resourceIds: ids }, 'Confirmed');
        });
      }
    });

    var comment = action({
      label: 'Add comment…',
      run: function () {
        var noteInput = ui.el('input', { type: 'text', id: 'ndocs-bulk-note', 'aria-label': 'Comment' });
        var field = ui.el('div', { class: 'field' }, [
          ui.el('label', { for: 'ndocs-bulk-note', text: 'Comment' }), noteInput
        ]);
        confirmThen({
          title: 'Add a comment',
          consequence: 'The comment is recorded against each of these documents and shown with the record. It is not a problem report and nobody has to clear it.',
          confirmLabel: 'Add comment',
          extra: [field]
        }, function (ids) {
          if (!noteInput.value) { ui.toast('Enter a comment first.', 'warn'); return; }
          call('add_note', { teamId: currentTeamId, resourceIds: ids, note: noteInput.value }, 'Commented on');
        });
      }
    });

    var reassignSelect = null;
    var reassignButton = null;
    if (isAdmin) {
      reassignSelect = ui.el('select', { id: 'ndocs-bulk-reassign-team', 'aria-label': 'Reassign to team' });
      reassignSelect.appendChild(ui.el('option', { value: '', text: '(unresolved queue)' }));
      var vocabData = NDocsVocab.current();
      (vocabData && vocabData.teams || []).forEach(function (t) {
        reassignSelect.appendChild(ui.el('option', { value: t.teamId, text: t.name }));
      });
      reassignButton = action({
        label: 'Reassign…',
        run: function () {
          var destName = reassignSelect.options[reassignSelect.selectedIndex]
            ? reassignSelect.options[reassignSelect.selectedIndex].text : '(unresolved queue)';
          confirmThen({
            title: 'Reassign resources',
            consequence: 'These move to ' + destName + '. Each keeps its Doc ID, which then names the team it came from (ADR-0004).',
            confirmLabel: 'Reassign'
          }, function (ids) {
            call('admin_reassign_resources', { resourceIds: ids, toTeamId: reassignSelect.value || undefined }, 'Reassigned');
          });
        }
      });
    }

    var archiveDisposition = ui.el('select', { id: 'ndocs-bulk-disposition', 'aria-label': 'Disposition' });
    ['archived', 'withdrawn'].forEach(function (d) {
      archiveDisposition.appendChild(ui.el('option', { value: d, text: d }));
    });
    var archive = action({
      label: 'Archive…', class: 'button button--danger',
      run: function () {
        var reasonInput = ui.el('input', { type: 'text', id: 'ndocs-bulk-reason', 'aria-label': 'Reason' });
        confirmThen({
          title: 'Retire resources',
          consequence: 'These stop appearing in the default catalog search and no longer certify. Superseding one document by another is done on its own record, not here.',
          confirmLabel: 'Retire resources',
          danger: true,
          extra: [
            ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-bulk-disposition', text: 'Disposition' }), archiveDisposition]),
            ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-bulk-reason', text: 'Reason' }), reasonInput])
          ]
        }, function (ids) {
          call('bulk_retire', {
            teamId: currentTeamId, resourceIds: ids,
            disposition: archiveDisposition.value,
            reason: reasonInput.value || 'Retired from the team inventory'
          }, 'Retired');
        });
      }
    });

    function setBusy(busy) {
      actions.forEach(function (b) { b.disabled = busy || inventorySelection.size === 0; });
      if (reassignSelect) reassignSelect.disabled = busy;
    }

    var row = [countEl];
    if (reassignSelect) {
      row.push(ui.el('div', { class: 'field field--inline' }, [
        ui.el('label', { for: 'ndocs-bulk-reassign-team', text: 'Reassign to' }), reassignSelect
      ]));
    }
    var bar = ui.el('div', {
      class: 'surface ndocs-bulk-bar', role: 'group', 'aria-label': 'Bulk actions'
    }, [
      ui.el('div', { class: 'ndocs-bulk-bar__status' }, row),
      ui.el('div', { class: 'button-row' }, [affirm, comment].concat(reassignButton ? [reassignButton] : [])),
      ui.el('div', { class: 'button-row actions-danger' }, [archive])
    ]);

    bulkBar = {
      setCount: function (count) {
        countEl.textContent = count + ' selected';
        actions.forEach(function (b) { b.disabled = count === 0; });
      }
    };
    bulkBar.setCount(inventorySelection.size);
    return bar;
  }

  // The affected-records list every bulk confirmation carries (ux-components.md: named by Doc ID
  // and title, capped, with "and N more" beyond the cap) — the review step, not decoration.
  var BULK_CONFIRM_LIST_CAP = 8;
  function affectedList(ids) {
    var byId = {};
    (latestRecords || []).forEach(function (r) { byId[r.resource_id] = r; });
    var list = ui.el('ul', { class: 'ndocs-bulk-affected' });
    ids.slice(0, BULK_CONFIRM_LIST_CAP).forEach(function (id) {
      var record = byId[id];
      list.appendChild(ui.el('li', {
        text: record ? ((record.doc_id ? record.doc_id + ' — ' : '') + record.title) : id
      }));
    });
    if (ids.length > BULK_CONFIRM_LIST_CAP) {
      list.appendChild(ui.el('li', { class: 'summary-meta', text: 'and ' + (ids.length - BULK_CONFIRM_LIST_CAP) + ' more' }));
    }
    return list;
  }

  // ---- findings — separate maintenance section ----

  function renderFindings(findings) {
    if (!findings.length) {
      sections.findings.empty({ message: 'No open findings.', meta: '0 open' });
      return;
    }
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
    sections.findings.populate(list, findings.length + ' open');
    sections.findings.expand();
  }

  // ---- certify panel ----

  function renderCertify(cycle, entries) {
    latestCycle = cycle;
    if (cycle.state === 'certified_empty') {
      sections.certify.remove();
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
    var body = ui.el('div', {}, [
      ui.el('p', { text: 'Cycle ' + cycle.state + (cycle.due_at ? ' — due ' + new Date(cycle.due_at).toLocaleDateString() : '') + '. Every resource below starts confirmed; uncheck one to record an exception instead.' }),
      table,
      ui.el('div', { class: 'button-row' }, [submit])
    ]);
    var metaText = cycle.state + (cycle.due_at ? ' · due ' + new Date(cycle.due_at).toLocaleDateString() : '');
    sections.certify.populate(body, metaText);
    // Open when this is an active task (matches the "Certify now" task card's own overdue/due
    // condition, `renderTasks`) — never open for a routine, not-yet-due cycle by default.
    // `expand()` is one-way, so a person who already opened it stays opened.
    if (overdue || cycle.state !== 'certified') sections.certify.expand();
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
        ui.el('div', { class: 'button-row' }, [promote, dismissFile])
      );
    } else {
      // Ignored/unevaluable — a rule already decided this isn't ready to register (or can't be
      // read at all); the only meaningful disposition here is silencing it, same as `proposed`.
      children.push(ui.el('div', { class: 'button-row' }, [dismissFile]));
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
    // Folder-scoped, not per-document (NDocs-6vg): `dismiss_candidate`'s `scope: 'folder'` acts
    // on the whole folder regardless of which candidate in it is named, so any item here works
    // as the reference — repeating the control on every row said the same thing N times.
    var refCandidate = group.items[0];
    var dismissFolder = ui.el('button', { type: 'button', class: 'button', text: 'Dismiss everything in this folder' });
    dismissFolder.addEventListener('click', function () {
      ui.confirm({
        title: 'Dismiss this folder', danger: true,
        body: 'Stop scanning "' + (group.folderName || group.folderId) + '" for this team entirely?',
        confirmLabel: 'Dismiss folder'
      }).then(function (confirmed) { if (confirmed) dismiss(refCandidate, 'folder', dismissFolder); });
    });
    content.appendChild(ui.el('div', { class: 'button-row' }, [dismissFolder]));
    group.items.forEach(function (c) { content.appendChild(renderCandidateRow(c, state, vocab)); });
    return ui.el('details', { class: 'disclosure', open: 'open' }, [summary, content]);
  }

  function renderCandidates(candidates, state) {
    state = state || 'proposed';
    currentCandidateState = state;

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

    var metaText = candidates.length + ' ' + (CANDIDATE_STATE_LABELS[state] || state).toLowerCase();
    sections.candidates.populate(ui.el('div', {}, [
      ui.el('div', { class: 'button-row' }, [scanButton]),
      ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-candidate-state', text: 'Show' }), stateSelect]),
      body
    ]), metaText);
    // Open when there's a proposed queue waiting, or when a state switch/deep link is what got
    // us here in the first place. `expand()` is one-way — it never re-collapses a section the
    // caller (or the person) already opened.
    if ((state === 'proposed' && candidates.length > 0) || state !== 'proposed') {
      sections.candidates.expand();
    }
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
    ensureSection('candidates').busy(sections.candidates.body.childNodes.length ? 'syncing…' : 'loading…');
    NDocsTransport.call('admin_list_candidates', { teamId: currentTeamId, triageState: state }).then(function (data) {
      renderCandidates(data.candidates, state);
    }).catch(function (err) {
      if (err.name === 'NotAuthorized') {
        sections.candidates.remove(); // same team-membership gate as list_team_inventory — a refusal there already shows.
        return;
      }
      sections.candidates.error({ message: 'Could not load scan candidates: ' + err.message, onRetry: function () { loadCandidates(state); } });
    });
  }

  function loadCertify() {
    ensureSection('certify').busy(sections.certify.body.childNodes.length ? 'syncing…' : 'loading…');
    NDocsTransport.call('get_certification', { teamId: currentTeamId }).then(function (data) {
      renderCertify(data.cycle, data.entries);
    }).catch(function (err) {
      latestCycle = null;
      if (err.code === 'not_found') { sections.certify.remove(); renderTasks(); return; } // no open cycle — a quiet, expected state
      if (err.name === 'NotAuthorized') { sections.certify.remove(); renderTasks(); return; } // membership refusal already shown by the inventory panel
      sections.certify.error({ message: 'Could not load certification: ' + err.message, onRetry: loadCertify });
    });
  }

  function load() {
    renderTasksLoading();
    sections.inventory.busy(sections.inventory.body.childNodes.length ? 'syncing…' : 'loading…');
    ensureSection('settings').busy('loading…');
    NDocsTransport.call('list_team_inventory', { teamId: currentTeamId, groupBy: 'folder' }).then(function (data) {
      renderSummary(data.team);
      renderInventory(data, currentPrincipal);
    }).catch(function (err) {
      summaryEl.textContent = '';
      sections.settings.remove();
      if (err.name === 'NotAuthorized') {
        sections.inventory.denied('You are not a member of this team.');
        return;
      }
      sections.inventory.error({ message: 'Team not found or could not be loaded.', onRetry: load });
    });

    ensureSection('findings').busy(sections.findings.body.childNodes.length ? 'syncing…' : 'loading…');
    NDocsTransport.call('list_findings', { teamId: currentTeamId, state: 'open' }).then(function (data) {
      renderFindings(data.findings);
    }).catch(function () {
      // Same team-membership gate as list_team_inventory above; a refusal already shows there.
      sections.findings.remove();
    });

    loadCertify();
    loadCandidates();
  }

  // buildSections() — every disclosure's persistent shell, built synchronously before any
  // fetch (ux-components.md "Disclosure section renders its shell... before its data is
  // fetched"). `sections.settings` is speculative — built closed with no known admin status
  // yet; `renderSummary`/`load()`'s catch decide whether it stays.
  // Each section's build options, kept so a section that `.remove()`d itself (settings for a
  // non-admin, candidates/certify/findings for a refusal or an empty/not_found cycle) can be
  // rebuilt on the next load if the underlying condition reverses — e.g. an admin session
  // regains access, or a new certification cycle opens — without a full page reload.
  var SECTION_SPECS = {
    settings: { key: 'settings', id: 'team-settings', title: 'Team Settings', loadingText: 'loading…' },
    inventory: { key: 'inventory', id: 'inventory', title: 'Resources by folder', open: true, loadingText: 'loading…' },
    candidates: { key: 'candidates', id: 'candidates', title: 'Uncatalogued documents found by scanning', loadingText: 'loading…' },
    certify: { key: 'certify', id: 'certify', title: 'Certify this inventory', loadingText: 'loading…' },
    findings: { key: 'findings', id: 'findings', title: 'Open findings', loadingText: 'loading…' }
  };
  var SECTION_CONTAINERS = {}; // populated in init() once the DOM refs are known

  function buildSections() {
    SECTION_CONTAINERS = {
      settings: settingsEl, inventory: inventoryEl, candidates: candidatesEl,
      certify: certifyEl, findings: findingsEl
    };
    Object.keys(SECTION_SPECS).forEach(function (key) {
      sections[key] = NDocsShell.section(Object.assign({ container: SECTION_CONTAINERS[key] }, SECTION_SPECS[key]));
      openIfLinked(sections[key].details);
    });
  }

  // ensureSection(key) — rebuilds a section's shell if a previous load `.remove()`d it.
  // Called right before any `busy()`/`populate()` on a section that has a remove() path.
  function ensureSection(key) {
    if (!sections[key].details.parentNode) {
      sections[key] = NDocsShell.section(Object.assign({ container: SECTION_CONTAINERS[key] }, SECTION_SPECS[key]));
    }
    return sections[key];
  }

  function init() {
    summaryEl = document.getElementById('ndocs-team-summary');
    settingsEl = document.getElementById('ndocs-team-settings');
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

    buildSections();

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
