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

  return {
    escapeHtml: escapeHtml,
    el: el,
    toast: toast,
    setBusy: setBusy,
    confirmDialog: confirmDialog
  };
})();
