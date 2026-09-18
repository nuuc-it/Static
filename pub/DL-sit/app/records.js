// app/records.js — shared renderers for a Resources record: a results table (Doc ID
// first column), a detail card, and warning chips. Every page that shows a resource uses
// these, so a listing and a warning look identical everywhere (DESIGN.md §Level 2 — Front
// End). Renderers take a record object and return a DOM node; none accepts an HTML string
// (app/ui.js escaping).
//
// Field names below follow docs/DESIGN.md §Data Model → Resources / Contract.js exactly
// (`drive_modified_at`, `created_at` — corrected 2026-09-16, Stage 6 `NDocs-2a9`: this file
// was written against the Stage 1 mockup's draft names `file_modified_at`/`registered_at`,
// which the field never actually had once `Contract.js` (Stage 5) declared it).
var NDocsRecords = (function () {
  'use strict';

  var ui = NDocsUI;

  // modifiedSinceCertified(record) -> boolean — the file changed after the last time
  // anyone certified it. Distinct from review_state, which is about review cadence, not
  // file drift. A record with no last_certified_at has never been certified — not the
  // same condition, so this is false, not true, until it has something to be stale against.
  function modifiedSinceCertified(record) {
    return !!(record.drive_modified_at && record.last_certified_at &&
      new Date(record.drive_modified_at) > new Date(record.last_certified_at));
  }

  // displayStatus(record) -> string — the lifecycle status field (current, retired, …)
  // wins when it's not 'current'; otherwise 'modified' overrides 'current' when the file
  // has drifted since certification, since "current" alone is claiming more than we know.
  function displayStatus(record) {
    if (record.status && record.status !== 'current') return record.status;
    if (modifiedSinceCertified(record)) return 'modified';
    return record.status || '—';
  }

  // warningChips(record) -> Node[] — one chip per condition, text-first (never color alone).
  function warningChips(record) {
    var chips = [];
    if (record.reachable === false) {
      chips.push(ui.el('span', { class: 'ndocs-chip ndocs-chip--warn', text: 'link not reachable' }));
    }
    if (record.review_state === 'due') {
      chips.push(ui.el('span', { class: 'ndocs-chip ndocs-chip--info', text: 'review due' }));
    }
    if (record.review_state === 'overdue') {
      chips.push(ui.el('span', { class: 'ndocs-chip ndocs-chip--warn', text: 'review overdue' }));
    }
    if (modifiedSinceCertified(record)) {
      chips.push(ui.el('span', { class: 'ndocs-chip ndocs-chip--info', text: 'modified since certified' }));
    }
    if (record.location_kind === 'my_drive') {
      chips.push(ui.el('span', { class: 'ndocs-chip ndocs-chip--warn', text: 'in a personal Drive' }));
    }
    if (record.location_kind === 'unknown') {
      chips.push(ui.el('span', { class: 'ndocs-chip ndocs-chip--warn', text: 'location unknown' }));
    }
    if (record.status && record.status !== 'current') {
      chips.push(ui.el('span', { class: 'ndocs-chip', text: record.status }));
    }
    return chips;
  }

  // statusBadge(record) -> {text, kind}|null — the one status→badge mapping shared by
  // catalog.html's results, team.html's inventory, and resource.html's entity summary
  // (Stage 15.6, `NDocs-jg1`/`NDocs-c71`). Extracted from app/page-search.js's own
  // `badgeForStatus`, which this file's `resultsTable` never used — no behavior change, one
  // fewer place a status→badge decision could drift from another page's.
  function statusBadge(record) {
    var status = displayStatus(record);
    if (record.reachable === false) return { text: 'Unreachable', kind: 'danger' };
    if (status === 'current') return { text: 'Current', kind: 'success' };
    if (record.review_state === 'overdue') return { text: 'Review overdue', kind: 'danger' };
    if (record.review_state === 'due') return { text: 'Review due', kind: 'attention' };
    if (status === '—') return null;
    return { text: status, kind: 'info' };
  }

  // ADR-0005's authority class per `Resources` field, mirrored here for the resource editor
  // (Stage 15.6, `NDocs-jg1`) — `webapp-actions.md get_bootstrap`'s `fields` projection is
  // `null` today (no wire projection of `Contract.js` exists yet, per that route's own
  // Stage-15 note), so the editor's grouping is a client-side mirror of `src/Contract.js`'s
  // Resources table, same "front-end mirrors a field list by convention" precedent this
  // file's `detailCard`/`resultsTable` already set for field names. Keeping this list in
  // step with `Contract.js` by hand is exactly `Contract.js`'s own header's accepted
  // convention for `TeamRepo.js`'s `TEAM_HEADERS` — not a new kind of drift risk.
  //
  // Grouped into the labeled sections ux-components.md's resource composition row requires;
  // `editable: true` fields are the ones `update_resource`'s `human`-intent patch may carry
  // (ADR-0005) — every other field renders read-only and labeled, never omitted.
  var RESOURCE_FIELD_GROUPS = [
    {
      title: 'Identity & classification',
      fields: [
        { name: 'title', label: 'Title', editable: true, control: 'text' },
        { name: 'team_id', label: 'Owning team', editable: true, control: 'team' },
        { name: 'type', label: 'Type', editable: true, control: 'vocab:type' },
        { name: 'purpose', label: 'Purpose', editable: true, control: 'textarea' },
        { name: 'audience', label: 'Audience', editable: true, control: 'vocab:audience' },
        { name: 'discovery', label: 'Discovery', editable: true, control: 'vocab:discovery' },
        { name: 'topics', label: 'Topics', editable: true, control: 'vocab-multi:topics' },
        { name: 'provisions', label: 'Provisions', editable: true, control: 'provisions' }
      ]
    },
    {
      title: 'Lifecycle & governance',
      fields: [
        { name: 'status', label: 'Status', editable: true, control: 'status' },
        { name: 'successor_id', label: 'Successor resource id', editable: true, control: 'text' },
        { name: 'maintainer_email', label: 'Maintainer email', editable: true, control: 'text' },
        { name: 'source_url', label: 'Source URL', editable: true, control: 'text' },
        { name: 'placement_ack_by', label: 'Placement confirmed by', editable: true, control: 'text' }
      ]
    },
    {
      title: 'From the document header',
      note: 'Proposed by scanning the document itself. A person accepts a change through the discrepancy panel above, not by editing here (ADR-0005).',
      fields: [
        { name: 'header_resource_id', label: 'Header: resource id', editable: false },
        { name: 'header_status', label: 'Header: status', editable: false },
        { name: 'header_last_reviewed', label: 'Header: last reviewed', editable: false }
      ]
    },
    {
      title: 'System-managed',
      note: 'Set by the catalog itself — from the Drive file, from a scan, or on every write. Shown for completeness, not editable here.',
      fields: [
        { name: 'resource_id', label: 'Resource id', editable: false },
        { name: 'doc_id', label: 'Doc id', editable: false },
        { name: 'drive_file_id', label: 'Drive file id', editable: false },
        { name: 'drive_filename', label: 'Drive file name', editable: false },
        { name: 'drive_folder_id', label: 'Folder id', editable: false },
        { name: 'drive_folder_name', label: 'Folder name', editable: false },
        { name: 'drive_folder_path', label: 'Folder path', editable: false },
        { name: 'location_kind', label: 'Location kind', editable: false },
        { name: 'mime_type', label: 'Mime type', editable: false },
        { name: 'drive_modified_at', label: 'File last modified', editable: false, format: 'date' },
        { name: 'reachable', label: 'Reachable', editable: false, format: 'bool' },
        { name: 'last_checked_at', label: 'Last checked', editable: false, format: 'date' },
        { name: 'consecutive_check_failures', label: 'Consecutive check failures', editable: false },
        { name: 'last_certified_at', label: 'Last certified', editable: false, format: 'date' },
        { name: 'last_certified_by', label: 'Certified by', editable: false },
        { name: 'next_review_at', label: 'Next review due', editable: false, format: 'date' },
        { name: 'review_state', label: 'Review state', editable: false },
        { name: 'created_at', label: 'Registered', editable: false, format: 'date' },
        { name: 'created_by', label: 'Registered by', editable: false },
        { name: 'updated_at', label: 'Last updated', editable: false, format: 'date' },
        { name: 'updated_by', label: 'Last updated by', editable: false },
        { name: 'rev', label: 'Revision', editable: false }
      ]
    }
  ];

  var RESOURCE_STATUS_VALUES = ['current', 'superseded', 'archived', 'withdrawn'];

  // dateOrDash(iso) -> string — a human date, or an em dash for null/undefined.
  function dateOrDash(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString();
  }

  // folderCell(record) -> Node — the containing folder: leaf name visible, full path as
  // the tooltip, the folder itself one click away. CONTEXT.md UC-22 forbids truncating a
  // path in a way that makes two folders indistinguishable, so the path is carried whole
  // in the title attribute rather than shortened into the cell.
  function folderCell(record) {
    if (!record.drive_folder_id) {
      return ui.el('span', { class: 'ndocs-folder ndocs-folder--unresolved', text: 'unresolved' });
    }
    var name = record.drive_folder_name || record.drive_folder_id;
    var path = record.drive_folder_path || name;
    if (!record.drive_folder_url) {
      return ui.el('span', { class: 'ndocs-folder', title: path, text: name });
    }
    return ui.el('a', {
      class: 'ndocs-folder', href: record.drive_folder_url, title: path,
      target: '_blank', rel: 'noopener', text: name
    });
  }

  // There is no separate location field in the record view. A folder path names the drive
  // it starts from — "/Shared drives/Northlake/…" or "/My Drive (…)/…" — so showing
  // location_kind beside it would say the same thing twice. The one case that needs more
  // than the path says is a personal Drive, and that is a warning chip, not a field.

  // resultsTable(records, opts?) -> Node — the listing table for search results
  // (index.html) and team inventory (team.html), one row per record, Doc ID first
  // column. No separate Team column — the Doc ID prefix already names the team.
  // opts.findingCounts: { [resource_id]: count } adds an Open findings column.
  // opts.hideFolder: true inside a folder-grouped inventory, where the group heading
  // already names the folder and repeating it in every row is noise.
  // opts.selectable: true adds a leading checkbox column, admin-UI-restructure addendum
  // (post-Stage-15, 2026-09-17) — team.html's bulk-reassign control, admin-only, wired
  // straight into this table rather than a second listing. opts.selectedIds is the Set a
  // checkbox's change toggles membership in; the caller owns the Set and reads it back when
  // the bulk action runs. Off by default, so `catalog.html`'s and `team.html`'s read-only
  // uses of this table are unaffected.
  function resultsTable(records, opts) {
    opts = opts || {};
    var showFolder = !opts.hideFolder;
    var headCells = [];
    if (opts.selectable) headCells.push(ui.el('th', { text: '' }));
    headCells.push(
      ui.el('th', { text: 'Doc ID' }), ui.el('th', { text: 'Title' }),
      ui.el('th', { text: 'Type' })
    );
    if (showFolder) headCells.push(ui.el('th', { text: 'Folder' }));
    headCells.push(ui.el('th', { text: 'Updated' }));
    headCells.push(ui.el('th', { text: 'Status' }));
    if (opts.findingCounts) headCells.push(ui.el('th', { text: 'Open findings' }));
    var thead = ui.el('thead', {}, [ui.el('tr', {}, headCells)]);
    var tbody = ui.el('tbody', {});
    records.forEach(function (record) {
      var link = ui.el('a', {
        href: 'resource.html?id=' + encodeURIComponent(record.resource_id),
        text: record.title
      });
      var statusCell = ui.el('td', {}, [
        ui.el('span', { text: displayStatus(record) + ' ' }),
        ui.el('span', { class: 'ndocs-chips' }, warningChips(record))
      ]);
      var cells = [];
      if (opts.selectable) {
        var checkbox = ui.el('input', { type: 'checkbox' });
        checkbox.addEventListener('change', function () {
          if (!opts.selectedIds) return;
          if (checkbox.checked) opts.selectedIds.add(record.resource_id);
          else opts.selectedIds.delete(record.resource_id);
        });
        cells.push(ui.el('td', {}, [checkbox]));
      }
      cells.push(
        ui.el('td', { text: record.doc_id || '—' }),
        ui.el('td', {}, [link]),
        ui.el('td', { text: record.type || '—' })
      );
      if (showFolder) cells.push(ui.el('td', {}, [folderCell(record)]));
      cells.push(ui.el('td', { text: dateOrDash(record.drive_modified_at) }));
      cells.push(statusCell);
      if (opts.findingCounts) {
        var count = opts.findingCounts[record.resource_id] || 0;
        cells.push(ui.el('td', { text: count ? String(count) : '—' }));
      }
      tbody.appendChild(ui.el('tr', {}, cells));
    });
    return ui.el('table', { class: 'ndocs-table ndocs-results-table' }, [thead, tbody]);
  }

  // detailCard(record) -> Node — the full record view on resource.html. The folder path is
  // shown in full here (UC-22), not tooltipped as in a listing, and links to the folder.
  function detailCard(record) {
    var folderNode;
    if (!record.drive_folder_id) {
      folderNode = ui.el('span', { text: 'unresolved' });
    } else if (record.drive_folder_url) {
      folderNode = ui.el('a', {
        href: record.drive_folder_url, target: '_blank', rel: 'noopener',
        text: record.drive_folder_path || record.drive_folder_name
      });
    } else {
      folderNode = ui.el('span', { text: record.drive_folder_path || record.drive_folder_name });
    }
    var fields = [
      ['Doc ID', record.doc_id],
      // The Drive file name sits against the Doc ID, not down among the semantic fields:
      // it is not the catalog title, and a rename in Drive raises a discrepancy rather
      // than overwriting the title. Title is repeated here directly beneath it — the h2
      // above carries it too, but nobody can see the two have drifted unless they are
      // adjacent.
      ['File name', record.drive_filename],
      ['Title', record.title],
      ['Purpose', record.purpose],
      ['Type', record.type],
      ['Audience', record.audience],
      ['Owning team', record.team_id],
      ['Folder', folderNode],
      ['Status', displayStatus(record)],
      ['Registered', dateOrDash(record.created_at)],
      ['Last certified', dateOrDash(record.last_certified_at)],
      ['Certified by', record.last_certified_by],
      ['File last modified', dateOrDash(record.drive_modified_at)],
      ['Placement confirmed by', record.placement_ack_by]
    ];
    var dl = ui.el('dl', { class: 'ndocs-detail-fields' });
    fields.forEach(function (pair) {
      dl.appendChild(ui.el('dt', { text: pair[0] }));
      if (pair[1] && typeof pair[1] === 'object') {
        dl.appendChild(ui.el('dd', {}, [pair[1]]));
      } else {
        dl.appendChild(ui.el('dd', { text: pair[1] || '—' }));
      }
    });
    return ui.el('div', { class: 'ndocs-detail-card' }, [
      ui.el('h2', { text: record.title }),
      ui.el('div', { class: 'ndocs-chips' }, warningChips(record)),
      dl
    ]);
  }

  return {
    warningChips: warningChips,
    modifiedSinceCertified: modifiedSinceCertified,
    displayStatus: displayStatus,
    statusBadge: statusBadge,
    folderCell: folderCell,
    dateOrDash: dateOrDash,
    resultsTable: resultsTable,
    detailCard: detailCard,
    RESOURCE_FIELD_GROUPS: RESOURCE_FIELD_GROUPS,
    RESOURCE_STATUS_VALUES: RESOURCE_STATUS_VALUES
  };
})();
