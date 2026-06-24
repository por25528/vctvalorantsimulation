/**
 * tests/ui/screen-transfers.test.mjs — P6d transfer market + player development
 * (CONTRACTS-CAREER §4).
 *
 * Headless via toHtml. Covers the now-live transfers slice, the four user
 * commands (signPlayer / releasePlayer / offerContract / moveRosterPlayer) with
 * their roster-validity guards, the two new screens, and the router/sidebar
 * wiring. The free-agent pool is empty at season 0 (every seed player is
 * rostered), so the test injects synthetic free agents to exercise signings.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason, signPlayer, releasePlayer, offerContract, moveRosterPlayer } from '../../src/state/commands.js';
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
  selectPlayer,
  selectTransferMoves,
  selectFreeAgents,
  selectSeason
} from '../../src/state/selectors.js';

const MARKET = BALANCE.CAREER.MARKET;

/** Build a synthetic free agent with a strong, signable profile. */
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

  /* ---------------------------- signPlayer --------------------------- */
  section('signPlayer — fill the bench from free agency, guarded by MAX_ROSTER');
  store.dispatch(setPlayer(freeAgent('fa1', 82, 90)));
  store.dispatch(setPlayer(freeAgent('fa2', 78, 88)));
  store.dispatch(setPlayer(freeAgent('fa3', 75, 80)));

  assert(signPlayer(store, 'fa1'), 'signing fa1 succeeds');
  assertEqual(selectRoster(store.getState(), team.id).length, 6, 'roster grew to 6');
  const signed = selectPlayer(store.getState(), 'fa1');
  assertEqual(signed.contract.status, 'active', 'signed player is now active');
  assertEqual(signed.contract.teamId, team.id, 'signed player joined the followed team');
  assert(signed.contract.expires >= MARKET.USER_SIGN_LENGTH, 'signing sets an expiry past the upcoming off-season');
  assert(selectTransferMoves(store.getState()).some((m) => m.kind === 'signing' && m.playerId === 'fa1'), 'signing logged in the window');

  assert(signPlayer(store, 'fa2'), 'signing fa2 fills to 7');
  assertEqual(selectRoster(store.getState(), team.id).length, MARKET.MAX_ROSTER, 'roster at MAX_ROSTER');
  assert(!signPlayer(store, 'fa3'), 'signing past MAX_ROSTER is refused');
  assertEqual(selectRoster(store.getState(), team.id).length, MARKET.MAX_ROSTER, 'refused signing left the roster unchanged');
  assertEqual(selectPlayer(store.getState(), 'fa3').contract.status, 'free_agent', 'refused player stays a free agent');

  // a non-free-agent can't be signed
  assert(!signPlayer(store, team.roster[0]), 'cannot sign a player who is not a free agent');

  /* --------------------------- releasePlayer ------------------------- */
  section('releasePlayer — to free agency, guarded by MIN_ROSTER');
  assert(releasePlayer(store, 'fa2'), 'releasing fa2 succeeds (roster was above the floor)');
  assertEqual(selectRoster(store.getState(), team.id).length, 6, 'roster back to 6');
  assertEqual(selectPlayer(store.getState(), 'fa2').contract.status, 'free_agent', 'released player is a free agent again');
  assert(releasePlayer(store, 'fa1'), 'releasing fa1 succeeds (roster -> 5)');
  assertEqual(selectRoster(store.getState(), team.id).length, MARKET.MIN_ROSTER, 'roster at the MIN floor');
  assert(!releasePlayer(store, team.roster[0]), 'releasing at MIN_ROSTER is refused');
  assertEqual(selectRoster(store.getState(), team.id).length, MARKET.MIN_ROSTER, 'refused release left the roster unchanged');

  /* --------------------------- offerContract ------------------------- */
  section('offerContract — extend a rostered player');
  const keepId = selectFollowedTeam(store.getState()).roster[0];
  const before = selectPlayer(store.getState(), keepId).contract.expires;
  assert(offerContract(store, keepId), 'extension succeeds');
  const after = selectPlayer(store.getState(), keepId).contract.expires;
  assert(after >= before + 1, 'extension pushes the expiry out');
  assert(after >= MARKET.USER_SIGN_LENGTH, 'extended expiry is at least USER_SIGN_LENGTH out');
  assert(!offerContract(store, 'fa1'), 'cannot extend a free agent you do not roster');

  /* ------------------------- moveRosterPlayer ------------------------ */
  section('moveRosterPlayer — set the starting five (first 5 = starters)');
  const roster0 = selectFollowedTeam(store.getState()).roster.slice();
  const last = roster0[roster0.length - 1];
  assert(moveRosterPlayer(store, last, -1), 'promote the last player one slot');
  const roster1 = selectFollowedTeam(store.getState()).roster;
  assertEqual(roster1[roster0.length - 2], last, 'promoted player moved up one');
  assert(!moveRosterPlayer(store, roster1[0], -1), 'cannot promote the player already at the top');

  /* --------------------------- screens render ------------------------ */
  section('Transfer Market + Player Development screens render headlessly');
  // re-add a free agent so the market list is non-empty
  store.dispatch(setPlayer(freeAgent('fa9', 84, 92)));
  let html = toHtml(TransferMarket(store.getState(), store.dispatch, store));
  assert(html.includes('screen--market'), 'market screen renders');
  assert(html.includes('Your Squad') && html.includes('Free Agents') && html.includes('Window Moves'), 'market panels present');
  assert(html.includes('FA9'), 'free agent appears in the market list');
  assert(html.includes('Sign') && html.includes('Release') && html.includes('Extend'), 'market actions present');
  // The squad here is REAL seed players (non-equal attributes => fractional mean
  // overall) — guard that displayed numbers are rounded, not raw 16-digit floats.
  assert(!/\d\.\d{4,}/.test(html), 'market view renders no unrounded float numbers');

  store.dispatch(navigate('development', { playerId: keepId }));
  html = toHtml(PlayerDevelopment(store.getState(), store.dispatch));
  assert(html.includes('screen--development'), 'development screen renders');
  assert(html.includes('Career Phase') && html.includes('Potential') && html.includes('Age Curve') && html.includes('Attributes'), 'development sections present');
  // keepId is a real seed player (fractional mean overall) — the headline OVR and
  // the potential bar width must be rounded, not raw floats.
  assert(!/\d\.\d{4,}/.test(html), 'development view renders no unrounded float numbers');
  // empty-state when no player selected
  store.dispatch(navigate('development', {}));
  assert(toHtml(PlayerDevelopment(store.getState(), store.dispatch)).includes('No player selected'), 'development empty-state renders');

  /* --------------------------- router + sidebar ---------------------- */
  section('router resolves market/development; sidebar exposes Transfers');
  store.dispatch(navigate('market'));
  assert(toHtml(RouterOutlet(store.getState(), store.dispatch, store)).includes('screen--market'), 'router routes to the market');
  store.dispatch(navigate('development', { playerId: keepId }));
  assert(toHtml(RouterOutlet(store.getState(), store.dispatch, store)).includes('screen--development'), 'router routes to development');
  assert(NAV_ITEMS.some((i) => i.screen === 'market'), 'sidebar exposes a Transfers nav item');

  /* ------------------- user moves survive into the sim --------------- */
  section('a brokered roster still simulates and stays valid');
  const guardStart = selectSeason(store.getState()).slotIndex;
  continueSeason(store, { simEvent: true });
  assert(selectSeason(store.getState()).slotIndex === guardStart + 1, 'the season advanced a slot after user moves');
  assert(selectRoster(store.getState(), team.id).length >= MARKET.MIN_ROSTER, 'the followed roster stayed valid through a played slot');
}
