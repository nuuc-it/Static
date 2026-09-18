// app/page-resource.js — resource.html controller (Stage 15.6, `NDocs-jg1`). Rebuilt onto
// the shared UI system (ADR-0012): entity summary panel; any open finding as a status panel,
// `metadata_discrepancy` findings carrying value-naming reconciliation controls ("Use
// document value" / "Keep catalog value"); record details as a plain detail list, separated
// from a "Manage this record" action panel; edit mode opens a complete record editor — every
// field `src/Contract.js` declares, grouped into labeled sections
// (`NDocsRecords.RESOURCE_FIELD_GROUPS`), with document/system-class fields shown and labeled
// read-only rather than omitted (ux-components.md "Resource" composition row, ADR-0005).
// Retire/supersede and the admin reassign control route through `NDocsUI.confirm(spec)`
// (NDocs-st4's dialog helper) instead of `window.confirm`/`confirmDialog` — this is that
// helper's first caller. Calls get_resource, update_resource, retire_resource,
// report_problem, resolve_finding, admin_reassign_resources.
(function () {
  'use strict';

  var ui = NDocsUI;
  var summaryEl, findingsEl, detailEl, actionsEl, editorEl;
  var currentResourceId;
  var currentPrincipal;
  var currentData; // last get_resource response
  var editing = false;

  function resourceIdFromQuery() {
    var params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  // ---- entity summary panel ----

  function renderSummary(data) {
    var record = data.record;
    var badges = ui.el('div', { class: 'badges' });
    if (record.type) badges.appendChild(ui.el('span', { class: 'badge', text: record.type }));
    var status = NDocsRecords.statusBadge(record);
    if (status) badges.appendChild(ui.el('span', { class: 'badge badge--' + status.kind, text: status.text }));

    var actions = ui.el('div', { class: 'entity-summary-actions' });
    var editBtn = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Edit' });
    editBtn.addEventListener('click', function () { setEditing(true); });
    actions.appendChild(editBtn);

    var top = ui.el('div', { class: 'entity-summary-top' }, [
      ui.el('div', {}, [
        ui.el('div', { class: 'eyebrow', text: (record.team_id || 'Unassigned') + ' · ' + (record.type || 'Resource') }),
        ui.el('h1', { text: record.title }),
        record.purpose ? ui.el('p', { text: record.purpose }) : ui.el('p', { class: 'muted', text: 'No purpose recorded yet.' }),
        badges
      ]),
      actions
    ]);

    var metaPairs = [
      ['Doc ID', record.doc_id || '—'],
      ['Folder', null], // filled below with a node
      ['Last certified', NDocsRecords.dateOrDash(record.last_certified_at)],
      ['File last modified', NDocsRecords.dateOrDash(record.drive_modified_at)]
    ];
    var meta = ui.el('div', { class: 'entity-summary-meta' });
    metaPairs.forEach(function (pair) {
      var item = ui.el('div', {}, [ui.el('span', { class: 'hero-meta-label', text: pair[0] })]);
      if (pair[0] === 'Folder') {
        item.appendChild(ui.el('span', { class: 'hero-meta-value' }, [NDocsRecords.folderCell(record)]));
      } else {
        item.appendChild(ui.el('span', { class: 'hero-meta-value', text: pair[1] }));
      }
      meta.appendChild(item);
    });

    summaryEl.textContent = '';
    summaryEl.appendChild(ui.el('div', { class: 'entity-summary' }, [top, meta]));
  }

  // ---- discrepancy / findings status panels ----

  var REPORT_KIND_LABELS = {
    link_broken: 'Link broken', access_reported: 'Access problem', outdated_reported: 'Outdated',
    wrong_owner_reported: 'Wrong owning team', replaced_reported: 'Replaced',
    metadata_discrepancy: 'Document metadata disagrees with the catalog',
    certification_overdue: 'Certification overdue', duplicate_candidate: 'Duplicate candidate',
    team_misconfigured: 'Team misconfigured', mail_failed: 'Notification failed',
    personal_drive_location: 'Stored in a personal Drive', governance_review: 'Governance review requested',
    inactive_team: 'Owning team inactive'
  };

  function findingLabel(f) {
    return REPORT_KIND_LABELS[f.kind] || f.kind;
  }

  function resolveFinding(finding, resolution, note) {
    return NDocsTransport.call('resolve_finding', {
      findingId: finding.finding_id, rev: finding.rev, resolution: resolution, note: note
    }).then(function () {
      ui.announce('Finding resolved.');
      ui.toast('Finding resolved.', 'info');
      load();
    }).catch(function (err) {
      ui.toast('Could not resolve: ' + err.message, 'warn');
    });
  }

  function discrepancyPanel(finding) {
    var patch = finding.proposed_patch || {};
    var patchSummary = Object.keys(patch).map(function (k) { return k + ': "' + patch[k] + '"'; }).join(', ');
    var useDocBtn = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Use document value' });
    var keepCatalogBtn = ui.el('button', { type: 'button', class: 'button', text: 'Keep catalog value' });
    useDocBtn.addEventListener('click', function () { resolveFinding(finding, 'accept'); });
    keepCatalogBtn.addEventListener('click', function () { resolveFinding(finding, 'reject'); });
    return ui.el('div', { class: 'status-panel status-panel--attention', role: 'group', 'aria-label': findingLabel(finding) }, [
      ui.el('div', {}, [
        ui.el('strong', { text: findingLabel(finding) }),
        ui.el('p', { text: 'The document proposes: ' + (patchSummary || 'a change') + '.' })
      ]),
      ui.el('div', { class: 'button-row' }, [keepCatalogBtn, useDocBtn])
    ]);
  }

  function ordinaryFindingPanel(finding) {
    var fixedBtn = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Mark fixed' });
    var wontFixBtn = ui.el('button', { type: 'button', class: 'button', text: "Won't fix" });
    fixedBtn.addEventListener('click', function () { resolveFinding(finding, 'fixed'); });
    wontFixBtn.addEventListener('click', function () { resolveFinding(finding, 'wont_fix'); });
    return ui.el('div', { class: 'status-panel status-panel--danger', role: 'group', 'aria-label': findingLabel(finding) }, [
      ui.el('div', {}, [
        ui.el('strong', { text: findingLabel(finding) }),
        ui.el('p', { text: 'Detected ' + NDocsRecords.dateOrDash(finding.detected_at) + '. Affects this resource.' })
      ]),
      ui.el('div', { class: 'button-row' }, [wontFixBtn, fixedBtn])
    ]);
  }

  function renderFindings(openFindings) {
    findingsEl.textContent = '';
    (openFindings || []).forEach(function (f) {
      findingsEl.appendChild(f.kind === 'metadata_discrepancy' ? discrepancyPanel(f) : ordinaryFindingPanel(f));
    });
  }

  // ---- record details (read view) ----

  function governanceLinks(data) {
    var nodes = [];
    var predecessors = (data.supersession && data.supersession.predecessors) || [];
    var successor = data.supersession && data.supersession.successor;
    if (predecessors.length) {
      var predList = ui.el('span', {});
      predecessors.forEach(function (p, i) {
        if (i > 0) predList.appendChild(document.createTextNode(', '));
        predList.appendChild(ui.el('a', { href: 'resource.html?id=' + encodeURIComponent(p.resource_id || p), text: p.title || p.resource_id || p }));
      });
      nodes.push(['Supersedes', predList]);
    }
    if (successor) {
      nodes.push(['Superseded by', ui.el('a', { href: 'resource.html?id=' + encodeURIComponent(successor.resource_id || successor), text: successor.title || successor.resource_id || successor })]);
    }
    return nodes;
  }

  function renderDetail(data) {
    var record = data.record;
    var pairs = [
      ['Audience', record.audience || '—'],
      ['Discovery', record.discovery || '—'],
      ['Topics', (record.topics && record.topics.length) ? [].concat(record.topics).join(', ') : '—'],
      ['Maintainer', record.maintainer_email || '—'],
      ['Source URL', record.source_url ? ui.el('a', { href: record.source_url, target: '_blank', rel: 'noopener', text: record.source_url }) : '—']
    ].concat(governanceLinks(data));

    var dl = ui.el('dl', { class: 'detail-list' });
    pairs.forEach(function (pair) {
      dl.appendChild(ui.el('dt', { text: pair[0] }));
      if (pair[1] && typeof pair[1] === 'object') dl.appendChild(ui.el('dd', {}, [pair[1]]));
      else dl.appendChild(ui.el('dd', { text: pair[1] }));
    });

    detailEl.textContent = '';
    detailEl.appendChild(ui.el('div', { class: 'section-card' }, [
      ui.el('div', { class: 'section-card-header' }, [
        ui.el('div', {}, [ui.el('div', { class: 'section-kicker', text: 'Record' }), ui.el('h2', { text: 'Details' })])
      ]),
      ui.el('div', { class: 'section-card-body' }, [dl])
    ]));
  }

  // ---- "Manage this record" action panel ----

  var REPORT_KINDS = [
    ['link_broken', 'The link is broken'],
    ['access_reported', "I can't access it"],
    ['outdated_reported', "It's outdated"],
    ['wrong_owner_reported', 'Wrong owning team'],
    ['replaced_reported', 'It has been replaced']
  ];

  function reportProblemControl(resourceId) {
    var select = ui.el('select', { id: 'ndocs-report-kind' });
    REPORT_KINDS.forEach(function (pair) {
      select.appendChild(ui.el('option', { value: pair[0], text: pair[1] }));
    });
    var note = ui.el('input', { type: 'text', id: 'ndocs-report-note', placeholder: 'Note (optional)' });
    var button = ui.el('button', { type: 'button', class: 'button', text: 'Report a problem' });
    button.addEventListener('click', function () {
      button.disabled = true;
      NDocsTransport.call('report_problem', {
        resourceId: resourceId, kind: select.value, note: note.value || undefined
      }).then(function (data) {
        button.disabled = false;
        var msg = data.attachedToExisting ? 'Added to an existing report.' : 'Problem reported.';
        ui.announce(msg);
        ui.toast(msg, 'info');
        load();
      }).catch(function (err) {
        button.disabled = false;
        ui.toast('Could not report the problem: ' + err.message, 'warn');
      });
    });
    return ui.el('div', { class: 'field field--full' }, [
      ui.el('label', { for: 'ndocs-report-kind', text: 'Report a problem' }),
      select, note, button
    ]);
  }

  function retireControl(data) {
    if (!data.canRetire) return null;
    var button = ui.el('button', { type: 'button', class: 'button button--danger', text: 'Retire or supersede…' });
    button.addEventListener('click', function () {
      var dispositionSelect = ui.el('select', {});
      ['archived', 'withdrawn', 'superseded'].forEach(function (d) {
        dispositionSelect.appendChild(ui.el('option', { value: d, text: d }));
      });
      var successorInput = ui.el('input', { type: 'text', placeholder: 'Successor resource id (required for superseded)' });
      var reasonInput = ui.el('input', { type: 'text', placeholder: 'Reason' });
      var body = [
        ui.el('p', { text: 'This retires "' + data.record.title + '" (' + data.record.doc_id + '). It stops appearing in the default catalog search and no longer certifies.' }),
        ui.el('div', { class: 'field' }, [ui.el('label', { text: 'Disposition' }), dispositionSelect]),
        ui.el('div', { class: 'field' }, [ui.el('label', { text: 'Successor resource id' }), successorInput]),
        ui.el('div', { class: 'field' }, [ui.el('label', { text: 'Reason' }), reasonInput])
      ];
      ui.confirm({
        title: 'Retire resource', body: body, confirmLabel: 'Retire resource', danger: true
      }).then(function (confirmed) {
        if (!confirmed) return;
        NDocsTransport.call('retire_resource', {
          resourceId: data.record.resource_id, rev: data.record.rev,
          disposition: dispositionSelect.value,
          successorId: successorInput.value || undefined,
          reason: reasonInput.value || 'Retired from resource.html'
        }).then(function () {
          ui.announce('Resource retired.');
          ui.toast('Resource retired.', 'info');
          load();
        }).catch(function (err) {
          ui.toast('Could not retire: ' + err.message, 'warn');
        });
      });
    });
    return button;
  }

  function reassignControl(record) {
    if (!currentPrincipal || !currentPrincipal.isAdmin) return null;
    var teamSelect = ui.el('select', { id: 'ndocs-reassign-team' });
    teamSelect.appendChild(ui.el('option', { value: '', text: '(unresolved queue)' }));
    var vocabData = NDocsVocab.current();
    (vocabData && vocabData.teams || []).forEach(function (t) {
      var opt = ui.el('option', { value: t.teamId, text: t.name });
      if (t.teamId === record.team_id) opt.setAttribute('selected', 'selected');
      teamSelect.appendChild(opt);
    });
    var button = ui.el('button', { type: 'button', class: 'button', text: 'Reassign' });
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
    return ui.el('div', { class: 'field field--full' }, [
      ui.el('label', { for: 'ndocs-reassign-team', text: 'Reassign to team (administrator)' }),
      teamSelect, button
    ]);
  }

  function renderActions(data) {
    var editBtn = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Edit this record' });
    editBtn.addEventListener('click', function () { setEditing(true); });

    var stack = ui.el('div', { class: 'action-stack' }, [editBtn, reportProblemControl(data.record.resource_id)]);

    var reassign = reassignControl(data.record);
    if (reassign) stack.appendChild(ui.el('div', { class: 'action-stack-separator' }, [reassign]));

    var retire = retireControl(data);
    if (retire) {
      stack.appendChild(ui.el('div', { class: 'action-stack-separator actions-danger' }, [retire]));
    }

    actionsEl.textContent = '';
    actionsEl.appendChild(ui.el('div', { class: 'section-card' }, [
      ui.el('div', { class: 'section-card-header' }, [
        ui.el('div', {}, [ui.el('div', { class: 'section-kicker', text: 'Actions' }), ui.el('h2', { text: 'Manage this record' })])
      ]),
      ui.el('div', { class: 'section-card-body' }, [stack])
    ]));
  }

  // ---- complete record editor ----

  function fieldControl(field, record) {
    var value = record[field.name];
    if (!field.editable) {
      var text = field.format === 'bool' ? (value ? 'Yes' : 'No')
        : field.format === 'date' ? NDocsRecords.dateOrDash(value)
        : (value === undefined || value === null || value === '' ? '—' : String(value));
      return ui.el('input', { type: 'text', id: 'rf-' + field.name, value: text, readonly: 'readonly', 'aria-readonly': 'true' });
    }
    var vocab = (NDocsVocab.current() && NDocsVocab.current().vocab) || {};
    if (field.control === 'textarea') {
      var ta = ui.el('textarea', { id: 'rf-' + field.name, rows: 3 });
      ta.value = value || '';
      return ta;
    }
    if (field.control === 'status') {
      var statusSelect = ui.el('select', { id: 'rf-' + field.name });
      NDocsRecords.RESOURCE_STATUS_VALUES.forEach(function (s) {
        var opt = ui.el('option', { value: s, text: s });
        if (s === value) opt.setAttribute('selected', 'selected');
        statusSelect.appendChild(opt);
      });
      return statusSelect;
    }
    if (field.control === 'team') {
      var teamSelect = ui.el('select', { id: 'rf-' + field.name });
      var vocabData = NDocsVocab.current();
      (vocabData && vocabData.teams || []).forEach(function (t) {
        var opt = ui.el('option', { value: t.teamId, text: t.name });
        if (t.teamId === value) opt.setAttribute('selected', 'selected');
        teamSelect.appendChild(opt);
      });
      return teamSelect;
    }
    if (field.control && field.control.indexOf('vocab:') === 0) {
      var kind = field.control.split(':')[1];
      var sel = ui.el('select', { id: 'rf-' + field.name });
      sel.appendChild(ui.el('option', { value: '', text: '—' }));
      (vocab[kind] || []).forEach(function (v) {
        var opt = ui.el('option', { value: v, text: v });
        if (v === value) opt.setAttribute('selected', 'selected');
        sel.appendChild(opt);
      });
      return sel;
    }
    if (field.control && field.control.indexOf('vocab-multi:') === 0) {
      var mkind = field.control.split(':')[1];
      var current = [].concat(value || []);
      var group = ui.el('div', { id: 'rf-' + field.name, class: 'field', role: 'group', 'aria-label': field.label });
      (vocab[mkind] || []).forEach(function (v) {
        var cb = ui.el('input', { type: 'checkbox', value: v, id: 'rf-' + field.name + '-' + v });
        if (current.indexOf(v) !== -1) cb.checked = true;
        var label = ui.el('label', { for: 'rf-' + field.name + '-' + v }, [cb, ' ' + v]);
        group.appendChild(label);
      });
      return group;
    }
    if (field.control === 'provisions') {
      var provisions = (NDocsVocab.current() && NDocsVocab.current().provisions) || [];
      var pcurrent = [].concat(value || []);
      var pgroup = ui.el('div', { id: 'rf-' + field.name, class: 'field', role: 'group', 'aria-label': field.label });
      provisions.forEach(function (p) {
        var pid = p.id || p.provision_id;
        var cb = ui.el('input', { type: 'checkbox', value: pid, id: 'rf-' + field.name + '-' + pid });
        if (pcurrent.indexOf(pid) !== -1) cb.checked = true;
        pgroup.appendChild(ui.el('label', { for: 'rf-' + field.name + '-' + pid }, [cb, ' ' + (p.title || pid)]));
      });
      if (!provisions.length) pgroup.appendChild(ui.el('p', { class: 'field-help', text: 'No provisions declared yet.' }));
      return pgroup;
    }
    return ui.el('input', { type: 'text', id: 'rf-' + field.name, value: value || '' });
  }

  function readFieldValue(field) {
    if (field.control && field.control.indexOf('vocab-multi:') === 0) {
      var group = document.getElementById('rf-' + field.name);
      return Array.from(group.querySelectorAll('input[type=checkbox]:checked')).map(function (cb) { return cb.value; });
    }
    if (field.control === 'provisions') {
      var pgroup = document.getElementById('rf-' + field.name);
      return Array.from(pgroup.querySelectorAll('input[type=checkbox]:checked')).map(function (cb) { return cb.value; });
    }
    var el = document.getElementById('rf-' + field.name);
    return el ? el.value : undefined;
  }

  function renderEditor(data) {
    var record = data.record;
    var sections = [];
    NDocsRecords.RESOURCE_FIELD_GROUPS.forEach(function (group) {
      var grid = ui.el('div', { class: 'form-grid' });
      group.fields.forEach(function (field) {
        var control = fieldControl(field, record);
        var labelText = field.label + (field.editable ? '' : ' (read-only)');
        var isGroupControl = field.control === 'provisions' || (field.control && field.control.indexOf('vocab-multi:') === 0);
        var wrap = isGroupControl
          ? ui.el('fieldset', { class: 'field' }, [ui.el('legend', { text: labelText }), control])
          : ui.el('div', { class: 'field' }, [ui.el('label', { for: 'rf-' + field.name, text: labelText }), control]);
        grid.appendChild(wrap);
      });
      var sectionChildren = [ui.el('h3', { class: 'section-title', text: group.title })];
      if (group.note) sectionChildren.push(ui.el('p', { class: 'field-help', text: group.note }));
      sectionChildren.push(grid);
      sections.push(ui.el('div', { class: 'surface' }, sectionChildren));
    });

    var saveBtn = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Save changes' });
    var cancelBtn = ui.el('button', { type: 'button', class: 'button', text: 'Cancel' });
    saveBtn.addEventListener('click', function () {
      var patch = {};
      NDocsRecords.RESOURCE_FIELD_GROUPS.forEach(function (group) {
        group.fields.forEach(function (field) {
          if (!field.editable) return;
          patch[field.name] = readFieldValue(field);
        });
      });
      saveBtn.disabled = true;
      NDocsTransport.call('update_resource', {
        resourceId: record.resource_id, rev: record.rev, patch: patch
      }).then(function () {
        ui.announce('Saved.');
        ui.toast('Saved.', 'info');
        setEditing(false);
        load();
      }).catch(function (err) {
        saveBtn.disabled = false;
        if (err.code === 'validation_failed') {
          ui.toast('Fix these fields: ' + ((err.data && err.data.fields) || []).join(', '), 'warn');
          return;
        }
        ui.toast('Could not save: ' + err.message, 'warn');
      });
    });
    cancelBtn.addEventListener('click', function () { setEditing(false); });

    editorEl.textContent = '';
    editorEl.appendChild(ui.el('div', { class: 'section-card' }, [
      ui.el('div', { class: 'section-card-header' }, [
        ui.el('div', {}, [ui.el('div', { class: 'section-kicker', text: 'Edit' }), ui.el('h2', { text: 'Edit this record' })])
      ]),
      ui.el('div', { class: 'section-card-body' }, sections.concat([
        ui.el('div', { class: 'button-row' }, [cancelBtn, saveBtn])
      ]))
    ]));
  }

  function setEditing(next) {
    editing = next;
    editorEl.classList.toggle('hidden', !editing);
    detailEl.classList.toggle('hidden', editing);
    actionsEl.classList.toggle('hidden', editing);
    if (editing && currentData) renderEditor(currentData);
    if (editing) {
      var first = editorEl.querySelector('input:not([readonly]), select, textarea');
      if (first) first.focus();
    }
  }

  // ---- load / gate ----

  function load() {
    NDocsShell.region(detailEl, 'loading', { loadingText: 'Loading resource…' });
    NDocsTransport.call('get_resource', { resourceId: currentResourceId }).then(function (data) {
      currentData = data;
      renderSummary(data);
      renderFindings(data.openFindings);
      renderDetail(data);
      renderActions(data);
      if (editing) renderEditor(data);
    }).catch(function (err) {
      if (err.name === 'NotAuthorized') {
        NDocsShell.region(detailEl, 'permission-denied', { message: 'You do not have access to this resource.' });
        summaryEl.textContent = '';
        findingsEl.textContent = '';
        actionsEl.textContent = '';
        return;
      }
      NDocsShell.region(detailEl, 'error', { message: 'Resource not found or could not be loaded.', onRetry: load });
      summaryEl.textContent = '';
      findingsEl.textContent = '';
      actionsEl.textContent = '';
    });
  }

  function init() {
    summaryEl = document.getElementById('ndocs-resource-summary');
    findingsEl = document.getElementById('ndocs-resource-findings');
    detailEl = document.getElementById('ndocs-resource-detail');
    actionsEl = document.getElementById('ndocs-resource-actions');
    editorEl = document.getElementById('ndocs-resource-editor');
    editorEl.classList.add('hidden');

    currentResourceId = resourceIdFromQuery();
    if (!currentResourceId) {
      NDocsShell.region(detailEl, 'error', { message: 'No resource id in the link.' });
      return Promise.resolve();
    }

    return Promise.all([
      NDocsTransport.call('whoami', {}),
      NDocsVocab.load().catch(function () { return null; })
    ]).then(function (both) {
      var principal = both[0];
      NDocsSession.setPrincipal(principal);
      currentPrincipal = principal;
      load();
      return principal;
    });
  }

  // Stage 6 (`NDocs-2a9`): same "the page decides when a session exists" contract as
  // page-search.js — resource.html calls NDocsPageResource.start() only once a session is
  // confirmed by app/shell.js's mount().
  window.NDocsPageResource = { start: init };
})();
