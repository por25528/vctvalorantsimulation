/**
 * tests/ui/screen-transfer-window.test.mjs — the spectator Transfer Window board.
 *
 * Headless via toHtml. Steps a fresh career through its first full season into the
 * off-season, then asserts: (1) the AI war-chest market actually SPENDS (the window
 * has fee-paying transfers), (2) selectTransferWindow aggregates deals / per-club
 * spend / money leaders coherently with money conserved, and (3) the Offseason
 * screen + router render the board. Also checks the sidebar wiring.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { Offseason } from '../../src/ui/screens/Offseason.js';
import { RouterOutlet } from '../../src/ui/router.js';
import { NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { navigate } from '../../src/state/actions.js';
import { selectOffseasonReport, selectTransferWindow } from '../../src/state/selectors.js';

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });

  section('step the career into its first off-season (AI market runs)');
  // Reveal each slot in one Continue; once a season completes a further Continue
  // resolves the off-season and an OffseasonReport appears.
  let guard = 0;
  while (!selectOffseasonReport(store.getState()) && guard < 40) {
    continueSeason(store, { simEvent: true });
    guard += 1;
  }
  const report = selectOffseasonReport(store.getState());
  assert(report, 'an off-season ran and produced a report');

  section('selectTransferWindow — coherent league-wide aggregation');
  const w = selectTransferWindow(store.getState());
  assert(w, 'transfer-window aggregate is present');
  assert(Array.isArray(w.deals) && Array.isArray(w.byClub) && Array.isArray(w.moneyLeaders), 'deals / byClub / moneyLeaders are arrays');
  assertEqual(w.count, w.deals.length, 'count matches the number of fee deals');

  // The headline fix: the AI deploys its war chest, so the first window is NOT empty.
  assert(w.count >= 1, `the AI market made at least one fee-paying transfer (got ${w.count})`);
  assert(w.totalFees > 0, 'total fees moved is positive');

  // Deals are sorted priciest-first and the summary's biggest matches.
  for (let i = 1; i < w.deals.length; i += 1) {
    assert(w.deals[i - 1].fee >= w.deals[i].fee, 'deals are sorted by fee descending');
  }
  if (w.biggest) assertEqual(w.biggest.fee, w.deals[0].fee, 'biggest deal == the top of the sorted list');

  // Money is conserved across the per-club spend board (fees only move buyer->seller).
  let spent = 0;
  let received = 0;
  for (const c of w.byClub) { spent += c.spent; received += c.received; }
  assertEqual(spent, received, 'fees conserve: total spent == total received across clubs');
  assertEqual(spent, w.totalFees, 'club-board spend totals the window fees');

  // Money leaders are sorted by budget descending and cover the whole league.
  assertEqual(w.moneyLeaders.length, Object.keys(store.getState().world.teams).length, 'money leaders cover every club');
  for (let i = 1; i < w.moneyLeaders.length; i += 1) {
    assert(w.moneyLeaders[i - 1].budget >= w.moneyLeaders[i].budget, 'money leaders sorted by budget descending');
  }

  section('Offseason screen renders the Transfer Window board (headless)');
  const html = toHtml(Offseason(store.getState(), store.dispatch, store));
  assert(html.includes('Transfer Window'), 'screen titled Transfer Window');
  assert(html.includes('Headline Deals'), 'headline-deals panel rendered');
  assert(html.includes('Club Spending'), 'club-spending panel rendered');
  assert(html.includes('Money Leaders'), 'money-leaders panel rendered');
  assert(!/\d\.\d{4,}/.test(html), 'no raw long floats leak into the view');

  section('router + sidebar wiring');
  store.dispatch(navigate('offseason'));
  const routed = toHtml(RouterOutlet(store.getState(), store.dispatch, store));
  assert(routed.includes('Transfer Window'), 'router resolves the offseason route to the board');
  assert(NAV_ITEMS.some((n) => n.screen === 'offseason'), 'sidebar has a Transfer Window nav item');
}
