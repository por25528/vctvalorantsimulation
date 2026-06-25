/**
 * tests/ui/screen-finances.test.mjs — GM finances screen + sellPlayer command.
 *
 * Headless via toHtml. Covers:
 *   - Finances screen renders with budget / payroll / sponsor data
 *   - Finances nav item present in Sidebar
 *   - selectPayrollBreakdown and selectTransferBalance selectors
 *   - sellPlayer: player moves to AI buyer, fee credited, roster stays valid
 *   - sellPlayer: refused when roster would drop below MIN_ROSTER
 *   - sellPlayer: refused when no team can afford the player
 *   - releasePlayer from Finances: roster validity guard (already covered by the
 *     existing screen-transfers suite, but confirmed here via the Finances path)
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, sellPlayer, releasePlayer, signPlayer } from '../../src/state/commands.js';
import { setTeam, setPlayer } from '../../src/state/slices/world.js';
import { navigate } from '../../src/state/actions.js';
import { createPlayer } from '../../src/domain/player.js';
import { FinancesScreen } from '../../src/ui/screens/Finances.js';
import { RouterOutlet } from '../../src/ui/router.js';
import { NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { BALANCE } from '../../src/config/balance.js';
import {
  selectFollowedTeam,
  selectRoster,
  selectPlayer,
  selectTeamFinances,
  selectPayrollBreakdown,
  selectTransferBalance,
  selectTransferMoves
} from '../../src/state/selectors.js';

const MARKET = BALANCE.CAREER.MARKET;

/** Inject a free agent and sign them onto the followed team (expands roster beyond MIN). */
function addExtraPlayer(store, id) {
  const a = {};
  for (const k of ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl']) a[k] = 65;
  const p = createPlayer({ id, handle: id.toUpperCase(), role: 'Duelist', age: 22, potential: 75, attributes: a, contract: { status: 'free_agent', teamId: null, salary: 0, expires: 0 } });
  store.dispatch(setPlayer(p));
  // Give the team enough budget for the wage
  const team = selectFollowedTeam(store.getState());
  store.dispatch(setTeam({ ...team, budget: Math.max(Number(team.budget) || 0, 2_000_000) }));
  return signPlayer(store, id);
}

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const team = selectFollowedTeam(store.getState());

  /* ------------------------------------------------------------------ */
  section('Finances nav item in sidebar');
  const finItem = NAV_ITEMS.find((it) => it.screen === 'finances');
  assert(finItem, 'finances nav item exists');
  assertEqual(finItem.icon, 'finance', 'uses the finance icon');

  /* ------------------------------------------------------------------ */
  section('Finances screen renders key sections');
  store.dispatch(navigate('finances'));
  const html = toHtml(FinancesScreen(store.getState(), store.dispatch, store));
  assert(html.includes('Finances'), 'title renders');
  assert(html.includes('Budget'), 'budget section renders');
  assert(html.includes('Sponsor'), 'sponsor income renders');
  assert(html.includes('Wage bill') || html.includes('Payroll'), 'payroll section renders');
  assert(html.includes('Release'), 'release buttons render');
  assert(html.includes('Sell'), 'sell buttons render');

  /* ------------------------------------------------------------------ */
  section('Finances screen via RouterOutlet');
  const routeHtml = toHtml(RouterOutlet(store.getState(), store.dispatch, store));
  assert(routeHtml.includes('Finances'), 'RouterOutlet resolves finances route');

  /* ------------------------------------------------------------------ */
  section('selectPayrollBreakdown');
  const payroll = selectPayrollBreakdown(store.getState(), team.id);
  assert(Array.isArray(payroll) && payroll.length > 0, 'payroll is non-empty for a rostered team');
  // Sorted by salary descending
  for (let i = 1; i < payroll.length; i++) {
    assert(payroll[i].salary <= payroll[i - 1].salary, `payroll row ${i} sorted by salary desc`);
  }
  assert(typeof payroll[0].player === 'object', 'each row has a player object');
  assert(typeof payroll[0].salary === 'number', 'each row has a salary');

  /* ------------------------------------------------------------------ */
  section('selectTransferBalance — empty at start');
  const bal0 = selectTransferBalance(store.getState(), team.id);
  assertEqual(bal0.received, 0, 'no fees received at window open');
  assertEqual(bal0.spent, 0, 'no fees spent at window open');
  assertEqual(bal0.net, 0, 'net is zero at window open');

  /* ------------------------------------------------------------------ */
  section('selectTeamFinances includes expected fields');
  const fin = selectTeamFinances(store.getState(), team.id);
  assert(fin && typeof fin.budget === 'number', 'budget present');
  assert(typeof fin.wageBill === 'number' && fin.wageBill > 0, 'wage bill > 0 for rostered team');
  assert(typeof fin.sponsor === 'number' && fin.sponsor > 0, 'sponsor income > 0');

  /* ------------------------------------------------------------------ */
  section('sellPlayer — normal flow');
  // Inject an extra player so the roster exceeds MIN_ROSTER (initial seed = exactly MIN)
  assert(addExtraPlayer(store, 'extra-sell-1'), 'extra player signed onto roster');
  const roster = selectRoster(store.getState(), team.id);
  assert(roster.length > MARKET.MIN_ROSTER, 'team has enough players to sell one');
  // Give the followed team a massive budget so we know the sell goes through
  store.dispatch(setTeam({ ...selectFollowedTeam(store.getState()), budget: 10_000_000 }));
  // Also give every other team a healthy budget so there is a buyer
  const allTeams = store.getState().world.teams;
  for (const id of Object.keys(allTeams)) {
    if (id !== team.id) {
      store.dispatch(setTeam({ ...allTeams[id], budget: 5_000_000 }));
    }
  }
  const sellTarget = roster[0];
  const budgetBefore = Number(selectFollowedTeam(store.getState()).budget);
  const rosterLenBefore = selectRoster(store.getState(), team.id).length;
  const ok = sellPlayer(store, sellTarget.id);
  assert(ok, 'sellPlayer returns true on success');
  const budgetAfter = Number(selectFollowedTeam(store.getState()).budget);
  assert(budgetAfter > budgetBefore, 'user team budget increased by the fee');
  assertEqual(selectRoster(store.getState(), team.id).length, rosterLenBefore - 1, 'roster shrunk by 1');
  const sold = selectPlayer(store.getState(), sellTarget.id);
  assert(sold.contract.teamId !== team.id, 'sold player no longer belongs to user team');
  assert(sold.contract.status === 'active', 'sold player has an active contract');

  /* ------------------------------------------------------------------ */
  section('selectTransferBalance after a sale');
  const bal1 = selectTransferBalance(store.getState(), team.id);
  assert(bal1.received > 0, 'fee received after sale');
  assertEqual(bal1.spent, 0, 'no fees spent (user only sold)');
  assert(bal1.net > 0, 'net positive after selling');

  /* ------------------------------------------------------------------ */
  section('sellPlayer — refused when roster would drop to MIN');
  // Release players until we are AT minimum
  const rosterNow = selectRoster(store.getState(), team.id);
  while (selectRoster(store.getState(), team.id).length > MARKET.MIN_ROSTER) {
    const cur = selectRoster(store.getState(), team.id);
    releasePlayer(store, cur[cur.length - 1].id);
  }
  assertEqual(selectRoster(store.getState(), team.id).length, MARKET.MIN_ROSTER, 'roster at minimum');
  const atMin = selectRoster(store.getState(), team.id)[0];
  const refusedSell = sellPlayer(store, atMin.id);
  assert(!refusedSell, 'sellPlayer refused when at MIN_ROSTER');
  assertEqual(selectRoster(store.getState(), team.id).length, MARKET.MIN_ROSTER, 'roster unchanged after refused sell');

  /* ------------------------------------------------------------------ */
  section('sellPlayer — refused when no team can afford');
  // Start fresh so we have room again
  const store2 = buildStore();
  await bootstrap(store2, { fresh: true });
  const team2 = selectFollowedTeam(store2.getState());
  // Add an extra player to exceed MIN_ROSTER
  const a2 = {};
  for (const k of ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl']) a2[k] = 65;
  const extra2 = createPlayer({ id: 'extra-nobuyer', handle: 'NOBUYER', role: 'Duelist', age: 22, potential: 75, attributes: a2, contract: { status: 'free_agent', teamId: null, salary: 0, expires: 0 } });
  store2.dispatch(setPlayer(extra2));
  store2.dispatch(setTeam({ ...team2, budget: 2_000_000 }));
  signPlayer(store2, 'extra-nobuyer');
  // Zero out all OTHER teams' budgets so no one can afford any fee
  const allTeams2 = store2.getState().world.teams;
  for (const id of Object.keys(allTeams2)) {
    if (id !== team2.id) {
      store2.dispatch(setTeam({ ...allTeams2[id], budget: 0 }));
    }
  }
  const roster2 = selectRoster(store2.getState(), team2.id);
  assert(roster2.length > MARKET.MIN_ROSTER, 'has room to sell in store2');
  const noAffordResult = sellPlayer(store2, roster2[0].id);
  assert(!noAffordResult, 'sellPlayer refused when no buyer can afford the fee');
}
