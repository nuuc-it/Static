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

  // announce(msg) — a shared `role="status"`/`aria-live="polite"` region for search counts,
  // save/registration outcomes, and job-state changes (ux-components.md "Accessibility
  // requirements": announced without moving focus). One region, reused by every caller, so a
  // page that announces twice in quick succession still reads as one coherent update rather
  // than two competing live regions.
  function announce(msg) {
    var host = document.getElementById('ndocs-announcer');
    if (!host) {
      host = el('div', { id: 'ndocs-announcer', class: 'ndocs-announcer', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(host);
    }
    // Clearing first, then setting on a tick, forces AT to re-announce identical consecutive
    // text (e.g. "3 results" -> search again -> "3 results") — a live region that never
    // changes value never fires.
    host.textContent = '';
    window.setTimeout(function () { host.textContent = msg; }, 30);
  }

  // confirm(spec) -> Promise<boolean> over a native <dialog> (NDocs-st4). Replaces
  // `window.confirm` on the retire/supersede/bulk paths per ADR-0012 §8. `spec`:
  //   title: string — the action name, e.g. "Retire resource"
  //   body: string | Node[] — names the affected item(s) and the consequence
  //   confirmLabel: string — explicit primary label, never "OK"
  //   cancelLabel: string — defaults to "Cancel"
  //   danger: boolean — styles the primary button as destructive
  // Focus returns to the control that opened the dialog once it closes, on either path.
  function confirm(spec) {
    spec = spec || {};
    return new Promise(function (resolve) {
      var opener = document.activeElement;
      var dialog = el('dialog', { class: 'dialog' });
      var inner = el('div', { class: 'dialog-inner' });
      inner.appendChild(el('h2', { text: spec.title || 'Confirm' }));
      if (typeof spec.body === 'string') {
        inner.appendChild(el('p', { text: spec.body }));
      } else if (Array.isArray(spec.body)) {
        spec.body.forEach(function (node) { inner.appendChild(node); });
      }
      var cancelBtn = el('button', { type: 'button', class: 'button', text: spec.cancelLabel || 'Cancel' });
      var confirmBtn = el('button', {
        type: 'button',
        class: 'button ' + (spec.danger ? 'button--danger' : 'button--primary'),
        text: spec.confirmLabel || 'Confirm'
      });
      inner.appendChild(el('div', { class: 'button-row' }, [cancelBtn, confirmBtn]));
      dialog.appendChild(inner);
      document.body.appendChild(dialog);

      function close(result) {
        dialog.close();
        dialog.remove();
        if (opener && typeof opener.focus === 'function') opener.focus();
        resolve(result);
      }

      cancelBtn.addEventListener('click', function () { close(false); });
      confirmBtn.addEventListener('click', function () { close(true); });
      dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(false); }); // Esc key
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        // No <dialog> support: fail safe to the old behavior rather than silently no-op.
        dialog.remove();
        resolve(window.confirm((spec.title ? spec.title + ': ' : '') + (typeof spec.body === 'string' ? spec.body : ''))); // eslint-disable-line no-alert
        return;
      }
      confirmBtn.focus();
    });
  }

  // renderNav(principal, activePage) — the one consistent header row across all five pages.
  // Renders into `#ndocs-nav` (declared by app/shell.js on the rebuilt pages, and directly by
  // the not-yet-rebuilt pages' own markup); a page missing it is a no-op rather than a throw.
  //
  // NDocs-xg4: a `details`-based "Teams" menu populated from bootstrap data replaces one
  // inline link per team, which does not scale past a handful of teams. `activePage`, when
  // given, marks the matching entry `aria-current="page"` (ux-components.md "Shell").
  //
  // `principal` is `whoami`'s own response shape — the caller's teams, `isAdmin`, and, for an
  // admin only, `spreadsheetUrl` (omitted entirely for a non-admin, enforced server-side in
  // `H_Meta_whoami`). "Admin tools" and "Open spreadsheet" render only when `isAdmin` is true,
  // and the spreadsheet link only when `spreadsheetUrl` is actually present — never a disabled
  // control, per the design: an admin-only link that simply isn't there for anyone else.
  function renderNav(principal, activePage) {
    var host = document.getElementById('ndocs-nav');
    if (!host) return;
    host.textContent = '';
    if (!principal) return;

    function navLink(href, text, key) {
      var attrs = { href: href, text: text };
      if (activePage && key === activePage) attrs['aria-current'] = 'page';
      return el('a', attrs);
    }

    host.appendChild(navLink('catalog.html', 'Catalog', 'catalog'));

    var teams = principal.teams || [];
    if (teams.length) {
      var summary = el('summary', { text: 'Teams' });
      var popover = el('div', { class: 'nav-popover' });
      teams.forEach(function (t) {
        // No role suffix — every team member carries the same permissions (2026-09-14
        // decision, ADR-0003 amended).
        popover.appendChild(el('a', { href: 'team.html?team=' + encodeURIComponent(t.teamId), text: t.name }));
      });
      var menu = el('details', { class: 'nav-menu' }, [summary, popover]);
      if (activePage === 'team') menu.classList.add('is-current');
      host.appendChild(menu);
    }

    if (principal.isAdmin) {
      host.appendChild(navLink('tools.html', 'Admin tools', 'tools'));
      if (principal.spreadsheetUrl) {
        host.appendChild(el('a', {
          href: principal.spreadsheetUrl, target: '_blank', rel: 'noopener',
          'aria-label': 'Open spreadsheet in a new tab', text: 'Open spreadsheet ↗'
        }));
      }
    }
  }

  return {
    escapeHtml: escapeHtml,
    el: el,
    toast: toast,
    setBusy: setBusy,
    announce: announce,
    confirm: confirm,
    // confirmDialog(message) — the pre-NDocs-st4 window.confirm shim. Left unchanged:
    // app/page-resource.js's retire path still calls it with a single string, and rebuilding
    // that call site onto the new confirm(spec) dialog is Stage 15.6's job (resource.html
    // itself is out of scope this stage — CLAUDE.md/task "don't touch beyond keeping it
    // working"). New callers use `confirm(spec)` above.
    confirmDialog: function (message) {
      return Promise.resolve(window.confirm(message)); // eslint-disable-line no-alert
    },
    renderNav: renderNav
  };
})();
