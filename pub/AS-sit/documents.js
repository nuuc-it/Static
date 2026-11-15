/* NT-2wr2.15: Tracker Documents view (spec v2 section 5). Renders into #documentsView through window.TrackerShell.
   Server routes: list_team_documents, team_scan_folder, team_exclude_documents, team_sync_document (Add).
   Scan/Exclude hide themselves when the server answers forbidden or does not know the route. No build step. */
(function () {
  'use strict';
  var root = document.getElementById('documentsView');
  if (!root) return;
  var SH = function () { return window.TrackerShell; };
  var esc = function (s) { return SH().escape(String(s == null ? '' : s)); };
  var LS = 'trackerDocs.v1';
  var GROUPS = { folder: 'Folder', team: 'Team', none: 'None' };
  // Last-modified filter. '' = any time; numbers are "within the last N days"; 'old' = older than 1 year.
  var MODS = { '': 'Any time', '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days', 'old': 'Older than 1 year' };

  var st = {
    built: false, loaded: false, loading: false, loadedKey: '', error: '',
    teams: [], folders: [],
    show: { tracked: true, not_tracked: true, excluded: false },
    search: '', group: 'folder', mod: '', collapsed: {}, selected: {},      // selected: docId -> teamId
    scanning: {}, scanMsg: {}, busy: false, bulkMsg: '', seq: 0, clearing: false,
    excludeOk: true, scanOk: true, pendingScroll: null, addedPending: {},
    auto: null, tried: {}   // auto-scan queue of unscanned roots (NT-2wr2.29); tried: roots already attempted this session
  };
  try {
    var saved = JSON.parse(localStorage.getItem(LS) || '{}');
    if (saved.show) st.show = Object.assign(st.show, saved.show);
    if (saved.collapsed) st.collapsed = saved.collapsed;
    if (GROUPS[saved.group]) st.group = saved.group;
    if (MODS[saved.mod] != null) st.mod = saved.mod;
  } catch (e) { /* storage unavailable: defaults */ }
  try { // the URL wins over the remembered choice, so a shared link reproduces the view
    var q = new URL(location.href).searchParams;
    if (GROUPS[q.get('dgroup')]) st.group = q.get('dgroup');
    if (q.get('dmod') != null && MODS[q.get('dmod')] != null) st.mod = q.get('dmod');
  } catch (e) { /* no URL access: remembered values only */ }
  function persist() {
    try { localStorage.setItem(LS, JSON.stringify({ show: st.show, collapsed: st.collapsed, group: st.group, mod: st.mod })); } catch (e) {}
    try { // keep the choice in the URL (other params untouched); defaults are omitted
      var u = new URL(location.href);
      if (st.group === 'folder') u.searchParams.delete('dgroup'); else u.searchParams.set('dgroup', st.group);
      if (!st.mod) u.searchParams.delete('dmod'); else u.searchParams.set('dmod', st.mod);
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) { /* history unavailable: remembered only */ }
  }

  var el = {};
  function build() {
    if (st.built) return;
    st.built = true;
    root.innerHTML =
      '<div class="dv-toolbar">' +
        '<span id="dvTeams" class="ms"></span>' +
        '<span class="dv-show"><button class="btn" id="dvShowBtn" type="button" aria-haspopup="true" aria-expanded="false"></button>' +
        '<div class="dv-showmenu hidden" id="dvShowMenu"></div></span>' +
        '<label class="dv-sel">Modified <select id="dvMod"></select></label>' +
        '<label class="dv-sel">Group by <select id="dvGroup"></select></label>' +
        '<input type="search" id="dvSearch" placeholder="Search documents or folders" aria-label="Search documents">' +
        '<button class="btn" id="dvScanAll" type="button">Scan all shown</button>' +
        '<button class="btn" id="dvExpandAll" type="button">Expand all</button>' +
        '<button class="btn" id="dvCollapseAll" type="button">Collapse all</button>' +
      '</div>' +
      '<div id="dvStatus" class="sub"></div>' +
      '<div id="dvProg" class="dv-prog hidden" role="status"></div>' +
      '<div id="dvList"></div>' +
      '<div class="bulkhost"><div class="bulkbar hidden" id="dvBar"></div><div class="bulkmsg hidden" id="dvMsg"></div></div>' +
      '<div id="dvModal"></div>';
    ['dvTeams', 'dvShowBtn', 'dvShowMenu', 'dvMod', 'dvGroup', 'dvSearch', 'dvScanAll', 'dvExpandAll', 'dvCollapseAll', 'dvStatus', 'dvProg', 'dvList', 'dvBar', 'dvMsg', 'dvModal']
      .forEach(function (id) { el[id] = document.getElementById(id); });
    try { SH().mountTeamsPicker(el.dvTeams); } catch (e) {}
    try { SH().onTeamsChange(function () { if (!root.classList.contains('hidden')) load(); }); } catch (e) {}
    el.dvShowBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var open = el.dvShowMenu.classList.toggle('hidden') === false;
      el.dvShowBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (ev) {
      if (!el.dvShowMenu.contains(ev.target)) { el.dvShowMenu.classList.add('hidden'); el.dvShowBtn.setAttribute('aria-expanded', 'false'); }
    });
    el.dvShowMenu.addEventListener('change', function (ev) {
      var k = ev.target.getAttribute('data-k'); if (!k) return;
      st.show[k] = ev.target.checked; persist(); render();
    });
    el.dvMod.innerHTML = Object.keys(MODS).map(function (k) { return '<option value="' + k + '">' + MODS[k] + '</option>'; }).join('');
    el.dvGroup.innerHTML = Object.keys(GROUPS).map(function (k) { return '<option value="' + k + '">' + GROUPS[k] + '</option>'; }).join('');
    el.dvMod.value = st.mod; el.dvGroup.value = st.group;
    el.dvMod.addEventListener('change', function () { st.mod = el.dvMod.value; persist(); render(); });
    el.dvGroup.addEventListener('change', function () { st.group = el.dvGroup.value; persist(); render(); });
    el.dvSearch.addEventListener('input', function () { st.search = el.dvSearch.value.trim().toLowerCase(); render(); });
    el.dvScanAll.addEventListener('click', scanAllShown);
    el.dvExpandAll.addEventListener('click', function () { st.collapsed = {}; persist(); render(); });
    el.dvCollapseAll.addEventListener('click', collapseAll);
    el.dvList.addEventListener('click', onListClick);
    el.dvProg.addEventListener('click', function (ev) { if (ev.target.closest('[data-act="autostop"]')) stopAuto(); });
    el.dvList.addEventListener('change', onListChange);
    el.dvBar.addEventListener('click', onBarClick);
  }

  // ---- data -------------------------------------------------------------------------------------------------------
  // NT-tuqn: '' = teams not loaded yet; an empty selection is its own key, and No team is part of the key.
  function teamKey() {
    if (!SH().teamsReady()) return '';
    if (SH().isEmptySelection()) return '!empty';
    return SH().selectedTeamIds().slice().sort().join(',') + (SH().includeNoTeam() ? '|none' : '|');
  }
  // NT-2wr2.20: latest reply wins (st.seq). A different team set clears the list behind a "Loading documents…" card; a reload
  // of the same set (after Add / Exclude) dims it. Returns the load's promise.
  function load(force) {
    var key = teamKey();
    if (!force && !st.loading && st.loaded && key === st.loadedKey) return Promise.resolve();
    if (!force && st.loading && key === st.loadingKey) return st.loadP || Promise.resolve();
    if (!key) { st.loaded = false; st.error = ''; render(); return Promise.resolve(); } // teams not known yet; show() runs again when they arrive
    st.auto = null;
    if (key === '!empty') { // nothing selected: no list call
      ++st.seq; st.loading = false; st.clearing = false; st.error = ''; st.emptySel = true; st.teams = []; st.folders = []; st.selected = {};
      st.loaded = true; st.loadedKey = key; render(); return Promise.resolve();
    }
    st.emptySel = false;
    var seq = ++st.seq, same = st.loaded && key === st.loadedKey;
    st.loading = true; st.loadingKey = key; st.error = ''; st.clearing = !same; render();
    var teamIds = SH().selectedTeamIds();
    st.loadP = SH().withBusy(el.dvList, same ? 'dim' : 'clear', same ? 'Updating…' : 'Loading documents…', function () {
      return SH().postJson({ action: 'list_team_documents', teamIds: teamIds, includeNoTeam: SH().includeNoTeam() }).then(function (res) {
        if (seq !== st.seq) return;
        if (SH().noteNoTeam) SH().noteNoTeam(res);
        st.loading = false; st.clearing = false;
        if (!res || res.ok === false) { st.error = errText(res); st.folders = []; st.loaded = true; st.loadedKey = key; render(); return; }
        st.teams = res.teams || []; st.folders = res.folders || []; st.loaded = true; st.loadedKey = key;
        // A reload of the same team set keeps selections whose documents are still listed (a late background load must not wipe a click).
        var keep = {};
        if (same) { var have = allDocs(); Object.keys(st.selected).forEach(function (i) { if (have[i]) keep[i] = st.selected[i]; }); }
        st.selected = keep; st.addedPending = {};
        render(); restoreScroll();
        startAuto(seq);
      }).catch(function (err) {
        if (seq !== st.seq) return;
        st.loading = false; st.clearing = false; st.error = 'Could not load documents: ' + (err.message || err); render();
      });
    });
    return st.loadP;
  }
  function errText(res) {
    var r = res && (res.reason || res.error || res.outcome);
    if (r === 'forbidden') return 'You do not have access to documents here. Ask your team lead to share the team folder with your account.';
    return 'Could not load documents' + (r ? ' (' + r + ')' : '') + '.';
  }
  function teamName(id) { var t = st.teams.filter(function (x) { return x.teamId === id; })[0]; return t ? (t.teamName || t.teamId) : id; }
  // Drive folder link (NT-2wr2.29). Linked only when folderId looks like a Drive id. The server url is used only when it is
  // a Drive folder url; otherwise the url is built from the id. Link text is never empty.
  var DRIVE_FOLDER_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+$/;
  function folderUrl(f) {
    var id = f && f.teamId !== '' && f.folderId;
    if (!id || !/^[A-Za-z0-9_-]{4,128}$/.test(String(id))) return '';
    return f.url && DRIVE_FOLDER_URL.test(String(f.url)) ? String(f.url) : 'https://drive.google.com/drive/folders/' + id;
  }
  function folderLabel(f) { return f.teamId === '' ? 'No team' : (f.path || f.name || ('Team folder (' + teamName(f.teamId) + ')')); } // NT-tuqn: flat group, no Drive folder
  function folderLink(f, cls) {
    var u = folderUrl(f), label = folderLabel(f);
    return u ? '<a class="' + cls + '" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" title="Open this folder in Google Drive">' + esc(label) + '</a>'
      : '<span class="' + cls + '">' + esc(label) + '</span>';
  }
  function isRoot(f) { return f.teamId !== '' && f.folderId && f.folderId === f.rootFolderId; }

  // ---- render -----------------------------------------------------------------------------------------------------
  function modOk(d) {
    if (!st.mod) return true;
    var t = d.modified ? Date.parse(d.modified) : NaN;
    if (isNaN(t)) return false; // no modified time: cannot satisfy an age filter
    var days = (Date.now() - t) / 86400000;
    return st.mod === 'old' ? days > 365 : days <= Number(st.mod);
  }
  function visibleDocs(f) {
    return (f.docs || []).filter(function (d) {
      if (!st.show[d.state]) return false;
      if (!modOk(d)) return false;
      if (!st.search) return true;
      return (d.docName || '').toLowerCase().indexOf(st.search) >= 0 || String(d.docId || '').toLowerCase() === st.search || (f.path || '').toLowerCase().indexOf(st.search) >= 0;
    });
  }
  function visibleFolders() {
    return st.folders.filter(function (f) {
      var n = visibleDocs(f).length;
      if (n) return true;
      if (st.search || st.mod) return false;
      if (!f.folderId || (f.docs || []).length) return false;
      return isRoot(f) || !f.scannedAt; // a root keeps its header; a scanned subfolder with no Docs is hidden
    });
  }
  function ago(iso) { return iso ? 'Scanned ' + SH().timeAgo(iso) : 'Not scanned yet'; }
  function fmtDate(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  function pill(d) {
    if (st.addedPending[d.docId]) return '<span class="dv-pill tracked">Added · waiting for first sync</span>';
    if (d.state === 'tracked') return '<span class="dv-pill tracked">Tracked' + (d.openCount != null ? ' · ' + d.openCount + ' open' : '') + '</span>';
    if (d.state === 'excluded') return '<span class="dv-pill excluded">Excluded</span>';
    return '<span class="dv-pill not_tracked">Not tracked</span>';
  }
  function rowHtml(f, d) {
    var key = esc(d.docId), tid = esc(f.teamId), acts = '';
    var tracked = d.state === 'tracked', pending = !!st.addedPending[d.docId];
    var canAdd = d.state !== 'tracked' && !pending;
    if (tracked) acts += '<button class="btn small" data-act="view" data-doc="' + key + '" data-team="' + tid + '">View items</button>';
    if (tracked && d.canEdit !== false) acts += '<button class="btn small" data-act="sync" data-doc="' + key + '" data-team="' + tid + '">Sync</button>';
    if (canAdd) {
      acts += d.canEdit === false ? '<span class="dv-viewonly">View only</span>'
        : '<button class="btn small" data-act="add" data-doc="' + key + '" data-team="' + tid + '">Add</button>';
    }
    if (st.excludeOk && d.state !== 'excluded' && !pending) acts += '<button class="btn small" data-act="exclude" data-doc="' + key + '" data-team="' + tid + '">Exclude</button>';
    var sel = st.selected[d.docId] != null;
    var meta = [d.modified ? 'Edited ' + fmtDate(d.modified) : '', st.teams.length > 1 && st.group !== 'team' ? teamName(f.teamId) : ''].filter(Boolean).join(' · ');
    // The folder is named on the row only when no folder header sits above it (Group by None).
    var folderLine = st.group === 'none' ? '<div class="dv-folderline"><span aria-hidden="true">📁</span> ' + folderLink(f, 'dv-where') + '</div>' : '';
    return '<div class="dv-row' + (sel ? ' sel' : '') + '"><input type="checkbox" class="rowsel" data-sel="' + key + '" data-team="' + tid + '"' +
      (sel ? ' checked' : '') + ' aria-label="Select ' + esc(d.docName) + '">' +
      '<div class="dv-title"><a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.docName || '(untitled)') + '</a>' +
      '<div class="dv-meta">' + esc(meta) + '</div>' + folderLine + '</div>' + pill(d) + '<div class="dv-acts">' + acts + '</div></div>';
  }
  // Expand all / Collapse all act on what is rendered: every visible folder section and, grouped by team, each team section.
  function collapseAll() {
    visibleFolders().forEach(function (f) { st.collapsed[f.teamId + '|' + (f.folderId || 'other')] = true; if (st.group === 'team') st.collapsed['team|' + f.teamId] = true; });
    persist(); render();
  }
  function folderKey(f) { return f.teamId + '|' + (f.folderId || 'other'); }
  function folderByKey(key) { return st.folders.filter(function (f) { return folderKey(f) === key; })[0]; }
  // Header summary counts every state but excluded (excluded is added only when it is shown and not empty).
  function summaryHtml(f, shown) {
    var t = 0, u = 0, x = 0;
    (f.docs || []).forEach(function (d) { if (d.state === 'tracked') t++; else if (d.state === 'excluded') x++; else u++; });
    var txt = t + ' tracked · ' + u + ' not tracked' + (x && st.show.excluded ? ' · ' + x + ' excluded' : '');
    return '<span class="sub dv-sum" style="margin:0" title="' + shown + ' shown">' + txt + '</span>';
  }
  // Folder header checkbox state: checked when every visible row is selected, indeterminate when only some are.
  function syncFolderChecks() {
    Array.prototype.forEach.call(root.querySelectorAll('input[data-fsel]'), function (c) {
      var f = folderByKey(c.getAttribute('data-fsel')); if (!f) return;
      var docs = visibleDocs(f), n = docs.filter(function (d) { return st.selected[d.docId] != null; }).length;
      c.checked = n > 0 && n === docs.length; c.indeterminate = n > 0 && n < docs.length;
    });
  }
  function onFolderSelect(c) {
    var f = folderByKey(c.getAttribute('data-fsel')); if (!f) return;
    visibleDocs(f).forEach(function (d) { if (c.checked) st.selected[d.docId] = f.teamId; else delete st.selected[d.docId]; });
    Array.prototype.forEach.call(c.closest('.dv-folder').querySelectorAll('input[data-sel]'), function (r) {
      r.checked = c.checked; var row = r.closest('.dv-row'); if (row) row.classList.toggle('sel', c.checked);
    });
    syncFolderChecks(); renderBar();
  }
  function folderHtml(f) {
    var id = f.teamId + '|' + (f.folderId || 'other'), docs = visibleDocs(f), collapsed = !!st.collapsed[id];
    var pathHtml = folderLink(f, 'dv-path');
    var chip = st.group === 'folder' && st.teams.length > 1 && f.teamId ? '<span class="dv-chip">' + esc(teamName(f.teamId)) + '</span>' : '';
    var queued = !!(st.auto && st.auto.pending[id]);
    var scan = '';
    if (f.folderId && f.teamId !== '') { // NT-tuqn: the No team group has no folder to scan
      var busy = !!st.scanning[id];
      scan = '<span class="dv-scan"><span>' + esc(st.scanMsg[id] || (queued ? 'Listing…' : ago(f.scannedAt))) + '</span>' +
        (st.scanOk ? '<button class="btn small" data-act="scan" data-fid="' + esc(f.folderId) + '" data-team="' + esc(f.teamId) + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Scanning…' : 'Scan') + '</button>' : '') + '</span>';
    }
    var fsel = '', fex = '';
    if (docs.length) {
      fsel = '<input type="checkbox" class="foldersel" data-fsel="' + esc(id) + '" aria-label="Select all in ' + esc(folderLabel(f)) + '" title="Select all listed documents in this folder">';
      var open = docs.filter(function (d) { return d.state !== 'excluded'; }).length;
      if (st.excludeOk && open) fex = '<button class="btn small" data-act="fexclude" data-fkey="' + esc(id) + '" aria-label="Exclude the ' + open + ' listed document' + (open === 1 ? '' : 's') + ' in ' + esc(folderLabel(f)) + '"' +
        ' title="Excludes the ' + open + ' document' + (open === 1 ? '' : 's') + ' currently listed in this folder. Documents added to it later show as Not tracked again.">Exclude listed (' + open + ')</button>';
    }
    var tcount = (f.docs || []).filter(function (d) { return d.state === 'tracked'; }).length;
    var body = docs.length ? docs.map(function (d) { return rowHtml(f, d); }).join('')
      : '<div class="dv-empty">' + (queued ? 'Listing…' : (f.scannedAt && !(f.docs || []).length ? 'No Google Docs in this folder'
        : (f.scannedAt || !f.folderId ? 'No documents match the Show filter.' : 'Not scanned yet. Scan to list its documents.'))) + '</div>';
    return '<section class="dv-folder' + (collapsed ? ' collapsed' : '') + (tcount ? '' : ' dv-untracked') + '" data-fkey="' + esc(id) + '"><div class="dv-fhead">' +
      '<button class="dv-toggle" data-act="toggle" data-fkey="' + esc(id) + '" aria-expanded="' + !collapsed + '" aria-label="Collapse or expand folder">' + (collapsed ? '▸' : '▾') + '</button>' +
      fsel + pathHtml + chip + summaryHtml(f, docs.length) + fex + scan + '</div><div class="dv-rows">' + body + '</div></section>';
  }
  // Group by Team: a team header over that team's folder sections (each keeps its own Scan).
  function teamHtml(teamId, fs) {
    var key = 'team|' + teamId, collapsed = !!st.collapsed[key], n = 0;
    fs.forEach(function (f) { n += visibleDocs(f).length; });
    return '<section class="dv-team' + (collapsed ? ' collapsed' : '') + '"><div class="dv-thead">' +
      '<button class="dv-toggle" data-act="toggle" data-fkey="' + esc(key) + '" aria-expanded="' + !collapsed + '" aria-label="Collapse or expand team">' + (collapsed ? '▸' : '▾') + '</button>' +
      '<strong>' + esc(teamName(teamId)) + '</strong><span class="sub" style="margin:0">' + n + ' shown</span></div>' +
      '<div class="dv-tbody">' + fs.map(folderHtml).join('') + '</div></section>';
  }
  // Group by None: one flat list, most recently edited first.
  function flatHtml(fs) {
    var rows = [];
    fs.forEach(function (f) { visibleDocs(f).forEach(function (d) { rows.push({ f: f, d: d }); }); });
    rows.sort(function (a, b) { return String(b.d.modified || '').localeCompare(String(a.d.modified || '')); });
    return '<section class="dv-folder"><div class="dv-rows">' + rows.map(function (r) { return rowHtml(r.f, r.d); }).join('') + '</div></section>';
  }
  function listHtml(folders) {
    if (st.group === 'none') return flatHtml(folders);
    if (st.group !== 'team') return folders.map(folderHtml).join('');
    var order = [], by = {};
    folders.forEach(function (f) { if (!by[f.teamId]) { by[f.teamId] = []; order.push(f.teamId); } by[f.teamId].push(f); });
    return order.map(function (t) { return teamHtml(t, by[t]); }).join('');
  }
  function render() {
    if (!st.built) return;
    el.dvShowBtn.textContent = 'Show: ' + ['tracked:Tracked', 'not_tracked:Not tracked', 'excluded:Excluded']
      .filter(function (p) { return st.show[p.split(':')[0]]; }).map(function (p) { return p.split(':')[1]; }).join(', ') || 'Show: none';
    if (!/^Show/.test(el.dvShowBtn.textContent)) el.dvShowBtn.textContent = 'Show: none';
    el.dvShowMenu.innerHTML = [['tracked', 'Tracked'], ['not_tracked', 'Not tracked'], ['excluded', 'Excluded']].map(function (p) {
      return '<label><input type="checkbox" data-k="' + p[0] + '"' + (st.show[p[0]] ? ' checked' : '') + '> ' + p[1] + '</label>';
    }).join('');
    el.dvMod.value = st.mod; el.dvGroup.value = st.group;
    el.dvScanAll.classList.toggle('hidden', !st.scanOk);
    el.dvScanAll.disabled = st.busy || Object.keys(st.scanning).length > 0;
    var folders = visibleFolders();
    if (st.loading) el.dvStatus.textContent = 'Loading documents…';
    else el.dvStatus.textContent = st.error ? '' : (st.loaded ? folders.length + ' folder' + (folders.length === 1 ? '' : 's') : '');
    if (st.error) el.dvList.innerHTML = '<div class="empty">' + esc(st.error) + ' <button class="linkbtn" data-act="retry">Retry</button></div>';
    else if (st.loading && st.clearing) el.dvList.innerHTML = '<div class="statecard busyph"><h2><span class="busylbl">Loading documents…</span></h2><p><span class="spinner" aria-hidden="true"></span></p></div>';
    else if (st.loading && !st.loaded) el.dvList.innerHTML = '';
    else if (st.emptySel) el.dvList.innerHTML = '<div class="empty"><strong>No teams selected</strong><br>Choose at least one team (or No team) in the Teams filter.</div>';
    else if (!st.loaded) el.dvList.innerHTML = '<div class="empty">Choose a team to see its documents.</div>';
    else if (!st.folders.length) el.dvList.innerHTML = '<div class="empty"><strong>No documents yet</strong><br>Your teams have no folders you can see here. Ask your team lead to share the team folder with your account.</div>';
    else if (!folders.length) el.dvList.innerHTML = '<div class="empty"><strong>Nothing matches these filters</strong><br>Change Show or Modified, or clear the search.</div>';
    else el.dvList.innerHTML = listHtml(folders);
    renderProg();
    renderBar();
    syncFolderChecks();
    SH().reapplyBusy();
  }
  function rowsFor(ids) {
    return function () {
      return Array.prototype.filter.call(root.querySelectorAll('.dv-row'), function (r) {
        var c = r.querySelector('input[data-sel]'); return c && ids.indexOf(c.getAttribute('data-sel')) !== -1;
      });
    };
  }
  function renderBar() {
    var ids = Object.keys(st.selected), n = ids.length;
    el.dvBar.classList.toggle('hidden', !n);
    if (n) {
      var f = allDocs(); var addable = ids.filter(function (i) { var d = f[i]; return d && d.state !== 'tracked' && d.canEdit !== false; }).length;
      var syncable = ids.filter(function (i) { var d = f[i]; return d && d.state === 'tracked' && d.canEdit !== false; }).length;
      el.dvBar.innerHTML = '<strong>' + n + ' selected</strong>' +
        (syncable ? '<button class="btn small primary" data-bar="sync"' + (st.busy ? ' disabled' : '') + '>Sync (' + syncable + ')</button>' : '') +
        (addable || !syncable ? '<button class="btn small' + (syncable ? '' : ' primary') + '" data-bar="add"' + (addable && !st.busy ? '' : ' disabled') + '>Add' + (addable ? ' (' + addable + ')' : '') + '</button>' : '') +
        (st.excludeOk ? '<button class="btn small" data-bar="exclude"' + (st.busy ? ' disabled' : '') + '>Exclude</button>' : '') +
        '<button class="linkbtn" data-bar="clear">Clear</button>';
    }
    el.dvMsg.classList.toggle('hidden', !st.bulkMsg);
    el.dvMsg.innerHTML = st.bulkMsg ? '<span>' + esc(st.bulkMsg) + '</span><button class="linkbtn" data-bar="dismiss">Dismiss</button>' : '';
  }
  function allDocs() {
    var m = {}; st.folders.forEach(function (f) { (f.docs || []).forEach(function (d) { m[d.docId] = d; }); }); return m;
  }
  function findDoc(docId) { return allDocs()[docId]; }

  // ---- events -----------------------------------------------------------------------------------------------------
  function onListChange(ev) {
    if (ev.target.hasAttribute('data-fsel')) { onFolderSelect(ev.target); return; }
    var id = ev.target.getAttribute('data-sel'); if (!id) return;
    if (ev.target.checked) st.selected[id] = ev.target.getAttribute('data-team'); else delete st.selected[id];
    var row = ev.target.closest('.dv-row'); if (row) row.classList.toggle('sel', ev.target.checked);
    renderBar(); syncFolderChecks();
  }
  function onListClick(ev) {
    var b = ev.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), doc = b.getAttribute('data-doc'), team = b.getAttribute('data-team');
    if (act === 'toggle') { var k = b.getAttribute('data-fkey'); st.collapsed[k] = !st.collapsed[k]; if (!st.collapsed[k]) delete st.collapsed[k]; persist(); render(); }
    else if (act === 'retry') load(true);
    else if (act === 'scan') scanFolder(team, b.getAttribute('data-fid'));
    else if (act === 'view') { st.pendingScroll = window.scrollY; SH().openItemsForDoc(doc, team); }
    else if (act === 'sync') syncDocs([{ docId: doc, teamId: team }]);
    else if (act === 'add') addDocs([{ docId: doc, teamId: team }]);
    else if (act === 'exclude') excludeDocs([{ docId: doc, teamId: team }]);
    else if (act === 'fexclude') {
      var ff = folderByKey(b.getAttribute('data-fkey')); if (!ff) return;
      excludeDocs(visibleDocs(ff).filter(function (d) { return d.state !== 'excluded'; }).map(function (d) { return { docId: d.docId, teamId: ff.teamId }; }));
    }
  }
  function onBarClick(ev) {
    var b = ev.target.closest('[data-bar]'); if (!b) return; var a = b.getAttribute('data-bar');
    var items = Object.keys(st.selected).map(function (i) { return { docId: i, teamId: st.selected[i] }; });
    if (a === 'clear') { st.selected = {}; render(); }
    else if (a === 'dismiss') { st.bulkMsg = ''; renderBar(); }
    else if (a === 'sync') syncDocs(items);
    else if (a === 'add') addDocs(items);
    else if (a === 'exclude') excludeDocs(items);
  }
  function restoreScroll() {
    if (st.pendingScroll != null) { var y = st.pendingScroll; st.pendingScroll = null; setTimeout(function () { window.scrollTo(0, y); }, 0); }
  }

  // ---- Add (team_sync_document, sequential) -----------------------------------------------------------------------
  function addDocs(items) {
    items = items.filter(function (i) { var d = findDoc(i.docId); return d && d.state !== 'tracked' && d.canEdit !== false; });
    if (!items.length || st.busy) return;
    st.busy = true; var added = 0, denied = 0, i = 0;
    function next() {
      if (i >= items.length) {
        st.busy = false; st.selected = {};
        st.bulkMsg = added + ' added' + (denied ? ', ' + denied + ' not allowed' : '') + (added ? '. Their items appear after the next sync.' : '');
        if (denied && !added) SH().toastError(st.bulkMsg); else SH().toast(st.bulkMsg);
        render(); setTimeout(function () { load(true); }, 4000); return;
      }
      var it = items[i++];
      st.bulkMsg = 'Adding ' + i + ' of ' + items.length + '…'; renderBar();
      SH().withBusy(rowsFor([it.docId]), 'row', 'Adding…', function () {
        return SH().postJson({ action: 'team_sync_document', teamId: '', docId: it.docId }).then(function (res) {
          if (res && res.ok) { added++; st.addedPending[it.docId] = true; } else denied++;
        }).catch(function () { denied++; });
      }, { live: false }).then(function () { render(); next(); });
    }
    render(); next();
  }

  // ---- Sync (team_sync_document for tracked documents, sequential, each with the document's own teamId) -----------
  function syncDocs(items) {
    items = items.filter(function (i) { var d = findDoc(i.docId); return d && d.state === 'tracked' && d.canEdit !== false; });
    if (!items.length || st.busy) return;
    st.busy = true; var synced = 0, failed = 0, i = 0;
    function next() {
      if (i >= items.length) {
        st.busy = false; st.selected = {};
        st.bulkMsg = synced + ' synced' + (failed ? ', ' + failed + ' not allowed/failed' : '');
        if (failed && !synced) SH().toastError(st.bulkMsg); else SH().toast(st.bulkMsg);
        render(); load(true); return;
      }
      var it = items[i++];
      st.bulkMsg = 'Syncing ' + i + ' of ' + items.length + '…'; renderBar();
      SH().withBusy(rowsFor([it.docId]), 'row', 'Syncing…', function () {
        return SH().postJson({ action: 'team_sync_document', teamId: it.teamId, docId: it.docId }).then(function (res) {
          if (res && res.ok !== false && !res.error) synced++; else failed++;
        }).catch(function () { failed++; });
      }, { live: false }).then(function () { next(); });
    }
    render(); next();
  }

  // ---- Exclude (team_exclude_documents) ---------------------------------------------------------------------------
  function excludeDocs(items) {
    items = items.filter(function (i) { var d = findDoc(i.docId); return d && d.state !== 'excluded'; });
    if (!items.length || st.busy) return;
    var tracked = items.map(function (i) { return findDoc(i.docId); }).filter(function (d) { return d.state === 'tracked'; });
    if (!tracked.length) return runExclude(items);
    var n = tracked.reduce(function (s, d) { return s + (d.itemCount != null ? d.itemCount : (d.openCount || 0)); }, 0);
    var text = tracked.length === 1
      ? 'This document has ' + n + ' tracked item' + (n === 1 ? '' : 's') + '. Excluding it removes them from Tracker.'
      : tracked.length + ' of these documents are tracked, with ' + n + ' tracked items in all. Excluding them removes those items from Tracker.';
    el.dvModal.innerHTML = '<div class="dv-confirm" role="dialog" aria-modal="true"><div class="box"><p>' + esc(text) + '</p>' +
      '<div class="btns"><button class="btn" id="dvCancel">Cancel</button><button class="btn danger" id="dvGo">Exclude</button></div></div></div>';
    document.getElementById('dvCancel').addEventListener('click', function () { el.dvModal.innerHTML = ''; });
    document.getElementById('dvGo').addEventListener('click', function () { el.dvModal.innerHTML = ''; runExclude(items); });
    document.getElementById('dvGo').focus();
  }
  function runExclude(items) {
    st.busy = true; render();
    return SH().withBusy(rowsFor(items.map(function (i) { return i.docId; })), 'row', 'Excluding…', function () {
      return new Promise(function (resolve) { runExcludeJobs(items, resolve); });
    });
  }
  function runExcludeJobs(items, resolve) {
    var byTeam = {}; items.forEach(function (i) { (byTeam[i.teamId] = byTeam[i.teamId] || []).push(i.docId); });
    var jobs = [];
    Object.keys(byTeam).forEach(function (t) { for (var k = 0; k < byTeam[t].length; k += 50) jobs.push({ teamId: t, docIds: byTeam[t].slice(k, k + 50) }); });
    var done = 0, refused = 0, removed = 0, j = 0, unavailable = false;
    function next() {
      if (j >= jobs.length) {
        st.busy = false; st.selected = {};
        if (unavailable) { st.excludeOk = false; st.bulkMsg = 'Exclude is not available right now.'; }
        else st.bulkMsg = done + ' excluded' + (refused ? ', ' + refused + ' not allowed' : '') + (removed ? '. ' + removed + ' items removed from Tracker.' : '');
        if (unavailable || (refused && !done)) SH().toastError(st.bulkMsg); else SH().toast(st.bulkMsg);
        render(); load(true).then(resolve, resolve); return;
      }
      var job = jobs[j++];
      SH().postJson({ action: 'team_exclude_documents', teamId: job.teamId, docIds: job.docIds }).then(function (res) {
        if (res && res.ok && Array.isArray(res.results)) {
          res.results.forEach(function (r) { if (r.outcome === 'excluded') { done++; removed += r.removedItems || 0; } else refused++; });
        } else if (res && (res.reason === 'forbidden' || res.error || res.ok === false)) { refused += job.docIds.length; if (!res.reason && !res.ok) unavailable = unavailable || /unknown|action/i.test(String(res.error || '')); }
        else refused += job.docIds.length;
      }).catch(function () { refused += job.docIds.length; }).then(next);
    }
    next();
  }

  // ---- Scan (team_scan_folder, repeated until complete) -----------------------------------------------------------
  // A scan returns every entry of its root: they replace that root's old entries in place (server order kept).
  function mergeFolders(returned) {
    var seenRoot = {};
    returned.forEach(function (nf) {
      var k = nf.teamId + '|' + nf.rootFolderId;
      if (seenRoot[k]) return; seenRoot[k] = true;
      var mine = returned.filter(function (x) { return x.teamId === nf.teamId && x.rootFolderId === nf.rootFolderId; });
      var at = -1, kept = [];
      st.folders.forEach(function (f) {
        if (f.teamId === nf.teamId && f.rootFolderId === nf.rootFolderId) { if (at < 0) at = kept.length; return; }
        kept.push(f);
      });
      if (at < 0) at = kept.length;
      kept.splice.apply(kept, [at, 0].concat(mine));
      st.folders = kept;
    });
  }
  function scanFolder(teamId, folderId) {
    var id = teamId + '|' + folderId;
    if (st.scanning[id]) return Promise.resolve();
    st.scanning[id] = true; st.scanMsg[id] = 'Scanning…'; render();
    var runStartedAt = null, rounds = 0, mySeq = st.seq;
    function step() {
      var p = { action: 'team_scan_folder', teamId: teamId, folderId: folderId };
      if (runStartedAt) p.runStartedAt = runStartedAt;
      return SH().postJson(p, { background: true }).then(function (res) {
        if (mySeq !== st.seq) { st.scanMsg[id] = ''; return; } // list reloaded or teams changed meanwhile: drop this reply
        if (!res || res.ok === false) {
          var r = res && (res.reason || res.error);
          st.scanMsg[id] = r === 'forbidden' ? 'Scan not allowed' : 'Scan failed';
          if (r === 'forbidden' || /unknown|action/i.test(String(r || ''))) st.scanOk = r === 'forbidden' ? st.scanOk : false;
          return;
        }
        runStartedAt = res.runStartedAt || runStartedAt;
        mergeFolders(res.folders || []);
        st.scanMsg[id] = res.complete ? '' : 'Scanning… ' + (res.remaining != null ? res.remaining + ' left' : '');
        render();
        if (!res.complete && ++rounds < 40 && !(st.auto && st.auto.stopped && st.auto.current === id)) return step();
        if (!res.complete) st.scanMsg[id] = 'Scan incomplete, try again';
      });
    }
    var section = function () {
      return Array.prototype.filter.call(root.querySelectorAll('.dv-folder[data-fkey]'), function (x) { return x.getAttribute('data-fkey') === id; });
    };
    return SH().withBusy(section, 'aria', 'Scanning…', function () {
      return step().catch(function (err) { st.scanMsg[id] = 'Scan failed: ' + (err.message || err); })
        .then(function () { delete st.scanning[id]; if (st.scanMsg[id] === '') delete st.scanMsg[id]; render(); });
    });
  }
  // ---- Auto-scan of unscanned roots (NT-2wr2.29), one root at a time, cancelled by st.seq change or Stop ----
  function startAuto(seq) {
    if (!st.scanOk || seq !== st.seq) return;
    var queue = [];
    st.folders.forEach(function (f) {
      var k = f.teamId + '|' + f.folderId;
      if (isRoot(f) && !f.scannedAt && !st.tried[k] && !st.scanning[k]) queue.push({ teamId: f.teamId, folderId: f.folderId, key: k, label: f.path || f.name || teamName(f.teamId) });
    });
    if (!queue.length) { st.auto = null; renderProg(); return; }
    var a = st.auto = { seq: seq, total: queue.length, done: 0, stopped: false, current: '', pending: {}, label: '' };
    queue.forEach(function (q) { a.pending[q.key] = true; });
    render();
    (function next() {
      if (st.auto !== a || a.stopped || a.seq !== st.seq || !queue.length) { finish(); return; }
      var q = queue.shift();
      a.current = q.key; a.label = q.label; st.tried[q.key] = true; renderProg();
      scanFolder(q.teamId, q.folderId).then(function () {
        delete a.pending[q.key]; a.done++; a.current = ''; next();
      }, function () { delete a.pending[q.key]; a.done++; a.current = ''; next(); });
    })();
    function finish() { if (st.auto === a) { a.pending = {}; st.auto = null; } render(); }
  }
  function stopAuto() { if (st.auto) { st.auto.stopped = true; st.auto.pending = {}; render(); } }
  function renderProg() {
    if (!el.dvProg) return;
    var a = st.auto;
    el.dvProg.classList.toggle('hidden', !a);
    el.dvProg.innerHTML = a ? '<span class="spinner" aria-hidden="true"></span> <span>Listing folders: ' + Math.min(a.done + 1, a.total) + ' of ' + a.total +
      (a.label ? ', ' + esc(a.label) : '') + '…</span> <button class="linkbtn" data-act="autostop" type="button">Stop</button>' : '';
  }
  function scanAllShown() {
    var seen = {}, roots = visibleFolders().filter(function (f) {
      if (!isRoot(f)) return false; var k = f.teamId + '|' + f.folderId; if (seen[k]) return false; seen[k] = true; return true;
    });
    // A subfolder shown without its root (search/Show) is covered by scanning its root.
    visibleFolders().forEach(function (f) {
      if (isRoot(f) || !f.folderId) return; var k = f.teamId + '|' + f.rootFolderId;
      if (!seen[k]) { seen[k] = true; roots.push({ teamId: f.teamId, folderId: f.rootFolderId }); }
    });
    var i = 0;
    (function next() { if (i >= roots.length) return; var r = roots[i++]; scanFolder(r.teamId, r.folderId).then(next); })();
  }

  // ---- hook -------------------------------------------------------------------------------------------------------
  window.TrackerDocs = {
    setSearch: function (text) {
      build();
      st.search = String(text || '').trim().toLowerCase();
      el.dvSearch.value = String(text || '').trim();
      if (st.built) render();
    },
    show: function () {
      build();
      var pre = SH().state && SH().state.docsSearch;
      if (pre) { st.search = String(pre).trim().toLowerCase(); el.dvSearch.value = String(pre).trim(); SH().state.docsSearch = ''; }
      load();
      render();
      restoreScroll();
    }
  };
  // documents.js loads deferred, after the page has already chosen a view. When Documents is already the active view
  // (a ?view=documents link, a reload), show it now; the team list may still be on its way, so wait for it.
  var sh = SH();
  if (sh && sh.state && sh.state.view === 'documents') {
    window.TrackerDocs.show();
    var waited = 0, t = setInterval(function () {
      waited += 250;
      if (st.loaded || waited > 60000 || root.classList.contains('hidden')) { clearInterval(t); return; }
      if (SH().teamsReady()) { clearInterval(t); load(); render(); }
    }, 250);
  }
})();
