/* NT-2wr2.15: Tracker Documents view (spec v2 section 5). Renders into #documentsView through window.TrackerShell.
   Server routes: list_team_documents, team_scan_folder, team_exclude_documents, team_sync_document (Add).
   Scan/Exclude hide themselves when the server answers forbidden or does not know the route. No build step. */
(function () {
  'use strict';
  var root = document.getElementById('documentsView');
  if (!root) return;
  var SH = function () { return window.TrackerShell; };
  var esc = function (s) { return SH().escape(String(s == null ? '' : s)); };
  var LS = 'trackerDocs.v2', LS_V1 = 'trackerDocs.v1'; // NT-2wr2.33: v2 carries show/mod from v1; group and collapsed start fresh
  var GROUPS = { folder: 'Folder', team: 'Team', none: 'None' };
  // Last-modified filter. '' = any time; numbers are "within the last N days"; 'old' = older than 1 year.
  var MODS = { '': 'Any time', '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days', 'old': 'Older than 1 year' };

  var st = {
    built: false, loaded: false, loading: false, loadedKey: '', error: '',
    teams: [], folders: [],
    show: { tracked: true, not_tracked: true, excluded: false },
    search: '', group: 'team', mod: '', collapsed: {}, selected: {},      // selected: docId -> teamId
    scanning: {}, scanMsg: {}, busy: false, bulkMsg: null, run: null, stop: false, seq: 0, clearing: false,
    excludeOk: true, scanOk: true, pendingScroll: null, addedPending: {}
  };
  try {
    var raw = localStorage.getItem(LS), saved;
    if (raw) saved = JSON.parse(raw);
    else { var v1 = JSON.parse(localStorage.getItem(LS_V1) || '{}'); saved = { show: v1.show, mod: v1.mod }; }
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
      if (st.group === 'team') u.searchParams.delete('dgroup'); else u.searchParams.set('dgroup', st.group);
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
        '<button class="btn primary" id="dvScanAll" type="button">Scan all</button>' +
        '<button class="btn" id="dvExpandAll" type="button">Expand all</button>' +
        '<button class="btn" id="dvCollapseAll" type="button">Collapse all</button>' +
      '</div>' +
      '<div id="dvStatus" class="sub"></div>' +
      '<div class="listhead" id="dvHead"></div>' +
      '<div id="dvList"></div>' +
      '<div class="bulkhost"><div class="bulkbar hidden" id="dvBar"></div><div class="bulkmsg hidden" id="dvMsg"></div></div>' +
      '<div id="dvModal"></div>';
    ['dvTeams', 'dvShowBtn', 'dvShowMenu', 'dvMod', 'dvGroup', 'dvSearch', 'dvScanAll', 'dvExpandAll', 'dvCollapseAll', 'dvStatus', 'dvHead', 'dvList', 'dvBar', 'dvMsg', 'dvModal']
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
    el.dvScanAll.addEventListener('click', function () { scanRoots(allRoots(null)); });
    el.dvExpandAll.addEventListener('click', function () { st.collapsed = {}; persist(); render(); });
    el.dvCollapseAll.addEventListener('click', collapseAll);
    el.dvList.addEventListener('click', onListClick);
    el.dvList.addEventListener('change', onListChange);
    el.dvBar.addEventListener('click', onBarClick);
    el.dvMsg.addEventListener('click', onBarClick);
    el.dvHead.addEventListener('change', onHeadChange);
    el.dvList.addEventListener('click', onRowTap);
    bindLongPress();
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
  function folderLink(f, cls, labelOverride) {
    var u = folderUrl(f), label = labelOverride || folderLabel(f);
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
  // NT-2wr2.35.1 (D1): a row carries no Add/Sync/Exclude; those run from the selection bar. View items stays (navigation).
  function chk(attrs, label) { return '<label class="dv-chk"><input type="checkbox" ' + attrs + ' aria-label="' + esc(label) + '"></label>'; }
  function rowHtml(f, d) {
    var key = esc(d.docId), tid = esc(f.teamId), acts = '';
    if (d.state === 'tracked') acts = '<div class="dv-acts"><button class="btn small" data-act="view" data-doc="' + key + '" data-team="' + tid + '">View items</button></div>';
    var sel = st.selected[d.docId] != null;
    var meta = [d.modified ? 'Edited ' + fmtDate(d.modified) : '', st.teams.length > 1 && st.group !== 'team' ? teamName(f.teamId) : ''].filter(Boolean).join(' · ');
    var metaHtml = esc(meta) + (d.canEdit === false ? (meta ? ' · ' : '') + '<span class="dv-viewonly">View only</span>' : '');
    // The folder is named on the row only when no folder header sits above it (Group by None).
    var folderLine = st.group === 'none' ? '<div class="dv-folderline"><span aria-hidden="true">📁</span> ' + folderLink(f, 'dv-where') + '</div>' : '';
    return '<div class="dv-row' + (sel ? ' sel' : '') + '">' +
      chk('class="rowsel" data-sel="' + key + '" data-team="' + tid + '"' + (sel ? ' checked' : ''), 'Select ' + (d.docName || '(untitled)')) +
      '<div class="dv-title"><a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.docName || '(untitled)') + '</a>' +
      '<div class="dv-meta">' + metaHtml + '</div>' + folderLine + '</div>' + pill(d) + acts + '</div>';
  }
  // Expand all / Collapse all (NT-2wr2.33): every team and every folder at every level, rendered or not.
  function collapseAll() {
    st.folders.forEach(function (f) { st.collapsed[folderKey(f)] = true; st.collapsed['team|' + f.teamId] = true; });
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
  // ---- selection model (NT-2wr2.35.1) --------------------------------------------------------------------------------
  // scopes: header key ('F:<folderKey>' / 'T:<teamId>') -> [{docId, teamId}] of every SHOWN document in that subtree (collapsed
  // folders included, filtered-out ones excluded). Rebuilt on every render.
  var scopes = {};
  function subtreeDocs(n) {
    var out = n.own.map(function (d) { return { docId: d.docId, teamId: n.f.teamId }; });
    n.kids.forEach(function (k) { out = out.concat(subtreeDocs(k)); });
    return out;
  }
  function shownMap() { // docId -> teamId for every document the current Show, Modified and search show
    var m = {};
    st.folders.forEach(function (f) { visibleDocs(f).forEach(function (d) { m[d.docId] = f.teamId; }); });
    return m;
  }
  function shownList() { var m = shownMap(); return Object.keys(m).map(function (k) { return { docId: k, teamId: m[k] }; }); }
  function setScope(list, on) { list.forEach(function (i) { if (on) st.selected[i.docId] = i.teamId; else delete st.selected[i.docId]; }); }
  function tri(c, list) {
    var n = list.filter(function (i) { return st.selected[i.docId] != null; }).length;
    c.checked = n > 0 && n === list.length; c.indeterminate = n > 0 && n < list.length;
  }
  // Brings every checkbox, row highlight and the bar in line with st.selected (no list re-render, so focus and scroll stay).
  function syncSelection() {
    Array.prototype.forEach.call(root.querySelectorAll('input[data-sel]'), function (r) {
      var on = st.selected[r.getAttribute('data-sel')] != null; r.checked = on;
      var row = r.closest('.dv-row'); if (row) row.classList.toggle('sel', on);
    });
    Array.prototype.forEach.call(root.querySelectorAll('input[data-fsel]'), function (c) { tri(c, scopes[c.getAttribute('data-fsel')] || []); });
    var all = document.getElementById('dvSelectAll');
    if (all) tri(all, shownList());
    renderBar();
  }
  function onHeadChange(ev) {
    if (ev.target.id !== 'dvSelectAll') return;
    setScope(shownList(), ev.target.checked);
    syncSelection();
  }
  function onFolderSelect(c) { setScope(scopes[c.getAttribute('data-fsel')] || [], c.checked); syncSelection(); }
  function toggleDoc(docId, teamId) { if (st.selected[docId] != null) delete st.selected[docId]; else st.selected[docId] = teamId; syncSelection(); }
  // Phone: once selecting, a tap on a row toggles it; a long press starts selecting (touch only; moving the finger cancels).
  function onRowTap(ev) {
    var row = ev.target.closest && ev.target.closest('.dv-row');
    if (row && Object.keys(st.selected).length && window.matchMedia('(max-width:640px)').matches && !ev.target.closest('a,button,input,select,label')) {
      var c = row.querySelector('input[data-sel]'); if (c) toggleDoc(c.getAttribute('data-sel'), c.getAttribute('data-team'));
    }
  }
  function bindLongPress() {
    var timer = null, sx = 0, sy = 0, cancel = function () { clearTimeout(timer); timer = null; };
    el.dvList.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      var row = e.target.closest && e.target.closest('.dv-row');
      if (!row || e.target.closest('a,button,input,select,label')) return;
      var c = row.querySelector('input[data-sel]'); if (!c) return;
      sx = e.clientX; sy = e.clientY;
      timer = setTimeout(function () {
        timer = null; toggleDoc(c.getAttribute('data-sel'), c.getAttribute('data-team'));
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* no haptics */ } }
        el.dvList.addEventListener('click', function (ev) { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true }); // swallow the click that ends the press
      }, 500);
    });
    el.dvList.addEventListener('pointermove', function (e) { if (timer && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { el.dvList.addEventListener(t, cancel); });
    el.dvList.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('.dv-row') && window.matchMedia('(pointer:coarse)').matches) e.preventDefault(); });
  }
  // ---- tree (NT-2wr2.33) ---------------------------------------------------------------------------------------------
  // Within one (teamId, rootFolderId) a subfolder's parent is the entry whose path, minus the root name, is its path minus the
  // last segment; with no such entry it attaches to the nearest existing ancestor and is labelled by the remaining segments.
  function buildTrees(fs) {
    var teams = [], tmap = {}, nodes = {};
    function team(id) { return tmap[id] || (tmap[id] = (teams.push({ teamId: id, roots: [], other: [] }), teams[teams.length - 1])); }
    fs.forEach(function (f) {
      var t = team(f.teamId), n = { f: f, label: folderLabel(f), kids: [], own: [], shown: 0 };
      if (f.teamId === '' || !f.folderId) { t.other.push(n); return; }
      if (isRoot(f)) { n.rest = ''; nodes[f.teamId + '|' + f.rootFolderId + '|'] = n; t.roots.push(n); return; }
      var segs = String(f.path || f.name || '').split('/');
      n.rest = f.path ? segs.slice(1).join('/') : String(f.name || f.folderId); n.rootKey = f.teamId + '|' + f.rootFolderId + '|'; n.pending = true;
      t.roots.push(n);
    });
    teams.forEach(function (t) {
      var top = [];
      t.roots.forEach(function (n) { if (!n.pending) top.push(n); else nodes[n.rootKey + n.rest] = n; });
      t.roots.forEach(function (n) {
        if (!n.pending) return;
        var segs = n.rest.split('/'), parent = null, k;
        for (k = segs.length - 1; k >= 0 && !parent; k--) parent = nodes[n.rootKey + segs.slice(0, k).join('/')] || null;
        if (parent) { n.label = segs.slice(k + 1).join('/'); parent.kids.push(n); } else top.push(n); // orphan: own top-level node
      });
      t.roots = top;
    });
    function sortKids(n) { n.kids.sort(function (a, b) { return a.label.localeCompare(b.label); }); n.kids.forEach(sortKids); }
    teams.forEach(function (t) { t.roots.forEach(sortKids); });
    return teams;
  }
  function tally(n) { n.own = visibleDocs(n.f); n.shown = n.own.length; n.kids.forEach(function (k) { n.shown += tally(k); }); return n.shown; }
  function shownKids(n) { return n.kids.filter(function (k) { return k.shown > 0; }); }
  var rendered = 0;
  function folderHtml(n) {
    rendered++;
    var cur = n, label = n.label, next;
    // A subfolder with no shown documents of its own and exactly one shown child merges into one header ("A / B").
    while (cur.f.folderId && !isRoot(cur.f) && !cur.own.length && (next = shownKids(cur)).length === 1) { cur = next[0]; label += ' / ' + cur.label; }
    var f = cur.f, id = folderKey(n.f), sid = folderKey(f), docs = cur.own, collapsed = !!st.collapsed[id], kids = shownKids(cur);
    var pathHtml = folderLink(f, 'dv-path', label);
    var chip = st.group === 'folder' && st.teams.length > 1 && f.teamId ? '<span class="dv-chip">' + esc(teamName(f.teamId)) + '</span>' : '';
    var scan = '';
    if (n.f.folderId && n.f.teamId !== '') { // NT-tuqn: the No team group has no folder to scan
      var busy = !!st.scanning[id];
      scan = '<span class="dv-scan"><span>' + esc(st.scanMsg[id] || ago(n.f.scannedAt)) + '</span>' +
        (st.scanOk ? '<button class="btn small" data-act="scan" data-fid="' + esc(n.f.folderId) + '" data-team="' + esc(n.f.teamId) + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Scanning…' : 'Scan') + '</button>' : '') + '</span>';
    }
    var fsel = '', scope = subtreeDocs(n);
    if (scope.length) {
      scopes['F:' + id] = scope;
      fsel = chk('class="foldersel" data-fsel="F:' + esc(id) + '" title="Select every shown document in this folder and its subfolders"', 'Select all ' + scope.length + ' shown in ' + label);
    }
    var tcount = (f.docs || []).filter(function (d) { return d.state === 'tracked'; }).length;
    var body = docs.length ? docs.map(function (d) { return rowHtml(f, d); }).join('')
      : kids.length ? '' : '<div class="dv-empty">' + (f.scannedAt && !cur.kids.length && !(f.docs || []).length ? 'No Google Docs in this folder'
        : (f.scannedAt || !f.folderId ? 'No documents match the Show filter.' : 'Not scanned yet. Scan to list its documents.')) + '</div>';
    return '<section class="dv-folder' + (collapsed ? ' collapsed' : '') + (tcount ? '' : ' dv-untracked') + '" data-fkey="' + esc(id) + '"><div class="dv-fhead">' +
      toggleBtn(id, label, collapsed) + fsel + pathHtml + chip + '<span class="sub dv-count" style="margin:0">' + n.shown + ' shown</span>' + summaryHtml(f, docs.length) + scan + '</div>' +
      '<div class="dv-rows">' + body + '</div>' + kids.map(folderHtml).join('') + '</section>';
  }
  function toggleBtn(key, name, collapsed) {
    return '<button class="dv-toggle" type="button" data-act="toggle" data-fkey="' + esc(key) + '" aria-expanded="' + !collapsed + '" aria-label="' + (collapsed ? 'Expand ' : 'Collapse ') + esc(name) + '">' +
      '<svg class="dv-chev" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
  }
  function otherNodes(t) { return t.other.filter(function (n) { return n.shown > 0; }); }
  // Group by Team: a team header over that team's root folders (each a nested tree) then Other tracked documents.
  function teamHtml(t) {
    var key = 'team|' + t.teamId, collapsed = !!st.collapsed[key], n = 0, name = t.teamId === '' ? 'No team' : teamName(t.teamId);
    t.roots.concat(t.other).forEach(function (x) { n += x.shown; });
    var scan = t.teamId !== '' && st.scanOk && t.roots.length ?
      '<button class="btn small dv-teamscan" data-act="scanteam" data-team="' + esc(t.teamId) + '"' + (Object.keys(st.scanning).length ? ' disabled' : '') + '>Scan team</button>' : '';
    var scope = []; t.roots.concat(t.other).forEach(function (x) { scope = scope.concat(subtreeDocs(x)); });
    var tsel = '';
    if (scope.length) { scopes['T:' + t.teamId] = scope; tsel = chk('class="foldersel teamsel" data-fsel="T:' + esc(t.teamId) + '"', 'Select all ' + scope.length + ' shown in ' + name); }
    return '<section class="dv-team' + (collapsed ? ' collapsed' : '') + '"><div class="dv-thead">' + toggleBtn(key, name, collapsed) + tsel +
      '<strong>' + esc(name) + '</strong><span class="sub" style="margin:0">' + n + ' shown</span>' + scan + '</div>' +
      t.roots.concat(otherNodes(t)).map(folderHtml).join('') + '</section>';
  }
  // Group by None: one flat list, most recently edited first.
  function flatHtml(fs) {
    var rows = [];
    fs.forEach(function (f) { visibleDocs(f).forEach(function (d) { rows.push({ f: f, d: d }); }); });
    rows.sort(function (a, b) { return String(b.d.modified || '').localeCompare(String(a.d.modified || '')); });
    return '<section class="dv-folder"><div class="dv-rows">' + rows.map(function (r) { return rowHtml(r.f, r.d); }).join('') + '</div></section>';
  }
  // Every selected team with a root and every root always renders; a subfolder renders only when its subtree has a shown document.
  function listHtml() {
    rendered = 0; scopes = {};
    if (st.group === 'none') { var vf = visibleFolders(); rendered = vf.length; return vf.length ? flatHtml(vf) : ''; }
    var teams = buildTrees(st.folders);
    teams.forEach(function (t) { t.roots.concat(t.other).forEach(tally); });
    if (st.group === 'team') return teams.map(teamHtml).join('');
    var roots = [], others = [];
    teams.forEach(function (t) { roots = roots.concat(t.roots); others = others.concat(otherNodes(t)); });
    return roots.concat(others).map(folderHtml).join('');
  }
  // ---- scan scope (NT-2wr2.33): roots come from the loaded list, never from what Show/Modified/search/collapse leave visible
  function allRoots(teamId) {
    var seen = {};
    return st.folders.filter(function (f) {
      if (!isRoot(f) || (teamId != null && f.teamId !== teamId)) return false;
      var k = folderKey(f); if (seen[k]) return false; seen[k] = true; return true;
    });
  }
  function scanAllLabel() {
    var roots = allRoots(null), teams = {}; roots.forEach(function (f) { teams[f.teamId] = true; });
    var nt = Object.keys(teams).length;
    return 'Scan all (' + roots.length + ' folder' + (roots.length === 1 ? '' : 's') + (nt > 1 ? ', ' + nt + ' teams' : '') + ')';
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
    el.dvScanAll.textContent = scanAllLabel();
    el.dvScanAll.disabled = st.busy || Object.keys(st.scanning).length > 0;
    var html = (st.loaded && !st.error && st.folders.length) ? listHtml() : '', folders = { length: rendered };
    if (st.loading) el.dvStatus.textContent = 'Loading documents…';
    else el.dvStatus.textContent = st.error ? '' : (st.loaded ? folders.length + ' folder' + (folders.length === 1 ? '' : 's') : '');
    var sm = html ? shownMap() : {}, nShown = Object.keys(sm).length; // NT-2wr2.35.1 (D3): list header
    el.dvHead.innerHTML = html && !st.clearing && nShown ? '<div class="sub" id="dvCount" role="status" style="margin:0">' + nShown + ' document' + (nShown === 1 ? '' : 's') + ' in ' + folders.length + ' folder' + (folders.length === 1 ? '' : 's') + '</div>' +
      '<label class="dv-chk dv-selall" title="Select every document the current Show, Modified and search filters show, including those in collapsed folders"><input type="checkbox" id="dvSelectAll" aria-label="Select all ' + nShown + ' shown documents"> Select all ' + nShown + '</label>' : '';
    if (st.error) el.dvList.innerHTML = '<div class="empty">' + esc(st.error) + ' <button class="linkbtn" data-act="retry">Retry</button></div>';
    else if (st.loading && st.clearing) el.dvList.innerHTML = '<div class="statecard busyph"><h2><span class="busylbl">Loading documents…</span></h2><p><span class="spinner" aria-hidden="true"></span></p></div>';
    else if (st.loading && !st.loaded) el.dvList.innerHTML = '';
    else if (st.emptySel) el.dvList.innerHTML = '<div class="empty"><strong>No teams selected</strong><br>Choose at least one team (or No team) in the Teams filter.</div>';
    else if (!st.loaded) el.dvList.innerHTML = '<div class="empty">Choose a team to see its documents.</div>';
    else if (!st.folders.length) el.dvList.innerHTML = '<div class="empty"><strong>No documents yet</strong><br>Your teams have no folders you can see here. Ask your team lead to share the team folder with your account.</div>';
    else if (!html) el.dvList.innerHTML = '<div class="empty"><strong>Nothing matches these filters</strong><br>Change Show or Modified, or clear the search.</div>';
    else el.dvList.innerHTML = html;
    syncSelection();
    SH().reapplyBusy();
  }
  function rowsFor(ids) {
    return function () {
      return Array.prototype.filter.call(root.querySelectorAll('.dv-row'), function (r) {
        var c = r.querySelector('input[data-sel]'); return c && ids.indexOf(c.getAttribute('data-sel')) !== -1;
      });
    };
  }
  // D4: eligibility over every selected document, hidden ones included. canEdit null counts as eligible (the server decides).
  function isPending(d) { return !!st.addedPending[d.docId]; }
  function canAdd(d) { return !!d && d.state !== 'tracked' && !isPending(d) && d.canEdit !== false; }
  function canSync(d) { return !!d && d.state === 'tracked' && d.canEdit !== false; }
  function canExclude(d) { return !!d && d.state !== 'excluded' && !isPending(d); }
  function selectedItems() { return Object.keys(st.selected).map(function (i) { return { docId: i, teamId: st.selected[i] }; }); }
  function eligible(items, fn) { return items.filter(function (i) { return fn(findDoc(i.docId)); }); }
  function actBtn(act, label, n, why, primary) {
    var off = st.busy || !n;
    return '<button class="btn small' + (primary ? ' primary' : '') + '" type="button" data-bar="' + act + '"' + (off ? ' disabled' : '') +
      ' title="' + esc(st.busy ? 'Wait for the current run to finish' : n ? label + ' the ' + n + ' selected document' + (n === 1 ? '' : 's') + ' that can be ' + why : 'None of the selected documents can be ' + why) + '">' + label + ' (' + n + ')</button>';
  }
  function renderBar() {
    var items = selectedItems(), n = items.length;
    el.dvBar.classList.toggle('hidden', !n);
    if (!n) el.dvBar.innerHTML = '';
    else {
      var sm = shownMap(), hid = items.filter(function (i) { return sm[i.docId] == null; }).length;
      el.dvBar.innerHTML = '<span id="dvBarCount" role="status">' + n + ' selected' + (hid ? ' (' + hid + ' hidden by filters)' : '') + '</span>' +
        '<button class="linkbtn" type="button" data-bar="clear" title="Deselect everything"' + (st.busy ? ' disabled' : '') + '>Clear</button>' +
        actBtn('add', 'Add', eligible(items, canAdd).length, 'added', true) +
        actBtn('sync', 'Sync', eligible(items, canSync).length, 'synced', false) +
        (st.excludeOk ? actBtn('exclude', 'Exclude', eligible(items, canExclude).length, 'excluded', false) : '') +
        (st.run ? '<button class="btn small" type="button" data-bar="stop"' + (st.stop ? ' disabled' : '') + ' title="Finish the current document and skip the rest">' + (st.stop ? 'Stopping…' : 'Stop') + '</button>' : '');
    }
    var m = st.bulkMsg;
    el.dvMsg.classList.toggle('hidden', !m);
    el.dvMsg.setAttribute('role', m && m.error ? 'alert' : 'status');
    el.dvMsg.innerHTML = m ? '<span>' + esc(m.text) + '</span>' + (st.run ? '' : '<button class="linkbtn" type="button" data-bar="dismiss">Dismiss</button>') : '';
  }
  // Message in .bulkmsg; a finished run's message clears after 20 s (Items behaviour).
  function setMsg(text, error, timed) {
    clearTimeout(setMsg.t);
    st.bulkMsg = text ? { text: text, error: !!error } : null;
    if (text && timed) setMsg.t = setTimeout(function () { st.bulkMsg = null; renderBar(); }, 20000);
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
    syncSelection();
  }
  function onListClick(ev) {
    var b = ev.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), doc = b.getAttribute('data-doc'), team = b.getAttribute('data-team');
    if (act === 'toggle') { var k = b.getAttribute('data-fkey'); st.collapsed[k] = !st.collapsed[k]; if (!st.collapsed[k]) delete st.collapsed[k]; persist(); render(); }
    else if (act === 'retry') load(true);
    else if (act === 'scan') scanFolder(team, b.getAttribute('data-fid'));
    else if (act === 'scanteam') scanRoots(allRoots(team));
    else if (act === 'view') { st.pendingScroll = window.scrollY; SH().openItemsForDoc(doc, team); }
  }
  function onBarClick(ev) {
    var b = ev.target.closest('[data-bar]'); if (!b || b.disabled) return; var a = b.getAttribute('data-bar');
    if (a === 'clear') { if (!st.busy) { st.selected = {}; syncSelection(); } }
    else if (a === 'dismiss') { setMsg(''); renderBar(); }
    else if (a === 'stop') { st.stop = true; renderBar(); }
    else if (a === 'sync') runSeq('sync', eligible(selectedItems(), canSync));
    else if (a === 'add') runSeq('add', eligible(selectedItems(), canAdd));
    else if (a === 'exclude') excludeDocs(eligible(selectedItems(), canExclude));
  }
  function restoreScroll() {
    if (st.pendingScroll != null) { var y = st.pendingScroll; st.pendingScroll = null; setTimeout(function () { window.scrollTo(0, y); }, 0); }
  }

  // ---- Add / Sync (team_sync_document, one document per call, sequential, Stop finishes the current one) ------------
  // Add sends teamId '' (the server resolves it); Sync sends the document's own teamId. Succeeded documents leave the selection;
  // failed and skipped ones stay selected.
  function runSeq(kind, items) {
    if (!items.length || st.busy) return;
    var add = kind === 'add', word = add ? 'Adding' : 'Syncing', ok = {}, okN = 0, failed = 0, i = 0;
    st.busy = true; st.stop = false; st.run = kind;
    function finish() {
      var skipped = items.length - i;
      st.busy = false; st.run = null; st.stop = false;
      items.forEach(function (it) { if (ok[it.docId]) delete st.selected[it.docId]; });
      var text = okN + (add ? ' added' : ' synced') + (failed ? ', ' + failed + ' failed (still selected)' : '') + (skipped ? ', ' + skipped + ' skipped (stopped, still selected)' : '') +
        (add && okN ? '. Their items appear after the next sync.' : '');
      setMsg(text, !okN, true);
      if (!okN) SH().toastError(text); else SH().toast(text);
      render(); if (add) setTimeout(function () { load(true); }, 4000); else load(true);
    }
    function next() {
      if (i >= items.length || st.stop) { finish(); return; }
      var it = items[i++];
      setMsg(word + ' ' + i + ' of ' + items.length + '…'); renderBar();
      SH().withBusy(rowsFor([it.docId]), 'row', word + '…', function () {
        return SH().postJson({ action: 'team_sync_document', teamId: add ? '' : it.teamId, docId: it.docId }).then(function (res) {
          if (res && res.ok !== false && !res.error) { ok[it.docId] = true; okN++; if (add) st.addedPending[it.docId] = true; } else failed++;
        }).catch(function () { failed++; });
      }, { live: false }).then(function () { render(); next(); });
    }
    render(); next();
  }

  // ---- Exclude (team_exclude_documents) ---------------------------------------------------------------------------
  function excludeDocs(items) {
    if (!items.length || st.busy) return;
    var tracked = items.map(function (i) { return findDoc(i.docId); }).filter(function (d) { return d.state === 'tracked'; });
    var sm = shownMap(), hid = items.filter(function (i) { return sm[i.docId] == null; }).length;
    if (!tracked.length && !hid) return runExclude(items);
    var n = tracked.reduce(function (s, d) { return s + (d.itemCount != null ? d.itemCount : (d.openCount || 0)); }, 0), text = '';
    if (tracked.length) text = tracked.length === 1
      ? 'This document has ' + n + ' tracked item' + (n === 1 ? '' : 's') + '. Excluding it removes them from Tracker.'
      : tracked.length + ' of these documents are tracked, with ' + n + ' tracked items in all. Excluding them removes those items from Tracker.';
    else text = 'Exclude ' + items.length + ' document' + (items.length === 1 ? '' : 's') + '?';
    if (hid) text += ' ' + hid + ' of these ' + (hid === 1 ? 'is' : 'are') + ' hidden by your filters.';
    el.dvModal.innerHTML = '<div class="dv-confirm" role="dialog" aria-modal="true"><div class="box"><p>' + esc(text) + '</p>' +
      '<div class="btns"><button class="btn" id="dvCancel">Cancel</button><button class="btn danger" id="dvGo">Exclude</button></div></div></div>';
    document.getElementById('dvCancel').addEventListener('click', function () { el.dvModal.innerHTML = ''; });
    document.getElementById('dvGo').addEventListener('click', function () { el.dvModal.innerHTML = ''; runExclude(items); });
    document.getElementById('dvGo').focus();
  }
  function runExclude(items) {
    st.busy = true; setMsg('Excluding ' + items.length + '…'); render();
    return SH().withBusy(rowsFor(items.map(function (i) { return i.docId; })), 'row', 'Excluding…', function () {
      return new Promise(function (resolve) { runExcludeJobs(items, resolve); });
    });
  }
  function runExcludeJobs(items, resolve) {
    var byTeam = {}; items.forEach(function (i) { (byTeam[i.teamId] = byTeam[i.teamId] || []).push(i.docId); });
    var jobs = [];
    Object.keys(byTeam).forEach(function (t) { for (var k = 0; k < byTeam[t].length; k += 50) jobs.push({ teamId: t, docIds: byTeam[t].slice(k, k + 50) }); });
    var done = 0, refused = 0, removed = 0, j = 0, unavailable = false, ok = {};
    function next() {
      if (j >= jobs.length) {
        st.busy = false;
        Object.keys(ok).forEach(function (id) { delete st.selected[id]; });
        var text;
        if (unavailable) { st.excludeOk = false; text = 'Exclude is not available right now.'; }
        else text = done + ' excluded' + (refused ? ', ' + refused + ' refused (still selected)' : '') + (removed ? '. ' + removed + ' items removed from Tracker.' : '');
        setMsg(text, unavailable || !done, true);
        if (unavailable || (refused && !done)) SH().toastError(text); else SH().toast(text);
        render(); load(true).then(resolve, resolve); return;
      }
      var job = jobs[j++];
      SH().postJson({ action: 'team_exclude_documents', teamId: job.teamId, docIds: job.docIds }).then(function (res) {
        if (res && res.ok && Array.isArray(res.results)) {
          res.results.forEach(function (r) { if (r.outcome === 'excluded') { done++; ok[r.docId] = true; removed += r.removedItems || 0; } else refused++; });
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
        if (!res.complete && ++rounds < 40) return step();
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
  function scanRoots(roots) {
    // NT-2wr2.31: stalest first: never-scanned roots, then oldest scannedAt. Duplicates are skipped by scanFolder.
    roots = roots.slice().sort(function (x, y) { return (x.scannedAt ? new Date(x.scannedAt).getTime() : 0) - (y.scannedAt ? new Date(y.scannedAt).getTime() : 0); });
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
