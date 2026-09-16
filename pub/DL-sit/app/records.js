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
  function resultsTable(records, opts) {
    opts = opts || {};
    var showFolder = !opts.hideFolder;
    var headCells = [
      ui.el('th', { text: 'Doc ID' }), ui.el('th', { text: 'Title' }),
      ui.el('th', { text: 'Type' })
    ];
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
      var cells = [
        ui.el('td', { text: record.doc_id || '—' }),
        ui.el('td', {}, [link]),
        ui.el('td', { text: record.type || '—' })
      ];
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
    folderCell: folderCell,
    dateOrDash: dateOrDash,
    resultsTable: resultsTable,
    detailCard: detailCard
  };
})();
