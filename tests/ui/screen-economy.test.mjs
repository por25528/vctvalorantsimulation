/**
 * tests/ui/screen-economy.test.mjs — P7e economy UI + budget gate (CONTRACTS-POLISH P7e).
 *
 * Headless via toHtml. Checks the Finances panel on the Market screen, the
 * selectTeamFinances selector, and the budget gate on signPlayer (a broke club
 * can't afford a wage; a rich club can).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, signPlayer } from '../../src/state/commands.js';
import { setPlayer, setTeam } from '../../src/state/slices/world.js';
import { createPlayer } from '../../src/domain/player.js';
import { salaryFor } from '../../src/engine/career/offseason/contracts.js';
import { TransferMarket } from '../../src/ui/screens/TransferMarket.js';
import { selectFollowedTeam, selectRoster, selectTeamFinances, selectPlayer } from '../../src/state/selectors.js';

/** A strong, expensive free agent. */
function richFreeAgent(id) {
  const a = {};
  for (const k of ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl']) a[k] = 88;
  return createPlayer({ id, handle: id.toUpperCase(), role: 'Duelist', age: 22, potential: 92, attributes: a, contract: { status: 'free_agent', teamId: null } });
}

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const team = selectFollowedTeam(store.getState());

  section('selectTeamFinances + Finances panel render');
  const fin = selectTeamFinances(store.getState(), team.id);
  assert(fin && typeof fin.budget === 'number' && typeof fin.wageBill === 'number', 'finances computed');
  assert(fin.wageBill > 0, 'a rostered team has a wage bill');
  let html = toHtml(TransferMarket(store.getState(), store.dispatch, store));
  assert(html.includes('Finances') && html.includes('Budget') && html.includes('Wage bill') && html.includes('Projected net'), 'finances panel renders');

  section('budget gate — a broke club cannot afford a wage');
  store.dispatch(setPlayer(richFreeAgent('rfa')));
  const wage = salaryFor(selectPlayer(store.getState(), 'rfa'));
  assert(wage > 10000, 'the free agent commands a real wage');
  // make the club broke
  store.dispatch(setTeam({ ...selectFollowedTeam(store.getState()), budget: 10000 }));
  const before = selectRoster(store.getState(), team.id).length;
  assert(!signPlayer(store, 'rfa'), 'signing is refused when the wage exceeds the budget');
  assertEqual(selectRoster(store.getState(), team.id).length, before, 'roster unchanged on a refused signing');
  assertEqual(selectPlayer(store.getState(), 'rfa').contract.status, 'free_agent', 'the player stays a free agent');

  section('budget gate — a rich club can sign');
  store.dispatch(setTeam({ ...selectFollowedTeam(store.getState()), budget: 5000000 }));
  assert(signPlayer(store, 'rfa'), 'signing succeeds with ample budget');
  assertEqual(selectRoster(store.getState(), team.id).length, before + 1, 'roster grew');
  assertEqual(selectPlayer(store.getState(), 'rfa').contract.teamId, team.id, 'the player joined the club');
}
