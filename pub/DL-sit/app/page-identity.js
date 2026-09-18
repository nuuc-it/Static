// app/page-identity.js — index.html's controller (NDocs-utv). Stage 15.5 changes what
// index.html means: it stops being the search page (catalog.html has been that since
// Stage 6) and becomes the identity/entry surface — signed-in account, the caller's teams as
// tiles, "Open Catalog" as the one primary action. No raw team configuration
// (`configState`/`docIdPrefix`) is shown here to anyone, admin or not — that table is gone,
// per ux-components.md's page composition rule for index.html ("No separate admin table —
// admin reaches tools through shared nav").
var NDocsPageIdentity = (function () {
  'use strict';

  var ui = NDocsUI;

  function renderIdentityCard(principal) {
    var card = document.getElementById('ndocs-identity-card');
    card.textContent = '';
    var teamCount = (principal.teams || []).length;
    card.appendChild(ui.el('div', { class: 'button-row button-row--split' }, [
      ui.el('div', {}, [
        ui.el('div', { class: 'section-kicker', text: 'Signed in' }),
        ui.el('strong', { text: principal.email }),
        ui.el('div', {
          class: 'meta',
          text: (principal.isAdmin ? 'Administrator · ' : '') +
            'member of ' + teamCount + ' team' + (teamCount === 1 ? '' : 's')
        })
      ])
    ]));
  }

  function renderTeamTiles(teams) {
    var host = document.getElementById('ndocs-team-tiles');
    if (!teams.length) {
      NDocsShell.region(host, 'empty', {
        message: 'The backend reports no team membership for this account. That is the ' +
          'correct answer for someone who is not in any pilot team\'s Google Group.'
      });
      return;
    }
    var frag = document.createDocumentFragment();
    teams.forEach(function (t) {
      var folderCount = (t.folders || []).length;
      frag.appendChild(ui.el('article', { class: 'team-tile' }, [
        ui.el('div', {}, [
          ui.el('strong', { text: t.name }),
          ui.el('div', {
            class: 'meta',
            text: folderCount + ' tracked folder' + (folderCount === 1 ? '' : 's')
          })
        ]),
        ui.el('a', { class: 'button', href: 'team.html?team=' + encodeURIComponent(t.teamId), text: 'Open' })
      ]));
    });
    NDocsShell.region(host, 'populated', { node: frag });
  }

  function start() {
    var tiles = document.getElementById('ndocs-team-tiles');
    NDocsShell.region(tiles, 'loading', { loadingText: 'Loading your teams…' });
    return NDocsTransport.call('whoami', {}).then(function (principal) {
      NDocsSession.setPrincipal(principal);
      renderIdentityCard(principal);
      renderTeamTiles(principal.teams || []);
      var count = (principal.teams || []).length;
      ui.announce(count + ' team' + (count === 1 ? '' : 's') + ' loaded.');
      return principal;
    });
  }

  return { start: start };
})();
