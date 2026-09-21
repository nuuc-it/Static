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

  // `statsByTeamId` is `{ [teamId]: {catalogued, uncatalogued} }` from `list_team_stats`
  // (`NDocs-oml.5`) — a team absent from it (the stats call failed, or hasn't resolved yet)
  // renders no count line rather than a fabricated one; a real `0` is still shown once it
  // does resolve. Deliberately a second call, not part of `whoami`'s own `teams` array — see
  // `H_Meta_teamStats`'s header for the cost reasoning.
  function renderTeamTiles(teams, statsByTeamId) {
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
      var stats = statsByTeamId[t.teamId];
      var metaText = stats
        ? stats.catalogued + ' catalogued · ' + stats.uncatalogued + ' uncatalogued'
        : '—';
      frag.appendChild(ui.el('article', { class: 'team-tile' }, [
        ui.el('div', {}, [
          ui.el('strong', { text: t.name }),
          ui.el('div', { class: 'meta', text: metaText })
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
      var teams = principal.teams || [];
      var count = teams.length;
      ui.announce(count + ' team' + (count === 1 ? '' : 's') + ' loaded.');
      // Stats are fetched after the tiles' own membership list is known, but the tiles are
      // rendered either way — a stats failure degrades to the '—' placeholder above rather
      // than blocking the page (whoami already answered the question the page must show).
      NDocsTransport.call('list_team_stats', {}).then(function (stats) {
        var byId = {};
        (stats.teams || []).forEach(function (s) { byId[s.teamId] = s; });
        renderTeamTiles(teams, byId);
      }).catch(function () {
        renderTeamTiles(teams, {});
      });
      return principal;
    });
  }

  return { start: start };
})();
