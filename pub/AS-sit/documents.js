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

  var st = {
    built: false, loaded: false, loading: false, loadedKey: '', error: '',
    teams: [], folders: [],
    show: { tracked: true, not_tracked: true, excluded: false },
    search: '', collapsed: {}, selected: {},      // selected: docId -> teamId
    scanning: {}, scanMsg: {}, busy: false, bulkMsg: '',
    excludeOk: true, scanOk: true, pendingScroll: null, addedPending: {}
  };
  try {
    var saved = JSON.parse(localStorage.getItem(LS) || '{}');
    if (saved.show) st.show = Object.assign(st.show, saved.show);
    if (saved.collapsed) st.collapsed = saved.collapsed;
  } catch (e) { /* storage unavailable: defaults */ }
  function persist() { try { localStorage.setItem(LS, JSON.stringify({ show: st.show, collapsed: st.collapsed })); } catch (e) {} }

  var el = {};
  function build() {
    if (st.built) return;
    st.built = true;
    root.innerHTML =
      '<div class="dv-toolbar">' +
        '<span id="dvTeams"></span>' +
        '<span class="dv-show"><button class="btn" id="dvShowBtn" type="button" aria-haspopup="true" aria-expanded="false"></button>' +
        '<div class="dv-showmenu hidden" id="dvShowMenu"></div></span>' +
        '<input type="search" id="dvSearch" placeholder="Search documents or folders" aria-label="Search documents">' +
        '<button class="btn" id="dvScanAll" type="button">Scan all shown</button>' +
      '</div>' +
      '<div id="dvStatus" class="sub"></div>' +
      '<div id="dvList"></div>' +
      '<div class="bulkhost"><div class="bulkbar hidden" id="dvBar"></div><div class="bulkmsg hidden" id="dvMsg"></div></div>' +
      '<div id="dvModal"></div>';
    ['dvTeams', 'dvShowBtn', 'dvShowMenu', 'dvSearch', 'dvScanAll', 'dvStatus', 'dvList', 'dvBar', 'dvMsg', 'dvModal']
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
    el.dvSearch.addEventListener('input', function () { st.search = el.dvSearch.value.trim().toLowerCase(); render(); });
    el.dvScanAll.addEventListener('click', scanAllShown);
    el.dvList.addEventListener('click', onListClick);
    el.dvList.addEventListener('change', onListChange);
    el.dvBar.addEventListener('click', onBarClick);
  }

  // ---- data -------------------------------------------------------------------------------------------------------
  function teamKey() { return SH().selectedTeamIds().slice().sort().join(','); }
  function load(force) {
    var key = teamKey();
    if (st.loading) return;
    if (!force && st.loaded && key === st.loadedKey) return;
    if (!key) { st.loaded = false; st.error = ''; render(); return; } // teams not known yet; show() runs again when they arrive
    st.loading = true; st.error = ''; render();
    SH().postJson({ action: 'list_team_documents', teamIds: SH().selectedTeamIds() }).then(function (res) {
      st.loading = false;
      if (!res || res.ok === false) { st.error = errText(res); st.folders = []; st.loaded = true; st.loadedKey = key; render(); return; }
      st.teams = res.teams || []; st.folders = res.folders || []; st.loaded = true; st.loadedKey = key;
      st.selected = {}; st.addedPending = {};
      render(); restoreScroll();
    }).catch(function (err) { st.loading = false; st.error = 'Could not load documents: ' + (err.message || err); render(); });
  }
  function errText(res) {
    var r = res && (res.reason || res.error || res.outcome);
    if (r === 'forbidden') return 'You do not have access to documents here. Ask your team lead to share the team folder with your account.';
    return 'Could not load documents' + (r ? ' (' + r + ')' : '') + '.';
  }
  function teamName(id) { var t = st.teams.filter(function (x) { return x.teamId === id; })[0]; return t ? (t.teamName || t.teamId) : id; }
  function isRoot(f) { return f.folderId && f.folderId === f.rootFolderId; }

  // ---- render -----------------------------------------------------------------------------------------------------
  function visibleDocs(f) {
    return (f.docs || []).filter(function (d) {
      if (!st.show[d.state]) return false;
      if (!st.search) return true;
      return (d.docName || '').toLowerCase().indexOf(st.search) >= 0 || String(d.docId || '').toLowerCase() === st.search || (f.path || '').toLowerCase().indexOf(st.search) >= 0;
    });
  }
  function visibleFolders() {
    return st.folders.filter(function (f) {
      var n = visibleDocs(f).length;
      if (n) return true;
      if (st.search) return false;
      return f.folderId && !(f.docs || []).length; // an empty/unscanned folder still gets its header with Scan
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
    if (canAdd) {
      acts += d.canEdit === false ? '<span class="dv-viewonly">View only</span>'
        : '<button class="btn small" data-act="add" data-doc="' + key + '" data-team="' + tid + '">Add</button>';
    }
    if (st.excludeOk && d.state !== 'excluded' && !pending) acts += '<button class="btn small" data-act="exclude" data-doc="' + key + '" data-team="' + tid + '">Exclude</button>';
    var sel = st.selected[d.docId] != null;
    var meta = [d.modified ? 'Edited ' + fmtDate(d.modified) : '', st.teams.length > 1 ? teamName(f.teamId) : ''].filter(Boolean).join(' · ');
    return '<div class="dv-row' + (sel ? ' sel' : '') + '"><input type="checkbox" class="rowsel" data-sel="' + key + '" data-team="' + tid + '"' +
      (sel ? ' checked' : '') + ' aria-label="Select ' + esc(d.docName) + '">' +
      '<div class="dv-title"><a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.docName || '(untitled)') + '</a>' +
      '<div class="dv-meta">' + esc(meta) + '</div></div>' + pill(d) + '<div class="dv-acts">' + acts + '</div></div>';
  }
  function folderHtml(f) {
    var id = f.teamId + '|' + (f.folderId || 'other'), docs = visibleDocs(f), collapsed = !!st.collapsed[id];
    var pathHtml = f.url ? '<a class="dv-path" href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.path) + '</a>' : '<span class="dv-path">' + esc(f.path) + '</span>';
    var scan = '';
    if (f.folderId) {
      var busy = !!st.scanning[id];
      scan = '<span class="dv-scan"><span>' + esc(st.scanMsg[id] || ago(f.scannedAt)) + '</span>' +
        (st.scanOk ? '<button class="btn small" data-act="scan" data-fid="' + esc(f.folderId) + '" data-team="' + esc(f.teamId) + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Scanning…' : 'Scan') + '</button>' : '') + '</span>';
    }
    var body = docs.length ? docs.map(function (d) { return rowHtml(f, d); }).join('')
      : '<div class="dv-empty">' + (f.scannedAt || !f.folderId ? 'No documents match the Show filter.' : 'Not scanned yet. Scan to list its documents.') + '</div>';
    return '<section class="dv-folder' + (collapsed ? ' collapsed' : '') + '" data-fkey="' + esc(id) + '"><div class="dv-fhead">' +
      '<button class="dv-toggle" data-act="toggle" data-fkey="' + esc(id) + '" aria-expanded="' + !collapsed + '" aria-label="Collapse or expand folder">' + (collapsed ? '▸' : '▾') + '</button>' +
      pathHtml + '<span class="sub" style="margin:0">' + docs.length + ' shown</span>' + scan + '</div><div class="dv-rows">' + body + '</div></section>';
  }
  function render() {
    if (!st.built) return;
    el.dvShowBtn.textContent = 'Show: ' + ['tracked:Tracked', 'not_tracked:Not tracked', 'excluded:Excluded']
      .filter(function (p) { return st.show[p.split(':')[0]]; }).map(function (p) { return p.split(':')[1]; }).join(', ') || 'Show: none';
    if (!/^Show/.test(el.dvShowBtn.textContent)) el.dvShowBtn.textContent = 'Show: none';
    el.dvShowMenu.innerHTML = [['tracked', 'Tracked'], ['not_tracked', 'Not tracked'], ['excluded', 'Excluded']].map(function (p) {
      return '<label><input type="checkbox" data-k="' + p[0] + '"' + (st.show[p[0]] ? ' checked' : '') + '> ' + p[1] + '</label>';
    }).join('');
    el.dvScanAll.classList.toggle('hidden', !st.scanOk);
    el.dvScanAll.disabled = st.busy || Object.keys(st.scanning).length > 0;
    var folders = visibleFolders();
    if (st.loading) el.dvStatus.textContent = 'Loading documents…';
    else el.dvStatus.textContent = st.error ? '' : (st.loaded ? folders.length + ' folder' + (folders.length === 1 ? '' : 's') : '');
    if (st.error) el.dvList.innerHTML = '<div class="empty">' + esc(st.error) + ' <button class="linkbtn" data-act="retry">Retry</button></div>';
    else if (st.loading && !st.loaded) el.dvList.innerHTML = '';
    else if (!st.loaded) el.dvList.innerHTML = '<div class="empty">Choose a team to see its documents.</div>';
    else if (!st.folders.length) el.dvList.innerHTML = '<div class="empty"><strong>No documents yet</strong><br>Your teams have no folders you can see here. Ask your team lead to share the team folder with your account.</div>';
    else if (!folders.length) el.dvList.innerHTML = '<div class="empty"><strong>Nothing matches these filters</strong><br>Change Show or clear the search.</div>';
    else el.dvList.innerHTML = folders.map(folderHtml).join('');
    renderBar();
  }
  function renderBar() {
    var ids = Object.keys(st.selected), n = ids.length;
    el.dvBar.classList.toggle('hidden', !n);
    if (n) {
      var f = allDocs(); var addable = ids.filter(function (i) { var d = f[i]; return d && d.state !== 'tracked' && d.canEdit !== false; }).length;
      el.dvBar.innerHTML = '<strong>' + n + ' selected</strong>' +
        '<button class="btn small primary" data-bar="add"' + (addable && !st.busy ? '' : ' disabled') + '>Add' + (addable ? ' (' + addable + ')' : '') + '</button>' +
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
    var id = ev.target.getAttribute('data-sel'); if (!id) return;
    if (ev.target.checked) st.selected[id] = ev.target.getAttribute('data-team'); else delete st.selected[id];
    var row = ev.target.closest('.dv-row'); if (row) row.classList.toggle('sel', ev.target.checked);
    renderBar();
  }
  function onListClick(ev) {
    var b = ev.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), doc = b.getAttribute('data-doc'), team = b.getAttribute('data-team');
    if (act === 'toggle') { var k = b.getAttribute('data-fkey'); st.collapsed[k] = !st.collapsed[k]; if (!st.collapsed[k]) delete st.collapsed[k]; persist(); render(); }
    else if (act === 'retry') load(true);
    else if (act === 'scan') scanFolder(team, b.getAttribute('data-fid'));
    else if (act === 'view') { st.pendingScroll = window.scrollY; SH().openItemsForDoc(doc, team); }
    else if (act === 'add') addDocs([{ docId: doc, teamId: team }]);
    else if (act === 'exclude') excludeDocs([{ docId: doc, teamId: team }]);
  }
  function onBarClick(ev) {
    var b = ev.target.closest('[data-bar]'); if (!b) return; var a = b.getAttribute('data-bar');
    var items = Object.keys(st.selected).map(function (i) { return { docId: i, teamId: st.selected[i] }; });
    if (a === 'clear') { st.selected = {}; render(); }
    else if (a === 'dismiss') { st.bulkMsg = ''; renderBar(); }
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
        SH().toast(st.bulkMsg); render(); setTimeout(function () { load(true); }, 4000); return;
      }
      var it = items[i++];
      SH().postJson({ action: 'team_sync_document', teamId: '', docId: it.docId }).then(function (res) {
        if (res && res.ok) { added++; st.addedPending[it.docId] = true; } else denied++;
      }).catch(function () { denied++; }).then(function () { render(); next(); });
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
    var byTeam = {}; items.forEach(function (i) { (byTeam[i.teamId] = byTeam[i.teamId] || []).push(i.docId); });
    var jobs = [];
    Object.keys(byTeam).forEach(function (t) { for (var k = 0; k < byTeam[t].length; k += 50) jobs.push({ teamId: t, docIds: byTeam[t].slice(k, k + 50) }); });
    var done = 0, refused = 0, removed = 0, j = 0, unavailable = false;
    function next() {
      if (j >= jobs.length) {
        st.busy = false; st.selected = {};
        if (unavailable) { st.excludeOk = false; st.bulkMsg = 'Exclude is not available right now.'; }
        else st.bulkMsg = done + ' excluded' + (refused ? ', ' + refused + ' not allowed' : '') + (removed ? '. ' + removed + ' items removed from Tracker.' : '');
        SH().toast(st.bulkMsg); render(); load(true); return;
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
  function mergeFolders(returned) {
    returned.forEach(function (nf) {
      var idx = -1;
      st.folders.forEach(function (f, i) { if (f.teamId === nf.teamId && f.folderId === nf.folderId) idx = i; });
      if (idx >= 0) st.folders[idx] = nf; else st.folders.push(nf);
    });
    st.folders.sort(function (a, b) { return (a.teamId + '|' + a.path).localeCompare(b.teamId + '|' + b.path); });
  }
  function scanFolder(teamId, folderId) {
    var id = teamId + '|' + folderId;
    if (st.scanning[id]) return Promise.resolve();
    st.scanning[id] = true; st.scanMsg[id] = 'Scanning…'; render();
    var runStartedAt = null, rounds = 0;
    function step() {
      var p = { action: 'team_scan_folder', teamId: teamId, folderId: folderId };
      if (runStartedAt) p.runStartedAt = runStartedAt;
      return SH().postJson(p).then(function (res) {
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
    return step().catch(function (err) { st.scanMsg[id] = 'Scan failed: ' + (err.message || err); })
      .then(function () { delete st.scanning[id]; if (st.scanMsg[id] === '') delete st.scanMsg[id]; render(); });
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
})();
