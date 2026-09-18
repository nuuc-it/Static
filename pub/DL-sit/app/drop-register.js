// app/drop-register.js — the drop-to-register surface (UC-19), mounted from catalog.html's
// "Add document to the catalog" panel (page-search.js). DESIGN.md §Register by dropping a
// Drive link fixes the sequence precisely enough that a second copy would drift — team.html
// has no drop-to-register surface of its own to share this with (found live 2026-09-18
// correcting this file's own stale "shared by index.html and team.html" claim).
//
// What the browser gets on a drop from Drive is a text/uri-list — a link, not a file. This
// module reads only that: a drop carrying dataTransfer.files is a local upload and is
// refused outright, since hosting files is a non-goal and no upload could produce a
// catalogable Drive URL. There is no fallback path that quietly accepts anything else.
//
// During dragover the drag data store is in protected mode — types and items[].kind are
// readable, getData() is not — so the target can say "this is a link" early and cannot
// know which link until drop. Placement is therefore checked on drop, in one round-trip,
// before any form renders. A late refusal is the version people remember.
var NDocsDropRegister = (function () {
  'use strict';

  var ui = NDocsUI;

  // Walkthrough affordance only: real Drive drags are not available in every browser
  // session, and the mock resolves placement from the URL. Real Drive links resolve the
  // same way through inspect_url, so this input disappears without changing the flow.
  var SAMPLE_LINKS = [
    { label: 'a document in a tracked team folder', url: 'https://docs.google.com/document/d/drv-cand-1/edit' },
    { label: 'a document in a folder the team does not use', url: 'https://docs.google.com/document/d/loose-doc-42/edit' },
    { label: 'a document in somebody\'s personal Drive', url: 'https://docs.google.com/document/d/mydrive-notes/edit' },
    { label: 'a document the system cannot see', url: 'https://docs.google.com/document/d/unknown-doc/edit' }
  ];

  // mount(container, opts) — opts: { principal, teamId?, onRegistered? }.
  function mount(container, opts) {
    opts = opts || {};
    var principal = opts.principal || {};
    var teams = principal.teams || [];
    var panel = ui.el('div', { class: 'ndocs-drop-panel' });
    var zone = ui.el('div', {
      class: 'ndocs-dropzone', tabindex: '0', role: 'button',
      'aria-label': 'Drop a Drive link here to register a document'
    }, [
      ui.el('p', { class: 'ndocs-dropzone__headline', text: 'Drag a document here from Drive' }),
      ui.el('p', { class: 'ndocs-dropzone__hint', text: 'The document stays where it is. Nothing is uploaded and nothing is moved.' })
    ]);
    var outcome = ui.el('div', { class: 'ndocs-drop-outcome', 'aria-live': 'polite' });

    panel.appendChild(zone);
    panel.appendChild(renderFolderGuide(teams, opts.teamId));
    panel.appendChild(renderLinkFallback(function (url) { handleUrl(url, outcome, opts); }));
    panel.appendChild(outcome);
    container.appendChild(panel);

    wireDropTarget(zone, outcome, opts);
    return panel;
  }

  // The real prevention (DESIGN.md): a document dragged out of a window that was opened on
  // a tracked folder is in a tracked folder by construction. So the folders are listed
  // beside the target, openable, rather than described after the fact.
  function renderFolderGuide(teams, teamId) {
    var relevant = teamId ? teams.filter(function (t) { return t.teamId === teamId; }) : teams;
    var wrap = ui.el('div', { class: 'ndocs-drop-folders' });
    wrap.appendChild(ui.el('h3', { text: 'Your team folders' }));
    if (!relevant.length) {
      wrap.appendChild(ui.el('p', { text: 'You do not belong to a team with folders yet.' }));
      return wrap;
    }
    relevant.forEach(function (team) {
      var list = ui.el('ul', { class: 'ndocs-folder-list' });
      (team.folders || []).forEach(function (folder) {
        // The full path, not just the leaf name — a leaf name alone doesn't say which
        // drive it starts from, and that's exactly the distinction that matters here
        // (a shared drive vs. somebody's personal Drive).
        var link = ui.el('a', {
          href: folder.url || '#', target: '_blank', rel: 'noopener',
          text: folder.path || folder.name
        });
        list.appendChild(ui.el('li', {}, [link]));
      });
      if (!(team.folders || []).length) {
        list.appendChild(ui.el('li', { text: 'No folders yet — the first document you register brings its folder into scope.' }));
      }
      wrap.appendChild(ui.el('h4', { text: team.name }));
      wrap.appendChild(list);
    });
    return wrap;
  }

  // The team list and every vocab select here are administrator-controlled (`Teams` sheet,
  // `Config`'s `vocab.*` rows via `admin_upsert_vocab`) — a member who needs a new team or a
  // new controlled value cannot add one from this form, and previously had no way to know
  // that was even the right next step rather than a bug. `admin_upsert_vocab` has a real
  // destination (tools.html's "Controlled values" panel), so that hint names it; team
  // creation (`admin_upsert_team`) has no page anywhere in this app yet (`NDocs-<pending>`,
  // found live during this same pass) — naming a page that does not exist would just move
  // the confusion, so that hint asks the administrator directly instead.
  function renderAdminHint(missingWhat) {
    var text = missingWhat === 'team'
      ? "Don't see your team? Ask an administrator to add it."
      : "Don't see the " + missingWhat + " you need? Ask an administrator to add it under Tools → Controlled values.";
    return ui.el('p', { class: 'field-help', text: text });
  }

  function renderLinkFallback(onSubmit) {
    var input = ui.el('input', { type: 'url', class: 'ndocs-drop-url', placeholder: 'or paste a Drive link' });
    var button = ui.el('button', { type: 'button', text: 'Check this link' });
    button.addEventListener('click', function () {
      if (!input.value) { ui.toast('Paste a link first.', 'warn'); return; }
      onSubmit(input.value);
    });
    var samples = ui.el('ul', { class: 'ndocs-drop-samples' });
    SAMPLE_LINKS.forEach(function (sample) {
      var link = ui.el('a', { href: '#', text: sample.label });
      link.addEventListener('click', function (e) {
        e.preventDefault();
        input.value = sample.url;
        onSubmit(sample.url);
      });
      samples.appendChild(ui.el('li', {}, [link]));
    });
    return ui.el('div', { class: 'ndocs-drop-fallback' }, [
      ui.el('label', { text: 'Paste a link' }), input, button,
      ui.el('p', { class: 'ndocs-dropzone__hint', text: 'Mockup shortcuts — try each placement:' }),
      samples
    ]);
  }

  function wireDropTarget(zone, outcome, opts) {
    function kindOf(dataTransfer) {
      var types = Array.prototype.slice.call((dataTransfer && dataTransfer.types) || []);
      if (types.indexOf('Files') !== -1) return 'file';
      if (types.indexOf('text/uri-list') !== -1) return 'link';
      return 'other';
    }

    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      var kind = kindOf(e.dataTransfer);
      zone.classList.toggle('ndocs-dropzone--over', kind === 'link');
      zone.classList.toggle('ndocs-dropzone--reject', kind !== 'link');
      // The one thing knowable before the drop, said before the drop.
      zone.setAttribute('data-drag-kind', kind);
      if (e.dataTransfer) e.dataTransfer.dropEffect = kind === 'link' ? 'link' : 'none';
    });

    zone.addEventListener('dragleave', function () {
      zone.classList.remove('ndocs-dropzone--over', 'ndocs-dropzone--reject');
      zone.removeAttribute('data-drag-kind');
    });

    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('ndocs-dropzone--over', 'ndocs-dropzone--reject');
      zone.removeAttribute('data-drag-kind');
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) {
        renderMessage(outcome, 'warn', 'That is a file from this computer.',
          'The Catalog records where a document lives in Drive; it never stores the document. Put the file in your team\'s Drive folder first, then drag it from there.');
        return;
      }
      var url = (dt && (dt.getData('text/uri-list') || dt.getData('text/plain')) || '').split('\n')[0].trim();
      if (!/^https?:\/\//i.test(url)) {
        renderMessage(outcome, 'warn', 'That was not a link.',
          'Drag the document itself out of Drive, or paste its link below.');
        return;
      }
      handleUrl(url, outcome, opts);
    });
  }

  function renderMessage(outcome, kind, headline, detail, extraNodes) {
    outcome.textContent = '';
    var box = ui.el('div', { class: 'ndocs-drop-result ndocs-drop-result--' + kind }, [
      ui.el('h3', { text: headline }),
      ui.el('p', { text: detail })
    ]);
    (extraNodes || []).forEach(function (node) { box.appendChild(node); });
    outcome.appendChild(box);
  }

  // One round-trip on drop, before any form renders.
  function handleUrl(url, outcome, opts) {
    renderMessage(outcome, 'info', 'Looking at that document…', url);
    NDocsTransport.call('inspect_url', { url: url }).then(function (inspect) {
      if (inspect.duplicateOf) {
        var link = ui.el('a', {
          href: 'resource.html?id=' + encodeURIComponent(inspect.duplicateOf),
          text: 'Open ' + inspect.duplicateOf
        });
        renderMessage(outcome, 'info', 'Already in the Catalog.',
          'This document is registered. Opening the existing record rather than making a second one.', [link]);
        return;
      }
      var placement = inspect.placement || {};
      if (placement.registrable === false) {
        renderRefusal(outcome, inspect, opts);
        return;
      }
      renderEntry(outcome, url, inspect, opts);
    }).catch(function (err) {
      renderMessage(outcome, 'warn', 'Could not read that document.', err.message);
    });
  }

  // A my_drive or unknown refusal names the problem and stops there. It used to offer to
  // open the team's declared asset location, but nothing declares one any more (ADR-0010,
  // amended) — choosing the folder is the actor's call. The move is the actor's step
  // either way, taken in Drive under their own permissions: the Catalog has no Drive write
  // scope and could not perform it even if it wanted to (DESIGN.md §Remediation).
  function renderRefusal(outcome, inspect, opts) {
    var placement = inspect.placement || {};
    var extras = [];
    extras.push(ui.el('p', {
      class: 'ndocs-dropzone__hint',
      text: 'Move the document onto a shared drive in Drive, then drag it here again.'
    }));
    var headline = placement.locationKind === 'my_drive'
      ? 'This document is in a personal Drive.'
      : 'The system cannot see where this document lives.';
    var detail = placement.locationKind === 'my_drive'
      ? 'A document in somebody\'s personal Drive disappears when that person leaves, which is the exact loss the Catalog exists to prevent. It cannot be registered from there.'
      : 'Without knowing where it lives, the Catalog cannot keep the record truthful — no reachability check, no metadata refresh, no header reconciliation.';
    renderMessage(outcome, 'warn', headline, detail, extras);
  }

  function formatDate(iso) {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
  }

  // One round-trip already told us everything a person needs to recognize the document and
  // decide it's the right one — there is nothing left to type in most cases (`inspect_url`'s
  // `header.title` is now always populated: real heading, bold text, or the Drive filename as
  // last resort, `NDocs-jtn`). So this is a preview to confirm, not a form to fill in: the
  // only genuinely open question is the owning team, and only when the folder doesn't answer
  // it unambiguously. Everything else — Purpose, Type, Audience, Discovery, Topics,
  // Maintainer — is filled in a moment later on the record's own page (`renderEditor` in
  // `page-resource.js`), the one editor every path through this app uses.
  function renderEntry(outcome, url, inspect, opts) {
    var principal = opts.principal || {};
    var teams = principal.teams || [];
    var matches = inspect.teamMatches || [];
    var derived = inspect.derived || {};
    var placement = inspect.placement || {};
    var header = inspect.header || {};

    outcome.textContent = '';
    var box = ui.el('div', { class: 'ndocs-drop-result ndocs-drop-result--ok' });
    box.appendChild(ui.el('h3', { text: 'Add this document' }));

    var folderText = derived.folderPath || derived.folderName || 'unresolved';
    var folderValue = derived.folderUrl
      ? ui.el('a', { href: derived.folderUrl, target: '_blank', rel: 'noopener', text: folderText })
      : ui.el('span', { text: folderText });

    var previewPairs = [
      ['Title', header.title || derived.filename],
      ['Purpose', header.purpose || null],
      ['Folder', folderValue],
      ['File name', derived.filename],
      ['Last modified', formatDate(derived.modifiedAt)],
      ['Last modified by', derived.lastModifyingUserName ||
        derived.lastModifyingUserEmail || null]
    ];
    var dl = ui.el('dl', { class: 'detail-list' });
    previewPairs.forEach(function (pair) {
      if (pair[1] === null || pair[1] === undefined || pair[1] === '') return;
      dl.appendChild(ui.el('dt', { text: pair[0] }));
      if (typeof pair[1] === 'object') dl.appendChild(ui.el('dd', {}, [pair[1]]));
      else dl.appendChild(ui.el('dd', { text: pair[1] }));
    });
    box.appendChild(dl);
    if (!header.purpose) {
      box.appendChild(ui.el('p', { class: 'ndocs-dropzone__hint', text: 'The document names no purpose yet — you\'ll be asked for one on the next screen.' }));
    }

    // The team is preselected only on an unambiguous folder match: none leaves it to choose
    // (UC-19 A2), several ask which one owns it (A3) — either way the person picks it here
    // because nothing later in the flow has a better answer than they do.
    var teamSelect = null;
    if (matches.length === 1 && !opts.teamId) {
      var onlyTeam = teams.filter(function (t) { return t.teamId === matches[0]; })[0];
      dl.appendChild(ui.el('dt', { text: 'Owning team' }));
      dl.appendChild(ui.el('dd', { text: (onlyTeam && onlyTeam.name) || matches[0] }));
    } else if (!opts.teamId) {
      teamSelect = ui.el('select', {});
      teamSelect.appendChild(ui.el('option', { value: '', text: 'Choose a team' }));
      teams.forEach(function (t) {
        teamSelect.appendChild(ui.el('option', { value: t.teamId, text: t.name }));
      });
      box.appendChild(ui.el('div', { class: 'field' }, [
        ui.el('label', { text: matches.length > 1 ? 'More than one team uses this folder — which one owns it?' : 'No team claims this folder — choose the owning team' }),
        teamSelect,
        renderAdminHint('team')
      ]));
    }

    // A folder placement that is merely unusual is a question, not a refusal (UC-19 A7).
    var ackBox = null;
    if ((placement.questions || []).indexOf('untracked_folder') !== -1) {
      ackBox = ui.el('input', { type: 'checkbox' });
      var ackLabel = ui.el('label', { class: 'ndocs-ack' }, [
        ackBox,
        ui.el('span', { text: ' This is the right place for it. Registering it brings ' + (derived.folderName || 'this folder') + ' into scope for future scans.' })
      ]);
      box.appendChild(ui.el('div', { class: 'ndocs-drop-question' }, [
        ui.el('p', { text: 'This folder is not one the team already uses.' }),
        ackLabel
      ]));
    }

    var submit = ui.el('button', { type: 'button', class: 'button button--primary', text: 'Add & edit details' });
    submit.addEventListener('click', function () {
      var teamId = opts.teamId || (teamSelect ? teamSelect.value : matches[0]);
      if (!teamId) { ui.toast('Choose the owning team.', 'warn'); return; }
      if (ackBox && !ackBox.checked) { ui.toast('Confirm the folder placement first.', 'warn'); return; }
      submit.disabled = true;
      var fields = { title: header.title || derived.filename, source_url: url };
      // `Contract.js`'s `Resources` field names, verbatim — `source_url`, not `url`. Nothing
      // else from this preview is sent: type/audience/discovery/topics/maintainer are all
      // optional at registration (`RegistryService_register` requires only `title`) and are
      // filled in immediately after on resource.html, not duplicated into a second form here.
      if (header.purpose) fields.purpose = header.purpose;
      NDocsTransport.call('register_resource', {
        teamId: teamId,
        fields: fields,
        derived: derived,
        placementAck: ackBox ? !!ackBox.checked : undefined
      }).then(function (result) {
        ui.toast('Added ' + result.record.doc_id + ' (' + result.record.resource_id + ').', 'info');
        if (opts.onRegistered) opts.onRegistered(result.record);
        else window.location.href = 'resource.html?id=' + encodeURIComponent(result.record.resource_id) + '&edit=1&new=1';
      }).catch(function (err) {
        submit.disabled = false;
        // The same refusals, re-derived on the write path — the UI is never trusted with
        // them, so a stale page gets the same answer as a fresh one.
        if (err.data && err.data.reason === 'placement_refused') {
          renderRefusal(outcome, { placement: { locationKind: err.data.locationKind, registrable: false } }, opts);
          return;
        }
        if (err.code === 'validation_failed') {
          ui.toast('Fix these fields: ' + ((err.data && err.data.fields) || []).join(', '), 'warn');
          return;
        }
        ui.toast('Could not register: ' + err.message, 'warn');
      });
    });
    box.appendChild(submit);
    outcome.appendChild(box);
  }

  return { mount: mount };
})();
