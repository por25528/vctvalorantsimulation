/**
 * tests/ui/screen-transfers.test.mjs — read-only Market Watch + Player Development.
 *
 * Headless via toHtml. The god-observer rework removed every GM action
 * (sign/release/extend/lineup) — Market Watch is now a pure observation screen.
 * Covers: the transfers slice reducer (still wired), the read-only Market Watch
 * render (Roster + Free Agents, NO action controls), the Player Development
 * screen, router/sidebar wiring, and that the season still advances autonomously.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { navigate, recordTransfer, resetTransfers } from '../../src/state/actions.js';
import { setPlayer } from '../../src/state/slices/world.js';
import { transfersReducer, initialTransfersState } from '../../src/state/slices/transfers.js';
import { createPlayer } from '../../src/domain/player.js';
import { TransferMarket } from '../../src/ui/screens/TransferMarket.js';
import { PlayerDevelopment } from '../../src/ui/screens/PlayerDevelopment.js';
import { RouterOutlet } from '../../src/ui/router.js';
import { NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { BALANCE } from '../../src/config/balance.js';
import {
  selectFollowedTeam,
  selectRoster,
  selectTransferMoves,
  selectFreeAgents,
  selectSeason
} from '../../src/state/selectors.js';

const MARKET = BALANCE.CAREER.MARKET;

/** Build a synthetic free agent with a strong profile. */
function freeAgent(id, overall = 80, potential = 90) {
  const a = {};
  for (const k of ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl']) a[k] = overall;
  return createPlayer({
    id,
    handle: id.toUpperCase(),
    name: `Agent ${id}`,
    role: 'Duelist',
    age: 20,
    potential,
    attributes: a,
    contract: { status: 'free_agent', teamId: null, salary: 0, expires: 0 }
  });
}

export default async function run() {
  /* ----------------------------- reducer ----------------------------- */
  section('transfers slice — record / reset');
  {
    assertEqual(initialTransfersState.moves.length, 0, 'initial transfers state is empty');
    const m = { playerId: 'p', kind: 'signing', salary: 1, fromTeamId: null, toTeamId: 't', fee: 0 };
    const s1 = transfersReducer(initialTransfersState, recordTransfer(m));
    assertEqual(s1.moves.length, 1, 'record appends a move');
    assertEqual(s1.moves[0].kind, 'signing', 'recorded move kind preserved');
    const s2 = transfersReducer(s1, recordTransfer({ playerId: 'q', kind: 'release' }));
    assertEqual(s2.moves.length, 2, 'record appends, never replaces');
    const s3 = transfersReducer(s2, resetTransfers());
    assertEqual(s3.moves.length, 0, 'reset clears the window log');
    // malformed move is a no-op
    assert(transfersReducer(s1, { type: 'transfers/record' }) === s1, 'record without a move is a no-op');
  }

  /* ---------------------------- bootstrap ---------------------------- */
  section('store wires the transfers slice');
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  assert(Array.isArray(store.getState().transfers.moves), 'transfers slice present in the root store');
  assertEqual(selectTransferMoves(store.getState()).length, 0, 'fresh window has no moves');

  const team = selectFollowedTeam(store.getState());
  assertEqual(selectRoster(store.getState(), team.id).length, 5, 'followed team starts with 5');
  assertEqual(selectFreeAgents(store.getState()).length, 0, 'no free agents exist at season 0 (all seed players rostered)');

  /* --------------------------- screens render ------------------------ */
  section('Market Watch + Player Development screens render headlessly');
  // inject a free agent so the market list is non-empty
  store.dispatch(setPlayer(freeAgent('fa9', 84, 92)));
  let html = toHtml(TransferMarket(store.getState(), store.dispatch, store));
  assert(html.includes('screen--market'), 'market screen renders');
  assert(html.includes('Market Watch'), 'market watch title present');
  assert(html.includes('Roster') && html.includes('Free Agents'), 'market panels present');
  assert(html.includes('FA9'), 'free agent appears in the market list');

  /* ------------------------------------------------------------------ */
  section('Market Watch is read-only — no GM action controls');
  assert(!html.includes('>Sign<'), 'no sign button');
  assert(!html.includes('>Release<'), 'no release button');
  assert(!html.includes('>Extend<'), 'no extend button');
  assert(!html.includes('>Buy<'), 'no buy button');
  assert(!html.includes('Hire Coach'), 'no hire-coach button');
  // displayed numbers are rounded, not raw 16-digit floats
  assert(!/\d\.\d{4,}/.test(html), 'market view renders no unrounded float numbers');

  const keepId = selectFollowedTeam(store.getState()).roster[0];
  store.dispatch(navigate('development', { playerId: keepId }));
  html = toHtml(PlayerDevelopment(store.getState(), store.dispatch));
  assert(html.includes('screen--development'), 'development screen renders');
  assert(html.includes('Career Phase') && html.includes('Potential') && html.includes('Age Curve') && html.includes('Attributes'), 'development sections present');
  assert(!/\d\.\d{4,}/.test(html), 'development view renders no unrounded float numbers');
  // empty-state when no player selected
  store.dispatch(navigate('development', {}));
  assert(toHtml(PlayerDevelopment(store.getState(), store.dispatch)).includes('No player selected'), 'development empty-state renders');

  /* --------------------------- router + sidebar ---------------------- */
  section('router resolves market/development; sidebar exposes the market item');
  store.dispatch(navigate('market'));
  assert(toHtml(RouterOutlet(store.getState(), store.dispatch, store)).includes('screen--market'), 'router routes to the market');
  store.dispatch(navigate('development', { playerId: keepId }));
  assert(toHtml(RouterOutlet(store.getState(), store.dispatch, store)).includes('screen--development'), 'router routes to development');
  assert(NAV_ITEMS.some((i) => i.screen === 'market'), 'sidebar exposes a market nav item');

  /* ------------------- the world still simulates --------------------- */
  section('the autonomous world advances a slot');
  const guardStart = selectSeason(store.getState()).slotIndex;
  continueSeason(store, { simEvent: true });
  assert(selectSeason(store.getState()).slotIndex === guardStart + 1, 'the season advanced a slot');
  assert(selectRoster(store.getState(), team.id).length >= MARKET.MIN_ROSTER, 'the viewed roster stayed valid through a played slot');
}
