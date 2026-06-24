/**
 * tests/ui/screen-awards.test.mjs — P7a Awards screen + integration
 * (CONTRACTS-POLISH §1).
 *
 * Headless via toHtml. Drives the real store through a full season, checks the
 * live awards selector + screen, then resolves the off-season and confirms the
 * archived SeasonSummary carries its awards (history) and the past-seasons roll
 * renders. Also checks the router/sidebar wiring.
 */

import { assert, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { navigate } from '../../src/state/actions.js';
import { Awards } from '../../src/ui/screens/Awards.js';
import { RouterOutlet } from '../../src/ui/router.js';
import { NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import {
  selectSeasonAwards,
  selectSeason,
  selectCareerHistory
} from '../../src/state/selectors.js';

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });

  section('Awards — empty before any play');
  let html = toHtml(Awards(store.getState(), store.dispatch));
  assert(html.includes('screen--awards'), 'awards screen renders');
  assert(html.includes('populate as the season is played'), 'pre-season empty state shown');
  assert(html.includes('No completed seasons'), 'no past seasons yet');

  section('Awards — play a full season; awards populate live');
  let guard = 0;
  while (!selectSeason(store.getState()).complete && guard++ < 20) continueSeason(store, { simEvent: true });
  const awards = selectSeasonAwards(store.getState());
  assert(awards && awards.mvp, 'a completed season has a live MVP');
  assert(awards.allProFirst.length === 5 && awards.allProSecond.length === 5, 'both All-Pro teams filled');
  html = toHtml(Awards(store.getState(), store.dispatch));
  assert(html.includes('Season MVP') && html.includes('Finals MVP') && html.includes('Rookie of the Year'), 'headline award cards present');
  assert(html.includes('All-Pro First Team') && html.includes('All-Pro Second Team') && html.includes('Regional MVPs'), 'team + region panels present');
  assert(html.includes(awards.mvp.handle), 'MVP name rendered');
  // no unrounded floats leak into the markup (acs is rounded to 2dp; rating is internal)
  assert(!/\d\.\d{4,}/.test(html), 'awards view renders no unrounded float numbers');

  section('Awards — carried into history after the off-season');
  continueSeason(store, { simEvent: true }); // resolve off-season -> season 1; archives season 0 summary
  const history = selectCareerHistory(store.getState());
  assert(history.length >= 1, 'a season was archived to history');
  assert(history[0].awards && history[0].awards.mvp, 'archived summary carries an awards block');
  html = toHtml(Awards(store.getState(), store.dispatch));
  assert(html.includes('Past Seasons') && html.includes('Season 1'), 'past-seasons roll shows the prior year');

  section('router + sidebar wiring');
  store.dispatch(navigate('awards'));
  assert(toHtml(RouterOutlet(store.getState(), store.dispatch, store)).includes('screen--awards'), 'router routes to Awards');
  assert(NAV_ITEMS.some((i) => i.screen === 'awards'), 'sidebar exposes an Awards nav item');
}
