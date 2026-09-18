// app/page-tools.js — tools.html controller (Stage 15.6, `NDocs-c71`). Rebuilt onto the
// shared UI system (ADR-0012): a "Needs attention" summary (`admin_summary`, `NDocs-dsc`)
// answers "is there anything for me today" before any section is opened, then deep-linkable
// `<details>` sections with stable fragment ids (`#findings`, `#integrity`, `#jobs`,
// `#vocabulary`, `#provisions`, `#bulk-import`, `#audit`) — never a tab widget (ux-components.md
// "Admin tools" composition row, this stage's own Must-not). Findings opens by default when it
// has work. Bulk import gets an explicit review step (`NDocsUI.confirm`) before it commits.
//
// Sections, one per `knowledge-base/staging/ndocs-build.md` §15 point 6, minus (b) team
// administration — moved to `team.html`/`resource.html` (see `app/page-team.js`/
// `app/page-resource.js`).
(function () {
  'use strict';

  var ui = NDocsUI;
  var els = {};
  var summaryEl;

  function call(action, payload) {
    return NDocsTransport.call(action, payload || {});
  }

  // Inline error state for a disclosure section's body — used wherever a section's own load
  // call can fail independently of `loadSummary()` (ux-components.md "Async surface states":
  // error needs a summary plus a retry path, not a silent toast that leaves the section blank).
  function sectionError(body, message, onRetry) {
    body.textContent = '';
    var box = ui.el('div', { class: 'region-error', role: 'alert' }, [ui.el('p', { text: message })]);
    if (typeof onRetry === 'function') {
      var btn = ui.el('button', { type: 'button', class: 'button', text: 'Retry' });
      btn.addEventListener('click', onRetry);
      box.appendChild(btn);
    }
    body.appendChild(box);
  }

  function disclosureSection(id, title, opts) {
    opts = opts || {};
    var summary = ui.el('summary', {}, [document.createTextNode(title)]);
    if (opts.meta) summary.appendChild(ui.el('span', { class: 'summary-meta', text: opts.meta }));
    var body = ui.el('div', { class: 'disclosure-content' });
    var details = ui.el('details', { class: 'disclosure', id: id }, [summary, body]);
    if (opts.open) details.open = true;
    return { details: details, body: body };
  }

  // ---- "Needs attention" summary (admin_summary, NDocs-dsc) — computed before any section
  // renders its own body, per this stage's own rule: a disclosure summary is a promise you can
  // learn whether to open something without paying to open it. ----

  function renderNeedsAttention(summary) {
    summaryEl.textContent = '';
    var metrics = [];

    var findingsMetric = ui.el('div', { class: 'metric' }, [
      ui.el('strong', { text: String(summary.openFindingCount) }),
      ui.el('span', { text: 'open finding' + (summary.openFindingCount === 1 ? '' : 's') }),
      ui.el('p', {}, [ui.el('a', { href: '#findings', text: 'Review findings' })])
    ]);
    metrics.push(findingsMetric);

    var integrityText = summary.integrityIssueCount === null
      ? 'Not yet checked'
      : summary.integrityIssueCount + ' issue' + (summary.integrityIssueCount === 1 ? '' : 's') +
        (summary.integrityLastRunAt ? ' · checked ' + new Date(summary.integrityLastRunAt).toLocaleString() : '');
    metrics.push(ui.el('div', { class: 'metric' }, [
      ui.el('strong', { text: summary.integrityIssueCount === null ? '—' : String(summary.integrityIssueCount) }),
      ui.el('span', { text: 'catalog integrity' }),
      ui.el('p', {}, [ui.el('a', { href: '#integrity', text: integrityText })])
    ]));

    metrics.push(ui.el('div', { class: 'metric' }, [
      ui.el('strong', { text: String(summary.runningJobCount) }),
      ui.el('span', { text: 'job' + (summary.runningJobCount === 1 ? '' : 's') + ' running' }),
      ui.el('p', {}, [ui.el('a', { href: '#jobs', text: 'Job status' })])
    ]));

    var nothingUrgent = summary.openFindingCount === 0 && !summary.runningJobCount &&
      (summary.integrityIssueCount === 0 || summary.integrityIssueCount === null);
    summaryEl.appendChild(ui.el('div', { class: 'entity-summary' }, [
      ui.el('div', { class: 'section-kicker', text: 'Needs attention' }),
      // h2, not h1 — tools.html's page header already carries the page's one <h1> ("Admin
      // tools"); this is a section heading (ux-components.md "One h1 per page").
      ui.el('h2', { class: 'section-title', text: nothingUrgent ? 'Nothing needs you right now' : 'Some sections need review' }),
      ui.el('div', { class: 'priority-grid' }, metrics)
    ]));
  }

  function loadSummary() {
    return call('admin_summary', {}).then(function (data) {
      renderNeedsAttention(data);
      return data;
    }).catch(function (err) {
      summaryEl.textContent = '';
      summaryEl.appendChild(ui.el('div', { class: 'region-error', role: 'alert' }, [
        ui.el('p', { text: 'Could not load the summary: ' + err.message })
      ]));
      return { openFindingCount: 0, integrityIssueCount: null, runningJobCount: 0 };
    });
  }

  // ---- (a) cross-team findings queue ----

  function renderQueue(findings, body) {
    body.textContent = '';
    if (!findings.length) {
      body.appendChild(ui.el('div', { class: 'empty-state' }, [ui.el('p', { text: 'No findings.' })]));
      return;
    }
    var list = ui.el('div', {});
    findings.forEach(function (f) {
      list.appendChild(ui.el('div', { class: 'status-panel status-panel--danger' }, [
        ui.el('div', {}, [
          ui.el('strong', { text: f.team_id + ' · ' + f.kind }),
          ui.el('p', {}, [
            ui.el('a', { href: 'resource.html?id=' + encodeURIComponent(f.resource_id), text: f.resource_id }),
            document.createTextNode(' · ' + f.state + ' · detected ' + NDocsRecords.dateOrDash(f.detected_at))
          ])
        ])
      ]));
    });
    body.appendChild(list);
  }

  function loadQueue(body) {
    call('admin_list_findings', {}).then(function (data) { renderQueue(data.findings, body); })
      .catch(function (err) {
        sectionError(body, 'Could not load the findings queue: ' + err.message, function () { loadQueue(body); });
      });
  }

  // ---- (c) controlled values ----

  // `definitions` is `get_bootstrap`'s `vocabDefinitions` — `[{kind, value, definition}]`,
  // `value: ''` naming a kind's own purpose (`Vocabulary` sheet, `Contract.js`'s own note).
  function renderVocab(vocab, definitions, body) {
    body.textContent = '';
    var byKind = {};
    (definitions || []).forEach(function (d) {
      byKind[d.kind] = byKind[d.kind] || {};
      byKind[d.kind][d.value || ''] = d.definition;
    });

    var reference = ui.el('div', {});
    Object.keys(vocab).forEach(function (kind) {
      var kindDesc = (byKind[kind] && byKind[kind]['']) || null;
      var rows = [ui.el('dt', { text: kind }), ui.el('dd', { text: kindDesc || 'No description yet.' })];
      (vocab[kind] || []).forEach(function (v) {
        rows.push(ui.el('dt', { text: ' ' + v }));
        rows.push(ui.el('dd', { text: (byKind[kind] && byKind[kind][v]) || 'No definition yet.' }));
      });
      reference.appendChild(ui.el('dl', { class: 'detail-list' }, rows));
    });
    if (!Object.keys(vocab).length) {
      reference.appendChild(ui.el('p', { class: 'empty-state', text: 'No controlled values configured yet.' }));
    }
    body.appendChild(reference);

    var kindInput = ui.el('input', { type: 'text', id: 'ndocs-vocab-kind', placeholder: 'e.g. type, audience, topics' });
    var valuesInput = ui.el('textarea', { id: 'ndocs-vocab-values', rows: 4 });
    var loadKindButton = ui.el('button', { type: 'button', class: 'button', text: 'Load' });
    loadKindButton.addEventListener('click', function () {
      valuesInput.value = (vocab[kindInput.value] || []).join('\n');
    });
    var save = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Save' });
    save.addEventListener('click', function () {
      var values = valuesInput.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      save.disabled = true;
      call('admin_upsert_vocab', { kind: kindInput.value, values: values }).then(function () {
        save.disabled = false;
        ui.toast('Saved.', 'info');
        try { sessionStorage.clear(); } catch (e) { /* ignore */ }
      }).catch(function (err) {
        save.disabled = false;
        if (err.code === 'conflict') {
          ui.toast('In use by: ' + ((err.data && err.data.usingRecords) || []).join(', '), 'warn');
          return;
        }
        ui.toast('Could not save: ' + err.message, 'warn');
      });
    });
    body.appendChild(ui.el('div', { class: 'form-grid' }, [
      ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-vocab-kind', text: 'Controlled value kind' }), kindInput]),
      ui.el('div', { class: 'field field--full' }, [ui.el('label', { for: 'ndocs-vocab-values', text: 'Values, one per line' }), valuesInput])
    ]));
    body.appendChild(ui.el('div', { class: 'button-row' }, [loadKindButton, save]));

    var defKindInput = ui.el('input', { type: 'text', id: 'ndocs-vocabdef-kind', placeholder: 'e.g. type' });
    var defValueInput = ui.el('input', { type: 'text', id: 'ndocs-vocabdef-value', placeholder: "e.g. guide — leave blank for the kind's own purpose" });
    var defTextInput = ui.el('textarea', { id: 'ndocs-vocabdef-text', rows: 2 });
    var defSave = ui.el('button', { type: 'button', class: 'button', text: 'Save definition' });
    defSave.addEventListener('click', function () {
      if (!defKindInput.value) { ui.toast('Kind is required.', 'warn'); return; }
      defSave.disabled = true;
      call('admin_upsert_vocab_definition', {
        kind: defKindInput.value, value: defValueInput.value || undefined, definition: defTextInput.value
      }).then(function () {
        defSave.disabled = false;
        ui.toast('Saved.', 'info');
        try { sessionStorage.clear(); } catch (e) { /* ignore */ }
      }).catch(function (err) {
        defSave.disabled = false;
        ui.toast('Could not save: ' + err.message, 'warn');
      });
    });
    body.appendChild(ui.el('div', { class: 'form-grid' }, [
      ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-vocabdef-kind', text: 'Kind to describe' }), defKindInput]),
      ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-vocabdef-value', text: 'Value (blank = the kind itself)' }), defValueInput]),
      ui.el('div', { class: 'field field--full' }, [ui.el('label', { for: 'ndocs-vocabdef-text', text: 'Definition' }), defTextInput])
    ]));
    body.appendChild(ui.el('div', { class: 'button-row' }, [defSave]));
  }

  // ---- (d) provisions ----

  function renderProvisions(provisions, body) {
    body.textContent = '';
    if (!provisions.length) {
      body.appendChild(ui.el('div', { class: 'empty-state' }, [ui.el('p', { text: 'No provisions declared yet.' })]));
      return;
    }
    var list = ui.el('div', {});
    provisions.forEach(function (p) {
      var withdrawnCheckbox = ui.el('input', { type: 'checkbox', id: 'ndocs-prov-withdrawn-' + p.provision_id });
      var markButton = ui.el('button', { type: 'button', class: 'button', text: 'Mark revised' });
      markButton.addEventListener('click', function () {
        markButton.disabled = true;
        call('admin_mark_provision_revised', {
          provisionId: p.provision_id, withdrawn: withdrawnCheckbox.checked || undefined
        }).then(function (result) {
          ui.toast(result.affected + ' resource(s) now carry a review request.', 'info');
          loadProvisions(body);
        }).catch(function (err) {
          markButton.disabled = false;
          ui.toast('Could not mark revised: ' + err.message, 'warn');
        });
      });
      list.appendChild(ui.el('div', { class: 'inventory-row' }, [
        ui.el('div', {}, [
          ui.el('strong', { text: p.title + ' (' + p.provision_id + ')' }),
          ui.el('p', { class: 'meta', text: p.state + ' · ' + p.currentCount + ' current use(s)' })
        ]),
        ui.el('div', { class: 'button-row' }, [
          ui.el('label', {}, [withdrawnCheckbox, ' withdrawn']), markButton
        ])
      ]));
    });
    body.appendChild(list);
  }

  function loadProvisions(body) {
    call('list_provisions', {}).then(function (data) { renderProvisions(data.provisions, body); })
      .catch(function (err) {
        sectionError(body, 'Could not load provisions: ' + err.message, function () { loadProvisions(body); });
      });
  }

  // ---- (e) bulk import — explicit review step before commit ----

  function renderImport(teams, body) {
    body.textContent = '';
    var teamSelect = ui.el('select', { id: 'ndocs-import-team' });
    teams.forEach(function (t) { teamSelect.appendChild(ui.el('option', { value: t.teamId, text: t.name })); });
    var kindSelect = ui.el('select', { id: 'ndocs-import-kind' });
    kindSelect.appendChild(ui.el('option', { value: 'folder', text: 'Folder (scanned and judged)' }));
    kindSelect.appendChild(ui.el('option', { value: 'list', text: 'Named files (trusted, not judged)' }));
    var valueInput = ui.el('textarea', {
      id: 'ndocs-import-value', rows: 3
    });
    var help = ui.el('p', { class: 'field-help', text: 'Folder: one folder URL or id. List: one Drive URL or file id per line.' });

    var run = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Import…' });
    run.addEventListener('click', function () {
      var teamName = teamSelect.options[teamSelect.selectedIndex] ? teamSelect.options[teamSelect.selectedIndex].text : teamSelect.value;
      var rawValue = kindSelect.value === 'folder'
        ? valueInput.value.trim()
        : valueInput.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      var count = kindSelect.value === 'list' ? rawValue.length : 1;
      if (!rawValue || (Array.isArray(rawValue) && !rawValue.length)) {
        ui.toast('Nothing to import.', 'warn');
        return;
      }
      // Bulk operations get a review step before commit (this stage's own Must-not, and the
      // ux-components.md "tools.html" composition row) — a confirmation dialog names the
      // destination team and what will be scanned/imported, rather than committing on the
      // first click.
      ui.confirm({
        title: 'Import candidates',
        body: 'Import into ' + teamName + ' from ' +
          (kindSelect.value === 'folder' ? 'a folder scan' : count + ' named file(s)') + '. ' +
          'New candidates land in the review queue — nothing is catalogued automatically.',
        confirmLabel: 'Import'
      }).then(function (confirmed) {
        if (!confirmed) return;
        run.disabled = true;
        call('admin_import_candidates', { teamId: teamSelect.value, source: { kind: kindSelect.value, value: rawValue } })
          .then(function (result) {
            run.disabled = false;
            var msg = 'Created ' + result.created + ', skipped ' + result.duplicatesSkipped + ' duplicate(s).';
            ui.announce(msg);
            ui.toast(msg, 'info');
          }).catch(function (err) {
            run.disabled = false;
            ui.toast('Could not import: ' + err.message, 'warn');
          });
      });
    });

    body.appendChild(ui.el('div', { class: 'form-grid' }, [
      ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-import-team', text: 'Team' }), teamSelect]),
      ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-import-kind', text: 'Source' }), kindSelect]),
      ui.el('div', { class: 'field field--full' }, [ui.el('label', { for: 'ndocs-import-value', text: 'Value' }), valueInput, help])
    ]));
    body.appendChild(ui.el('div', { class: 'button-row' }, [run]));
  }

  // ---- (f) audit query ----

  function renderAuditResults(data, resultsEl) {
    resultsEl.textContent = '';
    resultsEl.appendChild(ui.el('p', { class: 'meta', text: data.total + ' entrie(s).' }));
    if ((data.unattributedDrift || []).length) {
      resultsEl.appendChild(ui.el('div', { class: 'status-panel status-panel--attention' }, [
        ui.el('div', {}, [
          ui.el('strong', { text: 'Unattributed drift' }),
          ui.el('p', { text: data.unattributedDrift.join(', ') })
        ])
      ]));
    }
    var table = ui.el('table', { class: 'ndocs-table' });
    var thead = ui.el('thead', {}, [ui.el('tr', {}, [
      ui.el('th', { text: 'At' }), ui.el('th', { text: 'Record' }), ui.el('th', { text: 'Action' }), ui.el('th', { text: 'Actor' })
    ])]);
    var tbody = ui.el('tbody', {});
    (data.entries || []).forEach(function (a) {
      tbody.appendChild(ui.el('tr', {}, [
        ui.el('td', { text: a.at }), ui.el('td', { text: a.record_id }),
        ui.el('td', { text: a.action }), ui.el('td', { text: a.actor_email })
      ]));
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    resultsEl.appendChild(table);
  }

  function renderAuditQuery(body) {
    body.textContent = '';
    var resourceIdInput = ui.el('input', { type: 'text', id: 'ndocs-audit-resource', placeholder: 'Resource ID (optional)' });
    var teamIdInput = ui.el('input', { type: 'text', id: 'ndocs-audit-team', placeholder: 'Team ID (optional)' });
    var results = ui.el('div', {});
    var run = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Query' });
    run.addEventListener('click', function () {
      call('admin_query_audit', {
        resourceId: resourceIdInput.value || undefined, teamId: teamIdInput.value || undefined,
        page: 1, pageSize: 50
      }).then(function (data) { renderAuditResults(data, results); })
        .catch(function (err) { ui.toast('Could not query: ' + err.message, 'warn'); });
    });
    body.appendChild(ui.el('div', { class: 'form-grid' }, [
      ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-audit-resource', text: 'Resource ID' }), resourceIdInput]),
      ui.el('div', { class: 'field' }, [ui.el('label', { for: 'ndocs-audit-team', text: 'Team ID' }), teamIdInput])
    ]));
    body.appendChild(ui.el('div', { class: 'button-row' }, [run]));
    body.appendChild(results);
  }

  // ---- (g) job status ----

  function renderJobStatus(jobs, body) {
    body.textContent = '';
    var table = ui.el('table', { class: 'ndocs-table' });
    var thead = ui.el('thead', {}, [ui.el('tr', {}, [
      ui.el('th', { text: 'Job' }), ui.el('th', { text: 'Last run' }), ui.el('th', { text: 'Outcome' })
    ])]);
    var tbody = ui.el('tbody', {});
    jobs.forEach(function (j) {
      tbody.appendChild(ui.el('tr', {}, [
        ui.el('td', { text: j.name }),
        ui.el('td', { text: j.lastRunAt || 'never run' }),
        ui.el('td', { text: j.lastOutcome || '—' })
      ]));
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    body.appendChild(table);
  }

  function loadJobs(body) {
    call('admin_job_status', {}).then(function (data) { renderJobStatus(data.jobs, body); })
      .catch(function (err) {
        sectionError(body, 'Could not load job status: ' + err.message, function () { loadJobs(body); });
      });
  }

  // ---- (h) integrity check ----

  function renderIntegrity(body, initialSummary) {
    body.textContent = '';
    var result = ui.el('p', { role: 'status' }, [
      document.createTextNode(initialSummary.integrityIssueCount === null
        ? 'Not yet checked in this container.'
        : initialSummary.integrityIssueCount + ' gap(s) as of the last check.')
    ]);
    var run = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Run integrity check' });
    run.addEventListener('click', function () {
      run.disabled = true;
      call('admin_verify_integrity', {}).then(function (data) {
        run.disabled = false;
        var msg = data.gaps.length
          ? data.gaps.length + ' gap(s) found — see the ErrorLog sheet for detail.'
          : 'No gaps found.';
        result.textContent = msg;
        ui.announce(msg);
      }).catch(function (err) {
        run.disabled = false;
        ui.toast('Could not verify: ' + err.message, 'warn');
      });
    });
    body.appendChild(ui.el('p', { class: 'field-help', text: 'This runs a real reconciliation and writes to the ErrorLog sheet — it never runs automatically or on page load.' }));
    body.appendChild(ui.el('div', { class: 'button-row' }, [run]));
    body.appendChild(result);
  }

  function load() {
    loadSummary().then(function (summary) {
      var findingsOpen = summary.openFindingCount > 0;

      var findings = disclosureSection('findings', 'Findings queue (every team)', {
        meta: summary.openFindingCount + ' open', open: findingsOpen
      });
      var integrity = disclosureSection('integrity', 'Catalog integrity', {
        meta: summary.integrityIssueCount === null ? 'not yet checked' : summary.integrityIssueCount + ' issue(s)'
      });
      var jobs = disclosureSection('jobs', 'Job status', { meta: summary.runningJobCount + ' running' });
      var vocabulary = disclosureSection('vocabulary', 'Controlled values');
      var provisions = disclosureSection('provisions', 'Provisions');
      var bulkImport = disclosureSection('bulk-import', 'Bulk import');
      var audit = disclosureSection('audit', 'Audit query');

      els.sections.textContent = '';
      [findings, integrity, jobs, vocabulary, provisions, bulkImport, audit].forEach(function (s) {
        els.sections.appendChild(s.details);
      });

      loadQueue(findings.body);
      renderIntegrity(integrity.body, summary);
      loadJobs(jobs.body);
      renderAuditQuery(audit.body);
      loadProvisions(provisions.body);
      NDocsVocab.load().then(function (data) {
        renderVocab(data.vocab || {}, data.vocabDefinitions || [], vocabulary.body);
        renderImport(data.teams || [], bulkImport.body);
      });

      // A fragment link into a section (e.g. from the summary above, or an external deep
      // link) should land on an OPEN section, not a collapsed one.
      if (window.location.hash) {
        var target = document.getElementById(window.location.hash.slice(1));
        if (target && target.tagName === 'DETAILS') target.open = true;
      }
    });
  }

  function init() {
    summaryEl = document.getElementById('ndocs-tools-summary');
    els.sections = document.getElementById('ndocs-tools-sections');

    return NDocsTransport.call('whoami', {}).then(function (principal) {
      NDocsSession.setPrincipal(principal);
      if (!principal.isAdmin) {
        NDocsShell.region(els.sections, 'permission-denied', { message: 'You are not an administrator.' });
        return principal;
      }
      load();
      return principal;
    });
  }

  // Same "the page decides when a session exists" contract as page-team.js/page-resource.js.
  window.NDocsPageTools = { start: init };
})();
