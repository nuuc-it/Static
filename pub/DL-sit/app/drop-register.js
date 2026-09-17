// app/drop-register.js — the drop-to-register surface (UC-19), shared by the catalog
// listing (index.html) and the team page's Register panel (team.html). One module because
// it is one interaction reached from two places, and DESIGN.md §Register by dropping a
// Drive link fixes the sequence precisely enough that two copies would drift.
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

  // Everything the document declares arrives as a proposal and is presented for
  // confirmation, never saved silently (ADR-0005). The team is preselected only on an
  // unambiguous folder match: none leaves it empty (UC-19 A2), several ask (A3).
  function renderEntry(outcome, url, inspect, opts) {
    var principal = opts.principal || {};
    var teams = principal.teams || [];
    var matches = inspect.teamMatches || [];
    var derived = inspect.derived || {};
    var placement = inspect.placement || {};
    var vocab = NDocsVocab.current() || { vocab: {} };

    outcome.textContent = '';
    var box = ui.el('div', { class: 'ndocs-drop-result ndocs-drop-result--ok' });
    box.appendChild(ui.el('h3', { text: 'Confirm this entry' }));

    var folderText = derived.folderPath || derived.folderName || 'unresolved';
    var folderLine = ui.el('p', { class: 'ndocs-dropzone__hint' }, [
      document.createTextNode('Found in ')
    ]);
    folderLine.appendChild(derived.folderUrl
      ? ui.el('a', { href: derived.folderUrl, target: '_blank', rel: 'noopener', text: folderText })
      : ui.el('span', { text: folderText }));
    box.appendChild(folderLine);

    var teamSelect = ui.el('select', {});
    teamSelect.appendChild(ui.el('option', { value: '', text: matches.length > 1 ? 'Choose a team' : 'Choose a team' }));
    teams.forEach(function (t) {
      teamSelect.appendChild(ui.el('option', { value: t.teamId, text: t.name }));
    });
    var preselect = opts.teamId || (matches.length === 1 ? matches[0] : '');
    if (preselect) teamSelect.value = preselect;
    if (matches.length > 1) {
      box.appendChild(ui.el('p', { class: 'ndocs-dropzone__hint', text: 'More than one team uses this folder — choose which one owns the document.' }));
    } else if (!matches.length) {
      box.appendChild(ui.el('p', { class: 'ndocs-dropzone__hint', text: 'No team claims this folder, so the owning team is yours to choose.' }));
    }

    var header = inspect.header || {};
    // Title comes from the document's own first heading, purpose from the first paragraph
    // under its Purpose heading. Where the document supplies neither, the input is left
    // empty and editable rather than seeded from the Drive filename — a filename is not a
    // title, and prefilling one as though it were is how a whole catalog ends up with
    // titles nobody chose.
    var titleInput = ui.el('input', { type: 'text', value: header.title || '' });
    var purposeInput = ui.el('input', { type: 'text', value: header.purpose || '' });
    if (!header.title) {
      titleInput.placeholder = 'The document has no heading — give it a title';
    }
    if (!header.purpose) {
      purposeInput.placeholder = 'The document has no Purpose section — say what it is for';
    }
    var typeSelect = ui.el('select', {});
    (vocab.vocab.type || []).forEach(function (t) {
      typeSelect.appendChild(ui.el('option', { value: t, text: t }));
    });
    var audienceSelect = ui.el('select', {});
    (vocab.vocab.audience || []).forEach(function (a) {
      audienceSelect.appendChild(ui.el('option', { value: a, text: a }));
    });
    if (header.audience) audienceSelect.value = header.audience;

    var form = ui.el('div', { class: 'ndocs-register-form' }, [
      ui.el('label', { text: 'Owning team' }), teamSelect,
      ui.el('label', { text: 'Title' }), titleInput,
      ui.el('label', { text: 'Purpose' }), purposeInput,
      ui.el('label', { text: 'Type' }), typeSelect,
      ui.el('label', { text: 'Audience' }), audienceSelect
    ]);
    box.appendChild(form);

    if (Object.keys(header).length) {
      box.appendChild(ui.el('p', { class: 'ndocs-dropzone__hint', text: 'Values in bold came from the document\'s own header and are proposals — check them before saving.' }));
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

    var submit = ui.el('button', { type: 'button', text: 'Register' });
    submit.addEventListener('click', function () {
      if (!teamSelect.value) { ui.toast('Choose the owning team.', 'warn'); return; }
      if (!titleInput.value) { ui.toast('Title is required.', 'warn'); return; }
      if (ackBox && !ackBox.checked) { ui.toast('Confirm the folder placement first.', 'warn'); return; }
      NDocsTransport.call('register_resource', {
        teamId: teamSelect.value,
        // `Contract.js`'s `Resources` field names, verbatim — `source_url`, not `url`; no
        // `topic`/`provision` sent from this quick-entry form at all (the collection's real
        // names are the plural, comma-separated `topics`/`provisions`, and
        // `Validate_authorizeWrite` throws for a key `Contract.js` does not declare, `null`
        // value or not, so an unrecognized key here would fail the whole registration).
        fields: {
          title: titleInput.value, purpose: purposeInput.value,
          type: typeSelect.value, audience: audienceSelect.value,
          source_url: url
        },
        derived: derived,
        placementAck: ackBox ? !!ackBox.checked : undefined
      }).then(function (result) {
        ui.toast('Registered ' + result.record.doc_id + ' (' + result.record.resource_id + ').', 'info');
        if (opts.onRegistered) opts.onRegistered(result.record);
        else window.location.href = 'resource.html?id=' + encodeURIComponent(result.record.resource_id);
      }).catch(function (err) {
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
