// app/shell.js — the one application shell (ADR-0012, NDocs-3il). Every rebuilt page calls
// `NDocsShell.mount(opts)` once; this module owns the skip link, header (brand + nav slot +
// user label), footer (build/env + sign out), and the sign-in -> launch -> app-view
// progression that used to be copied, with drift, into every page's own markup. It also owns
// `region(el, state, opts)`, the one place the five async states
// (loading/populated/empty/error/permission-denied) are rendered, so a JS-populated container
// can never ship a blank first paint by omission (docs/interfaces/ux-components.md
// "Async surface states").
//
// What stays page-local: the page's own <main> content (hero, search shell, results, forms —
// "page content" in the contract's shell diagram) and the page controller that fetches data
// into it. Shell renders the chrome AROUND that content and the three states that gate whether
// it is visible at all.
var NDocsShell = (function () {
  'use strict';

  var ui = NDocsUI;
  var el = ui.el;

  var refs = {};
  var opened = null; // control that opened the current dialog, for focus return

  function buildSkipLink() {
    return el('a', { class: 'skip-link', href: '#main', text: 'Skip to main content' });
  }

  function buildHeader() {
    var nav = el('nav', { id: 'ndocs-nav', class: 'primary-nav', 'aria-label': 'Primary' });
    var userLabel = el('span', { id: 'ndocs-user-label', class: 'user-label' });
    var header = el('header', { class: 'site-header' }, [
      el('div', { class: 'header-inner' }, [
        el('a', { class: 'brand', href: 'index.html', text: 'NDocs' }),
        nav,
        userLabel
      ])
    ]);
    refs.nav = nav;
    refs.userLabel = userLabel;
    return header;
  }

  function buildFooter() {
    var buildInfo = el('span', { id: 'ndocs-build-info' });
    var signOut = el('button', {
      id: 'ndocs-sign-out', type: 'button', class: 'button button--quiet hidden', text: 'Sign out'
    });
    var footer = el('footer', { class: 'site-footer' }, [
      el('div', { class: 'footer-inner' }, [buildInfo, signOut])
    ]);
    refs.buildInfo = buildInfo;
    refs.signOut = signOut;
    return footer;
  }

  // Sign-in / launch / error / app-view scaffolding — previously duplicated verbatim in
  // index.html, catalog.html, resource.html, team.html, and tools.html.
  function buildSignInView(opts) {
    var gisHost = el('div', { id: 'g_id_onload', 'data-callback': 'NDocsShellOnGoogleSignIn', 'data-auto_select': 'false' });
    var gisButton = el('div', { class: 'g_id_signin', 'data-type': 'standard', 'data-shape': 'pill' });
    var section = el('section', { id: 'ndocs-view-signin', class: 'surface surface--elevated' }, [
      el('div', { class: 'section-kicker', text: 'Access NDocs' }),
      el('h2', { class: 'section-title', text: 'Sign in' }),
      el('p', { text: 'Use your Google account to see the catalog and the teams you can access.' }),
      gisHost,
      gisButton
    ]);
    if (opts.gisClientId && opts.gisClientId.indexOf('.apps.googleusercontent.com') !== -1) {
      gisHost.setAttribute('data-client_id', opts.gisClientId);
    }
    return section;
  }

  function buildLaunchView() {
    return el('section', { id: 'ndocs-view-launch', class: 'surface hidden' }, [
      el('strong', { role: 'status', text: 'Signing you in…' })
    ]);
  }

  function buildErrorBanner() {
    return el('div', { id: 'ndocs-error-banner', class: 'status-panel status-panel--danger hidden', role: 'alert' });
  }

  function showView(view) {
    ['signin', 'launch', 'app'].forEach(function (name) {
      var node = refs['view_' + name];
      if (node) node.classList.toggle('hidden', name !== view);
    });
    if (refs.signOut) refs.signOut.classList.toggle('hidden', view !== 'app');
    if (refs.userLabel) refs.userLabel.textContent = view === 'app' ? (refs.userLabelText || '') : '';
  }

  function showError(message) {
    var banner = refs.errorBanner;
    if (!banner) return;
    banner.textContent = '';
    banner.appendChild(el('strong', { text: 'Something went wrong' }));
    banner.appendChild(el('p', { text: message }));
    banner.classList.remove('hidden');
  }

  function clearError() {
    if (refs.errorBanner) refs.errorBanner.classList.add('hidden');
  }

  // region(container, state, opts) — the five async states. `opts.node` supplies the
  // populated content; every other state is rendered from shared markup so no page invents
  // its own loading/empty/error/permission-denied treatment.
  function region(container, state, opts) {
    if (!container) return;
    opts = opts || {};
    container.textContent = '';
    container.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    switch (state) {
      case 'loading':
        container.appendChild(el('p', { class: 'region-loading', role: 'status', text: opts.loadingText || 'Loading…' }));
        break;
      case 'populated':
        if (opts.node) container.appendChild(opts.node);
        break;
      case 'empty':
        container.appendChild(buildEmptyState(opts));
        break;
      case 'error':
        container.appendChild(buildErrorState(opts));
        break;
      case 'permission-denied':
        container.appendChild(el('p', {
          class: 'region-permission',
          text: opts.message || 'You do not have access to this.'
        }));
        break;
      default:
        throw new Error('NDocsShell.region: unknown state "' + state + '"');
    }
  }

  function buildEmptyState(opts) {
    var box = el('div', { class: 'empty-state' });
    box.appendChild(el('p', { text: opts.message || 'Nothing here yet.' }));
    if (opts.actionLabel && opts.actionHref) {
      box.appendChild(el('a', { class: 'button', href: opts.actionHref, text: opts.actionLabel }));
    } else if (opts.actionLabel && typeof opts.onAction === 'function') {
      var btn = el('button', { type: 'button', class: 'button', text: opts.actionLabel });
      btn.addEventListener('click', opts.onAction);
      box.appendChild(btn);
    }
    return box;
  }

  function buildErrorState(opts) {
    var box = el('div', { class: 'region-error', role: 'alert' });
    box.appendChild(el('p', { text: opts.message || 'Something went wrong loading this.' }));
    if (typeof opts.onRetry === 'function') {
      var btn = el('button', { type: 'button', class: 'button', text: 'Retry' });
      btn.addEventListener('click', opts.onRetry);
      box.appendChild(btn);
    }
    return box;
  }

  // mount(opts) — opts:
  //   activePage: string matching a nav entry, for aria-current
  //   pageContent: the <main> element already in the page's own markup (hidden until signed in)
  //   onEnter(): called once a session exists (fresh sign-in or resumed) and the app view is
  //     showing. Returns a Promise; a rejection is shown via showError and the page reverts to
  //     sign-in when the failure is `NotAuthorized`.
  function mount(opts) {
    opts = opts || {};
    document.body.insertBefore(buildSkipLink(), document.body.firstChild);
    document.body.insertBefore(buildHeader(), document.body.firstChild.nextSibling);

    // `main` is the single, permanent skip-link target (id="main") for the whole page
    // lifetime; it doubles as the "app view" — shown/hidden by `showView`, never re-tagged —
    // so the skip link never points at a view that has been hidden or renamed.
    var main = opts.pageContent || document.getElementById('main');
    if (main) {
      main.id = 'main';
      main.classList.add('container');
      main.setAttribute('tabindex', '-1');
    }

    var errorBanner = buildErrorBanner();
    var signinView = buildSignInView({ gisClientId: (window.NDOCS_CONFIG || NDOCS_CONFIG).GIS_CLIENT_ID });
    var launchView = buildLaunchView();

    if (main && main.parentNode) {
      main.parentNode.insertBefore(errorBanner, main);
      main.parentNode.insertBefore(signinView, main);
      main.parentNode.insertBefore(launchView, main);
    } else {
      document.body.appendChild(errorBanner);
      document.body.appendChild(signinView);
      document.body.appendChild(launchView);
    }

    refs.errorBanner = errorBanner;
    refs.view_signin = signinView;
    refs.view_launch = launchView;
    refs.view_app = main;

    document.body.appendChild(buildFooter());

    refs.buildInfo.textContent = 'Build ' + (NDOCS_CONFIG.VERSION || '?') + ' · ' + (NDOCS_CONFIG.ENV || '?');
    refs.signOut.addEventListener('click', function () {
      NDocsSession.signOut();
      clearError();
      showView('signin');
    });

    window.NDocsShellOnGoogleSignIn = function (credentialResponse) {
      clearError();
      showView('launch');
      NDocsSession.signIn(credentialResponse && credentialResponse.credential)
        .then(function () { return enter(opts); })
        .catch(function (err) {
          showView('signin');
          showError((err && err.message) || String(err));
        });
    };

    if (NDocsSession.resume()) {
      enter(opts);
    } else {
      showView('signin');
    }
  }

  function enter(opts) {
    showView('app');
    clearError();
    var principal = NDocsSession.principal();
    refs.userLabelText = NDocsSession.email() || '';
    if (refs.userLabel) refs.userLabel.textContent = refs.userLabelText;
    if (typeof opts.onEnter !== 'function') return Promise.resolve();
    return opts.onEnter().then(function (principal) {
      if (principal) {
        refs.userLabelText = principal.email || refs.userLabelText;
        if (refs.userLabel) refs.userLabel.textContent = refs.userLabelText;
        ui.renderNav(principal, opts.activePage);
      }
    }).catch(function (err) {
      if (err && err.name === 'NotAuthorized') {
        NDocsSession.signOut();
        showView('signin');
        showError('Your saved sign-in is no longer accepted. Please sign in again.');
        return;
      }
      showError((err && err.message) || String(err));
    });
  }

  return {
    mount: mount,
    region: region,
    showError: showError,
    clearError: clearError
  };
})();
