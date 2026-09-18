// app/page-admin.js — admin.html controller (Stage 15 `admin-governance`, `NDocs-zrg`).
// Rebuilt from scratch — the deleted `ndocs/admin.html`/mockup-era `app/page-admin.js` were
// retired in the `static-src/` migration (Stage 6-era) and never recreated; this file follows
// `static-src/app/page-team.js`'s conventions (thin section renderers, `NDocsTransport.call`
// per action, reload-the-panel-on-success), not the deleted mockup's field names or shape.
//
// Sections, one per `knowledge-base/staging/ndocs-build.md` §15 point 6: (a) cross-team queue
// (`admin_list_findings` — the one cross-team view this stage builds; no cross-team candidate
// route exists in webapp-actions.md, so a per-team candidate check stays `team.html`'s job,
// per that section's own judgment call); (b) team administration (`admin_set_team_state`,
// `admin_reassign_resources`); (c) controlled values (`admin_upsert_vocab`); (d) provisions
// (`list_provisions`, `admin_mark_provision_revised`); (e) bulk import
// (`admin_import_candidates`, both source kinds); (f) audit query (`admin_query_audit`);
// (g) job status (`admin_job_status`, read-only — no run buttons, Stage 14 owns triggering
// real jobs); (h) "Verify Catalog Integrity" (`admin_verify_integrity`).
(function () {
  'use strict';

  var ui = NDocsUI;
  var els = {};

  function call(action, payload) {
    return NDocsTransport.call(action, payload || {});
  }

  // ---- (a) cross-team findings queue ----

  function renderQueue(findings) {
    els.queue.textContent = '';
    els.queue.appendChild(ui.el('h2', { text: 'Findings queue (every team)' }));
    if (!findings.length) {
      els.queue.appendChild(ui.el('p', { text: 'No findings.' }));
      return;
    }
    var table = ui.el('table', { class: 'ndocs-table' });
    var thead = ui.el('thead', {}, [ui.el('tr', {}, [
      ui.el('th', { text: 'Team' }), ui.el('th', { text: 'Kind' }), ui.el('th', { text: 'Resource' }),
      ui.el('th', { text: 'State' }), ui.el('th', { text: 'Detected' })
    ])]);
    var tbody = ui.el('tbody', {});
    findings.forEach(function (f) {
      tbody.appendChild(ui.el('tr', {}, [
        ui.el('td', { text: f.team_id }),
        ui.el('td', { text: f.kind }),
        ui.el('td', {}, [ui.el('a', { href: 'resource.html?id=' + encodeURIComponent(f.resource_id), text: f.resource_id })]),
        ui.el('td', { text: f.state }),
        ui.el('td', { text: f.detected_at ? new Date(f.detected_at).toLocaleDateString() : '—' })
      ]));
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    els.queue.appendChild(table);
  }

  function loadQueue() {
    call('admin_list_findings', {}).then(function (data) { renderQueue(data.findings); })
      .catch(function (err) { ui.toast('Could not load the queue: ' + err.message, 'warn'); });
  }

  // ---- (b) team administration ----

  function renderTeamAdmin(teams) {
    els.teams.textContent = '';
    els.teams.appendChild(ui.el('h2', { text: 'Teams' }));
    var table = ui.el('table', { class: 'ndocs-table' });
    var tbody = ui.el('tbody', {});
    teams.forEach(function (t) {
      var stateSelect = ui.el('select', {});
      ['active', 'inactive', 'merged'].forEach(function (s) {
        var opt = ui.el('option', { value: s, text: s });
        if (s === t.state) opt.setAttribute('selected', 'selected');
        stateSelect.appendChild(opt);
      });
      var successorInput = ui.el('input', { type: 'text', placeholder: 'successor team id (if merged)' });
      var apply = ui.el('button', { type: 'button', text: 'Apply' });
      apply.addEventListener('click', function () {
        apply.disabled = true;
        call('admin_set_team_state', {
          teamId: t.teamId, state: stateSelect.value, successorTeamId: successorInput.value || undefined
        }).then(function (result) {
          ui.toast('Updated. ' + result.affectedResources + ' resource(s) still assigned to this team.', 'info');
          loadTeams();
        }).catch(function (err) {
          apply.disabled = false;
          ui.toast('Could not update: ' + err.message, 'warn');
        });
      });
      tbody.appendChild(ui.el('tr', {}, [
        ui.el('td', { text: t.name + ' (' + t.teamId + ')' }),
        ui.el('td', {}, [stateSelect]),
        ui.el('td', {}, [successorInput]),
        ui.el('td', {}, [apply])
      ]));
    });
    table.appendChild(tbody);
    els.teams.appendChild(table);

    // Reassignment — a free-form resource-id list plus a destination team, per
    // `admin_reassign_resources`'s own payload shape.
    var idsInput = ui.el('input', { type: 'text', placeholder: 'Resource IDs, comma-separated' });
    var toTeamSelect = ui.el('select', {});
    toTeamSelect.appendChild(ui.el('option', { value: '', text: '(unresolved queue)' }));
    teams.forEach(function (t) { toTeamSelect.appendChild(ui.el('option', { value: t.teamId, text: t.name })); });
    var reassign = ui.el('button', { type: 'button', text: 'Reassign' });
    reassign.addEventListener('click', function () {
      var ids = idsInput.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!ids.length) { ui.toast('Name at least one Resource ID.', 'warn'); return; }
      call('admin_reassign_resources', { resourceIds: ids, toTeamId: toTeamSelect.value || undefined })
        .then(function (result) {
          ui.toast('Applied: ' + result.applied.length + ', skipped: ' + result.skipped.length + '.', 'info');
        }).catch(function (err) { ui.toast('Could not reassign: ' + err.message, 'warn'); });
    });
    els.teams.appendChild(ui.el('div', { class: 'ndocs-admin-row' }, [
      ui.el('h3', { text: 'Reassign resources' }), idsInput, toTeamSelect, reassign
    ]));
  }

  function loadTeams() {
    NDocsVocab.load().then(function (data) { renderTeamAdmin(data.teams || []); })
      .catch(function (err) { ui.toast('Could not load teams: ' + err.message, 'warn'); });
  }

  // ---- (c) controlled values ----

  function renderVocab(vocab) {
    els.vocab.textContent = '';
    els.vocab.appendChild(ui.el('h2', { text: 'Controlled values' }));
    var kindInput = ui.el('input', { type: 'text', placeholder: 'kind (e.g. type, audience, topics, discovery)' });
    var valuesInput = ui.el('textarea', { rows: 3, placeholder: 'One value per line' });
    Object.keys(vocab || {}).forEach(function (kind) {
      valuesInput.value = ''; // seeded per-kind on load below, not here
    });
    var loadKindButton = ui.el('button', { type: 'button', text: 'Load' });
    loadKindButton.addEventListener('click', function () {
      valuesInput.value = (vocab[kindInput.value] || []).join('\n');
    });
    var save = ui.el('button', { type: 'button', text: 'Save' });
    save.addEventListener('click', function () {
      var values = valuesInput.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      call('admin_upsert_vocab', { kind: kindInput.value, values: values }).then(function () {
        ui.toast('Saved.', 'info');
        try { sessionStorage.clear(); } catch (e) { /* ignore */ }
      }).catch(function (err) {
        if (err.code === 'conflict') {
          ui.toast('In use by: ' + ((err.data && err.data.usingRecords) || []).join(', '), 'warn');
          return;
        }
        ui.toast('Could not save: ' + err.message, 'warn');
      });
    });
    els.vocab.appendChild(ui.el('div', { class: 'ndocs-admin-row' }, [kindInput, loadKindButton, valuesInput, save]));
  }

  // ---- (d) provisions ----

  function renderProvisions(provisions) {
    els.provisions.textContent = '';
    els.provisions.appendChild(ui.el('h2', { text: 'Provisions' }));
    var table = ui.el('table', { class: 'ndocs-table' });
    var thead = ui.el('thead', {}, [ui.el('tr', {}, [
      ui.el('th', { text: 'ID' }), ui.el('th', { text: 'Title' }), ui.el('th', { text: 'State' }),
      ui.el('th', { text: 'Current uses' }), ui.el('th', { text: 'Mark revised' })
    ])]);
    var tbody = ui.el('tbody', {});
    provisions.forEach(function (p) {
      var withdrawnCheckbox = ui.el('input', { type: 'checkbox' });
      var markButton = ui.el('button', { type: 'button', text: 'Mark revised' });
      markButton.addEventListener('click', function () {
        markButton.disabled = true;
        call('admin_mark_provision_revised', {
          provisionId: p.provision_id, withdrawn: withdrawnCheckbox.checked || undefined
        }).then(function (result) {
          ui.toast(result.affected + ' resource(s) now carry a review request.', 'info');
          loadProvisions();
        }).catch(function (err) {
          markButton.disabled = false;
          ui.toast('Could not mark revised: ' + err.message, 'warn');
        });
      });
      tbody.appendChild(ui.el('tr', {}, [
        ui.el('td', { text: p.provision_id }),
        ui.el('td', { text: p.title }),
        ui.el('td', { text: p.state }),
        ui.el('td', { text: String(p.currentCount) }),
        ui.el('td', {}, [ui.el('label', {}, [withdrawnCheckbox, ' withdrawn ']), markButton])
      ]));
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    els.provisions.appendChild(table);
  }

  function loadProvisions() {
    call('list_provisions', {}).then(function (data) { renderProvisions(data.provisions); })
      .catch(function (err) { ui.toast('Could not load provisions: ' + err.message, 'warn'); });
  }

  // ---- (e) bulk import ----

  function renderImport(teams) {
    els.importSection.textContent = '';
    els.importSection.appendChild(ui.el('h2', { text: 'Bulk import' }));
    var teamSelect = ui.el('select', {});
    teams.forEach(function (t) { teamSelect.appendChild(ui.el('option', { value: t.teamId, text: t.name })); });
    var kindSelect = ui.el('select', {});
    kindSelect.appendChild(ui.el('option', { value: 'folder', text: 'Folder (scanned and judged)' }));
    kindSelect.appendChild(ui.el('option', { value: 'list', text: 'Named files (trusted, not judged)' }));
    var valueInput = ui.el('textarea', {
      rows: 3, placeholder: 'folder: one folder URL/id. list: one Drive URL or file id per line.'
    });
    var run = ui.el('button', { type: 'button', text: 'Import' });
    run.addEventListener('click', function () {
      var value = kindSelect.value === 'folder'
        ? valueInput.value.trim()
        : valueInput.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      run.disabled = true;
      call('admin_import_candidates', { teamId: teamSelect.value, source: { kind: kindSelect.value, value: value } })
        .then(function (result) {
          run.disabled = false;
          ui.toast('Created ' + result.created + ', skipped ' + result.duplicatesSkipped + ' duplicate(s).', 'info');
        }).catch(function (err) {
          run.disabled = false;
          ui.toast('Could not import: ' + err.message, 'warn');
        });
    });
    els.importSection.appendChild(ui.el('div', { class: 'ndocs-admin-row' }, [teamSelect, kindSelect, valueInput, run]));
  }

  // ---- (f) audit query ----

  function renderAuditResults(data) {
    els.auditResults.textContent = '';
    els.auditResults.appendChild(ui.el('p', { text: data.total + ' entrie(s).' }));
    if ((data.unattributedDrift || []).length) {
      els.auditResults.appendChild(ui.el('p', {
        class: 'ndocs-chip ndocs-chip--warn',
        text: 'Unattributed drift: ' + data.unattributedDrift.join(', ')
      }));
    }
    var table = ui.el('table', { class: 'ndocs-table' });
    var thead = ui.el('thead', {}, [ui.el('tr', {}, [
      ui.el('th', { text: 'At' }), ui.el('th', { text: 'Record' }), ui.el('th', { text: 'Action' }),
      ui.el('th', { text: 'Actor' })
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
    els.auditResults.appendChild(table);
  }

  function renderAuditQuery() {
    els.audit.textContent = '';
    els.audit.appendChild(ui.el('h2', { text: 'Audit query' }));
    var resourceIdInput = ui.el('input', { type: 'text', placeholder: 'Resource ID (optional)' });
    var teamIdInput = ui.el('input', { type: 'text', placeholder: 'Team ID (optional)' });
    els.auditResults = ui.el('div', {});
    var run = ui.el('button', { type: 'button', text: 'Query' });
    run.addEventListener('click', function () {
      call('admin_query_audit', {
        resourceId: resourceIdInput.value || undefined, teamId: teamIdInput.value || undefined,
        page: 1, pageSize: 50
      }).then(renderAuditResults).catch(function (err) { ui.toast('Could not query: ' + err.message, 'warn'); });
    });
    els.audit.appendChild(ui.el('div', { class: 'ndocs-admin-row' }, [resourceIdInput, teamIdInput, run]));
    els.audit.appendChild(els.auditResults);
  }

  // ---- (g) job status ----

  function renderJobStatus(jobs) {
    els.jobs.textContent = '';
    els.jobs.appendChild(ui.el('h2', { text: 'Job status' }));
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
    els.jobs.appendChild(table);
  }

  function loadJobs() {
    call('admin_job_status', {}).then(function (data) { renderJobStatus(data.jobs); })
      .catch(function (err) { ui.toast('Could not load job status: ' + err.message, 'warn'); });
  }

  // ---- (h) integrity check ----

  function renderIntegrity() {
    els.integrity.textContent = '';
    els.integrity.appendChild(ui.el('h2', { text: 'Catalog integrity' }));
    var result = ui.el('p', {});
    var run = ui.el('button', { type: 'button', text: 'Verify Catalog Integrity' });
    run.addEventListener('click', function () {
      run.disabled = true;
      call('admin_verify_integrity', {}).then(function (data) {
        run.disabled = false;
        result.textContent = data.gaps.length
          ? data.gaps.length + ' gap(s) found — see the ErrorLog sheet for detail.'
          : 'No gaps found.';
      }).catch(function (err) {
        run.disabled = false;
        ui.toast('Could not verify: ' + err.message, 'warn');
      });
    });
    els.integrity.appendChild(run);
    els.integrity.appendChild(result);
  }

  function load() {
    loadQueue();
    loadTeams();
    loadProvisions();
    loadJobs();
    renderAuditQuery();
    renderIntegrity();
    NDocsVocab.load().then(function (data) {
      renderVocab(data.vocab || {});
      renderImport(data.teams || []);
    });
  }

  function init() {
    els.queue = document.getElementById('ndocs-admin-queue');
    els.teams = document.getElementById('ndocs-admin-teams');
    els.vocab = document.getElementById('ndocs-admin-vocab');
    els.provisions = document.getElementById('ndocs-admin-provisions');
    els.importSection = document.getElementById('ndocs-admin-import');
    els.audit = document.getElementById('ndocs-admin-audit');
    els.jobs = document.getElementById('ndocs-admin-jobs');
    els.integrity = document.getElementById('ndocs-admin-integrity');

    NDocsTransport.call('whoami', {}).then(function (principal) {
      NDocsSession.setPrincipal(principal);
      if (!principal.isAdmin) {
        ui.toast('You are not an administrator.', 'warn');
        return;
      }
      load();
    }).catch(function () { /* already-known-signed-in by the time start() runs */ });
  }

  // Same "the page decides when a session exists" contract as page-team.js/page-resource.js.
  window.NDocsPageAdmin = { start: init };
})();
