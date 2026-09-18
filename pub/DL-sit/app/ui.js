// app/ui.js — DOM helpers, escaping, toast, busy state, dialog, confirm, focus
// management. Per DESIGN.md: "Escaping (default-on: renderers take data, never HTML
// strings)". Every other module builds DOM through these helpers, never via innerHTML
// with unescaped values.
var NDocsUI = (function () {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // el(tag, attrs?, children?) -> HTMLElement. children are strings (text) or Nodes.
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  var toastTimer = null;
  function toast(message, kind) {
    var host = document.getElementById('ndocs-toast');
    if (!host) {
      host = el('div', { id: 'ndocs-toast', class: 'ndocs-toast', role: 'status' });
      document.body.appendChild(host);
    }
    host.textContent = message;
    host.className = 'ndocs-toast ndocs-toast--' + (kind || 'info') + ' ndocs-toast--visible';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      host.className = 'ndocs-toast';
    }, 4000);
  }

  function setBusy(container, isBusy) {
    if (!container) return;
    container.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    container.classList.toggle('ndocs-busy', !!isBusy);
  }

  // confirmDialog(message) -> Promise<boolean>. Shape only in this bead — a real modal
  // with focus management lands with NDocs-kh4, which is the first bead that needs one
  // (retire, bulk actions, certification submit).
  function confirmDialog(message) {
    return Promise.resolve(window.confirm(message)); // eslint-disable-line no-alert
  }

  // renderNav(principal) — the one consistent header row across all four pages
  // (catalog.html/team.html/resource.html/tools.html), admin-UI-restructure addendum
  // (post-Stage-15, 2026-09-17). Replaces each page's own hand-rolled `#ndocs-my-teams`.
  // Renders into `#ndocs-nav` (every page markup declares this container); a page missing it
  // is a no-op rather than a throw, same defensive shape `wireDropToggle` (page-search.js)
  // already uses for an optional element.
  //
  // `principal` is `whoami`'s own response shape — the caller's teams, `isAdmin`, and, for an
  // admin only, `spreadsheetUrl` (omitted entirely for a non-admin, enforced server-side in
  // `H_Meta_whoami`). "Tools" and "Open spreadsheet" render only when `isAdmin` is true, and
  // the spreadsheet link only when `spreadsheetUrl` is actually present — never a disabled
  // control, per the design: an admin-only link that simply isn't there for anyone else.
  function renderNav(principal) {
    var host = document.getElementById('ndocs-nav');
    if (!host) return;
    host.textContent = '';
    if (!principal) return;

    (principal.teams || []).forEach(function (t) {
      // No role suffix — every team member carries the same permissions (2026-09-14
      // decision, ADR-0003 amended).
      host.appendChild(el('a', { href: 'team.html?team=' + encodeURIComponent(t.teamId), text: t.name }));
      host.appendChild(document.createTextNode(' '));
    });

    if (principal.isAdmin) {
      host.appendChild(el('a', { href: 'tools.html', text: 'Tools' }));
      host.appendChild(document.createTextNode(' '));
      if (principal.spreadsheetUrl) {
        host.appendChild(el('a', {
          href: principal.spreadsheetUrl, target: '_blank', rel: 'noopener', text: 'Open spreadsheet'
        }));
      }
    }
  }

  return {
    escapeHtml: escapeHtml,
    el: el,
    toast: toast,
    setBusy: setBusy,
    confirmDialog: confirmDialog,
    renderNav: renderNav
  };
})();
