/**
 * tests/ui/tournament.test.mjs — the unified Tournament screen + nav.
 *
 * The former Standings + Bracket screens are folded into one "Tournament" nav
 * item with two sub-tabs (Group Stage / Playoffs). This suite asserts: the nav
 * carries a single Tournament item (no standalone Standings/Bracket), the router
 * maps the `tournament` route, both sub-views render correctly from the one
 * screen, the active sub-tab tracks the `view` route param, the legacy
 * deep-link command lands on the Tournament view, and the nav highlight surfaces
 * Tournament for the contextual + legacy route ids. Headless via toHtml.
 */

import { assert } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason, openEvent } from '../../src/state/commands.js';
import { TournamentScreen } from '../../src/ui/screens/Tournament.js';
import { Sidebar, NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { ROUTES, RouterOutlet } from '../../src/ui/router.js';
import { StandingsScreen } from '../../src/ui/screens/Standings.js';
import { BracketScreen } from '../../src/ui/screens/Bracket.js';
import { navigate } from '../../src/state/actions.js';

/** Pull the active sidebar button's markup (up to its closing tag). */
function activeNavButton(html) {
  const m = html.match(/class="sidebar__item sidebar__item--active"[\s\S]*?<\/button>/);
  return m ? m[0] : '';
}

export default async function run() {
  /* ---- nav: ONE Tournament item, no standalone Standings/Bracket ---- */
  const ids = NAV_ITEMS.map((i) => i.screen);
  assert(ids.filter((s) => s === 'tournament').length === 1, 'exactly one Tournament nav item');
  assert(!ids.includes('standings'), 'no standalone Standings nav item');
  assert(!ids.includes('bracket'), 'no standalone Bracket nav item');
  const tItem = NAV_ITEMS.find((i) => i.screen === 'tournament');
  assert(tItem && tItem.label === 'Tournament', 'the unified item is labeled "Tournament"');

  /* ---- router: the tournament route resolves; legacy ids still registered ---- */
  assert(ROUTES.tournament === TournamentScreen, 'router maps tournament -> TournamentScreen');
  assert(ROUTES.standings === StandingsScreen, 'legacy standings route still resolves');
  assert(ROUTES.bracket === BracketScreen, 'legacy bracket route still resolves');

  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const st = () => store.getState();

  /* ---- empty state: no event played yet ---- */
  const empty = toHtml(TournamentScreen(st(), store.dispatch, store));
  assert(empty.includes('No event has been played'), 'empty Tournament prompts to play an event');

  // Play the Kickoff (4 regions) + Masters One (international Swiss + double-elim).
  continueSeason(store, { simEvent: true });
  continueSeason(store, { simEvent: true });

  /* ---- Group Stage sub-tab (default view) ---- */
  store.dispatch(navigate('tournament', { eventId: 'm0' }));
  const groups = toHtml(TournamentScreen(st(), store.dispatch, store));
  assert(groups.includes('tournament__tabs'), 'Tournament renders the sub-tab bar');
  assert(groups.includes('Group Stage') && groups.includes('Playoffs'), 'both sub-tabs are present');
  assert(groups.includes('>Swiss<'), 'default view shows the Masters Swiss group standings');
  assert(groups.includes('class="table placements"'), 'default view shows the final placements');
  assert(
    /tournament__tab--active[\s\S]*?Group Stage/.test(groups),
    'Group Stage tab is active by default'
  );

  // A regional Kickoff shows its Group A/B in the same default view.
  store.dispatch(navigate('tournament', { eventId: 'kickoff-emea' }));
  const emea = toHtml(TournamentScreen(st(), store.dispatch, store));
  assert(emea.includes('Group A') && emea.includes('Group B'), 'EMEA Kickoff shows Group A/B');

  /* ---- Playoffs sub-tab ---- */
  store.dispatch(navigate('tournament', { eventId: 'm0', view: 'bracket' }));
  const bracket = toHtml(TournamentScreen(st(), store.dispatch, store));
  assert(bracket.includes('>Winners<') && bracket.includes('>Losers<'), 'Playoffs view shows the double-elim');
  assert(bracket.includes('bracket__legend'), 'Playoffs view shows the format legend');
  assert(
    /tournament__tab--active[\s\S]*?Playoffs/.test(bracket),
    'Playoffs tab is active when view=bracket'
  );
  // The standings markup is NOT in the bracket view (only one body renders).
  assert(!bracket.includes('class="table placements"'), 'bracket view does not render placements');

  /* ---- routed through RouterOutlet end-to-end ---- */
  store.dispatch(navigate('tournament', { eventId: 'kickoff-pacific', view: 'bracket' }));
  const routed = toHtml(RouterOutlet(st(), store.dispatch, store));
  assert(routed.includes('Triple-elimination'), 'RouterOutlet renders the Tournament playoff view');

  /* ---- legacy deep-link command lands on the Tournament view ---- */
  openEvent(store, 'kickoff', 'china');
  assert(st().ui.route.screen === 'tournament', 'openEvent navigates to the tournament route');
  assert(st().ui.route.params.view === 'standings', 'openEvent defaults to the group-stage sub-tab');
  assert(st().ui.route.params.eventId === 'kickoff-china', 'openEvent threads the eventId');

  /* ---- nav highlight: contextual + legacy route ids surface Tournament ---- */
  for (const screen of ['tournament', 'team', 'player', 'match', 'standings', 'bracket']) {
    const html = toHtml(Sidebar({ route: { screen }, onNavigate: () => {} }));
    assert(
      (html.match(/sidebar__item--active/g) || []).length === 1,
      `exactly one nav item is active for route '${screen}'`
    );
    assert(
      activeNavButton(html).includes('Tournament'),
      `route '${screen}' highlights the Tournament nav item`
    );
  }
}
