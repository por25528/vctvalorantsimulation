/**
 * tests/ui/screen-transfers-p13.test.mjs — P13 user-facing transfer depth:
 * the coach panel + hire/dismiss, the buy-targets panel + buying a contracted
 * player (fee + seller refill), and the reputation/pull badges. Headless via toHtml.
 */

import { assert, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, buyPlayer, hireCoach, fireCoach } from '../../src/state/commands.js';
import { setPlayer, setTeam } from '../../src/state/slices/world.js';
import { createPlayer } from '../../src/domain/player.js';
import { TransferMarket } from '../../src/ui/screens/TransferMarket.js';
import { selectFollowedTeam, selectRoster, selectTeam, selectPlayer, selectBuyTargets } from '../../src/state/selectors.js';

function freeAgent(id) {
  const a = {};
  for (const k of ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl']) a[k] = 70;
  return createPlayer({ id, handle: id.toUpperCase(), role: 'Duelist', age: 22, potential: 78, attributes: a, contract: { status: 'free_agent', teamId: null } });
}

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const team = selectFollowedTeam(store.getState());

  section('TransferMarket renders the P13 panels & badges');
  const html = toHtml(TransferMarket(store.getState(), store.dispatch, store));
  assert(html.includes('Head Coach'), 'coach panel renders');
  assert(html.includes('Transfer Targets'), 'buy-targets panel renders');
  assert(html.includes('Reputation') && html.includes('Pull'), 'reputation & pull badges render');

  section('every club is seeded with a head coach');
  assert(team.coach && typeof team.coach.negotiation === 'number', 'the followed club has a coach with a negotiation rating');

  section('hire / dismiss a coach');
  assert(fireCoach(store), 'dismiss succeeds');
  assert(!selectFollowedTeam(store.getState()).coach, 'the club is now coachless');
  assert(hireCoach(store), 'hire succeeds');
  const newCoach = selectFollowedTeam(store.getState()).coach;
  assert(newCoach && newCoach.rating >= 0 && newCoach.negotiation >= 0, 'a new coach was hired with ratings');

  section('selectBuyTargets — contracted players at other clubs, with fees');
  const targets = selectBuyTargets(store.getState(), team.id, 10);
  assert(targets.length > 0, 'there are contracted players to bid for');
  assert(targets[0].fee > 0 && targets[0].seller.id !== team.id, 'a target carries a fee and belongs to another club');

  section('buyPlayer — buy a contracted star (fee paid, seller refilled, rosters valid)');
  // Season 0 has no free agents, so inject one the seller can refill with.
  store.dispatch(setPlayer(freeAgent('refill-fa')));
  // Make the club rich enough to afford any fee.
  store.dispatch(setTeam({ ...selectFollowedTeam(store.getState()), budget: 50000000 }));
  const target = selectBuyTargets(store.getState(), team.id, 10)[0];
  const sellerId = target.seller.id;
  const sellerBudgetBefore = selectTeam(store.getState(), sellerId).budget;
  const userRosterBefore = selectRoster(store.getState(), team.id).length;

  const ok = buyPlayer(store, target.player.id);
  assert(ok, 'the buy went through');
  assert(selectPlayer(store.getState(), target.player.id).contract.teamId === team.id, 'the bought player now belongs to the user club');
  assert(selectRoster(store.getState(), team.id).length === userRosterBefore + 1, 'the bought player joined the bench');
  assert(selectTeam(store.getState(), sellerId).roster.length === 5, 'the selling club refilled to a valid five');
  assert(!selectTeam(store.getState(), sellerId).roster.includes(target.player.id), 'the player left the selling club');
  assert(selectTeam(store.getState(), sellerId).budget > sellerBudgetBefore, 'the seller banked the fee');
}
