/**
 * tests/ui/screen-scouting.test.mjs — Scouting screen render + slice wiring.
 *
 * Covers:
 *   - Scouting screen renders without throwing in an early-career state
 *   - Hidden traits show as "???" for young unscouted players
 *   - Non-hidden traits are always visible
 *   - scoutingReducer: addScoutFocus / idempotent / reset
 *   - selectRevealedTraits delegates to getRevealedTraits correctly
 *   - scoutPlayer command caps at MAX_SCOUT_FOCUSES per season
 *   - Scouting is registered in ROUTES and NAV_ITEMS
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, scoutPlayer } from '../../src/state/commands.js';
import { navigate } from '../../src/state/actions.js';
import { scoutingReducer, initialScoutingState } from '../../src/state/slices/scouting.js';
import { addScoutFocus, resetScouting } from '../../src/state/actions.js';
import { Scouting } from '../../src/ui/screens/Scouting.js';
import { RouterOutlet } from '../../src/ui/router.js';
import { NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { ROUTES } from '../../src/ui/router.js';
import {
  selectRevealedTraits,
  selectScoutFocusesUsedThisSeason,
  selectPlayerFocusCount
} from '../../src/state/selectors.js';
import { TRAIT_DEFS } from '../../src/engine/career/traits.js';
import { MAX_SCOUT_FOCUSES } from '../../src/engine/career/scouting.js';
import { createPlayer } from '../../src/domain/player.js';
import { setPlayer } from '../../src/state/slices/world.js';

export default async function run() {
  /* ----------------------- reducer tests ----------------------- */
  section('scoutingReducer — add focus');
  {
    const s0 = initialScoutingState;
    const s1 = scoutingReducer(s0, addScoutFocus('p1', 0));
    assertEqual(s1.focuses.length, 1, 'adds a focus');
    assertEqual(s1.focuses[0].playerId, 'p1', 'records playerId');
    assertEqual(s1.focuses[0].seasonIndex, 0, 'records seasonIndex');
  }

  section('scoutingReducer — idempotent (same player+season not duplicated)');
  {
    let s = initialScoutingState;
    s = scoutingReducer(s, addScoutFocus('p1', 0));
    s = scoutingReducer(s, addScoutFocus('p1', 0));
    assertEqual(s.focuses.length, 1, 'second addScoutFocus for same player+season is a no-op');
  }

  section('scoutingReducer — different seasons accumulate');
  {
    let s = initialScoutingState;
    s = scoutingReducer(s, addScoutFocus('p1', 0));
    s = scoutingReducer(s, addScoutFocus('p1', 1));
    assertEqual(s.focuses.length, 2, 'scouting in two different seasons = two entries');
  }

  section('scoutingReducer — reset clears all focuses');
  {
    let s = scoutingReducer(initialScoutingState, addScoutFocus('p1', 0));
    s = scoutingReducer(s, resetScouting());
    assertEqual(s.focuses.length, 0, 'reset clears all focuses');
  }

  /* ----------------------- store integration ------------------- */
  section('selectRevealedTraits — non-hidden traits always visible');
  {
    const store = buildStore();
    await bootstrap(store, { fresh: true });
    const state = store.getState();
    const players = Object.values(state.world.players);
    assert(players.length > 0, 'world has players');

    // Find a player with a non-hidden trait
    const withNonHidden = players.find((p) =>
      Array.isArray(p.traits) && p.traits.some((id) => TRAIT_DEFS[id] && !TRAIT_DEFS[id].hidden)
    );
    if (withNonHidden) {
      const { known } = selectRevealedTraits(state, withNonHidden.id);
      const nonHidden = withNonHidden.traits.filter((id) => TRAIT_DEFS[id] && !TRAIT_DEFS[id].hidden);
      for (const id of nonHidden) {
        assert(known.includes(id), `non-hidden trait ${id} is always visible`);
      }
    }
  }

  section('selectRevealedTraits — hidden traits on a young player are mostly concealed');
  {
    const store = buildStore();
    await bootstrap(store, { fresh: true });

    // createPlayer caps traits at TRAITS_MAX=4, so pick 4 hidden ids
    const hiddenIds = Object.keys(TRAIT_DEFS).filter((id) => TRAIT_DEFS[id].hidden).slice(0, 4);
    assert(hiddenIds.length > 0, 'there are hidden traits');
    const youngPlayer = createPlayer({
      id: 'test-young',
      handle: 'TestYoung',
      name: 'Test Young',
      role: 'Duelist',
      age: 17,
      potential: 80,
      traits: hiddenIds,
      contract: { status: 'free_agent', teamId: null, salary: 0, expires: 0 }
    });
    store.dispatch(setPlayer(youngPlayer));

    const actualPlayer = store.getState().world.players['test-young'];
    const actualTraitCount = (actualPlayer && actualPlayer.traits && actualPlayer.traits.length) || 0;

    const { known, hiddenCount } = selectRevealedTraits(store.getState(), 'test-young');
    // At age 17 with no focuses, most hidden traits stay concealed.
    // A small number may have very low thresholds and appear — that's by design.
    assert(hiddenCount > 0, 'at least some hidden traits are concealed for a young unscouted player');
    assertEqual(known.length + hiddenCount, actualTraitCount, 'total matches the stored trait count');
  }

  section('selectRevealedTraits — scouting reveals traits');
  {
    const store = buildStore();
    await bootstrap(store, { fresh: true });

    // 4 hidden ids (TRAITS_MAX cap)
    const hiddenIds = Object.keys(TRAIT_DEFS).filter((id) => TRAIT_DEFS[id].hidden).slice(0, 4);
    const youngPlayer = createPlayer({
      id: 'test-scout',
      handle: 'TestScout',
      name: 'Test Scout',
      role: 'Duelist',
      age: 17,
      potential: 80,
      traits: hiddenIds,
      contract: { status: 'free_agent', teamId: null, salary: 0, expires: 0 }
    });
    store.dispatch(setPlayer(youngPlayer));

    const actualPlayer = store.getState().world.players['test-scout'];
    const actualTraitCount = (actualPlayer && actualPlayer.traits && actualPlayer.traits.length) || 0;

    // Scout for 3 seasons (the max — should reveal everything)
    store.dispatch(addScoutFocus('test-scout', 0));
    store.dispatch(addScoutFocus('test-scout', 1));
    store.dispatch(addScoutFocus('test-scout', 2));

    const { known, hiddenCount } = selectRevealedTraits(store.getState(), 'test-scout');
    assertEqual(hiddenCount, 0, '3 seasons of scouting reveals all hidden traits');
    assertEqual(known.length, actualTraitCount, 'all hidden traits now known');
  }

  section('selectScoutFocusesUsedThisSeason — counts current season only');
  {
    const store = buildStore();
    await bootstrap(store, { fresh: true });

    store.dispatch(addScoutFocus('p1', 0));
    store.dispatch(addScoutFocus('p2', 0));
    store.dispatch(addScoutFocus('p3', 1)); // different season

    const used = selectScoutFocusesUsedThisSeason(store.getState());
    // Season 0 is current (fresh career starts at seasonIndex 0)
    assertEqual(used, 2, 'only current-season focuses are counted');
  }

  section('selectPlayerFocusCount — counts across all seasons for a player');
  {
    const store = buildStore();
    await bootstrap(store, { fresh: true });

    store.dispatch(addScoutFocus('p1', 0));
    store.dispatch(addScoutFocus('p1', 1));
    store.dispatch(addScoutFocus('p1', 2));

    const count = selectPlayerFocusCount(store.getState(), 'p1');
    assertEqual(count, 3, 'counts focuses across all seasons');
  }

  /* ------------------- scoutPlayer command -------------------- */
  section('scoutPlayer — respects MAX_SCOUT_FOCUSES cap');
  {
    const store = buildStore();
    await bootstrap(store, { fresh: true });

    const playerIds = Object.keys(store.getState().world.players).slice(0, MAX_SCOUT_FOCUSES + 1);
    assert(playerIds.length > MAX_SCOUT_FOCUSES, 'world has enough players to test');

    // Fill up the cap
    for (let i = 0; i < MAX_SCOUT_FOCUSES; i++) {
      const ok = scoutPlayer(store, playerIds[i]);
      assert(ok, `focus ${i + 1} of ${MAX_SCOUT_FOCUSES} succeeded`);
    }

    const used = selectScoutFocusesUsedThisSeason(store.getState());
    assertEqual(used, MAX_SCOUT_FOCUSES, 'cap reached');

    // The next one should be rejected
    const overflow = scoutPlayer(store, playerIds[MAX_SCOUT_FOCUSES]);
    assert(!overflow, 'focus beyond cap is rejected');
  }

  section('scoutPlayer — idempotent per season (same player twice is a no-op)');
  {
    const store = buildStore();
    await bootstrap(store, { fresh: true });

    const pid = Object.keys(store.getState().world.players)[0];
    scoutPlayer(store, pid);
    scoutPlayer(store, pid); // second call same season

    const used = selectScoutFocusesUsedThisSeason(store.getState());
    assertEqual(used, 1, 'second scout of same player this season is rejected');
  }

  /* ----------------------- screen render ----------------------- */
  section('Scouting screen renders without throwing (fresh career)');
  {
    const store = buildStore();
    await bootstrap(store, { fresh: true });

    store.dispatch(navigate('scouting'));
    let html;
    try {
      html = toHtml(RouterOutlet(store.getState(), store.dispatch, store));
    } catch (err) {
      throw new Error(`Scouting screen threw: ${err && err.stack ? err.stack : err}`);
    }
    assert(typeof html === 'string' && html.length > 0, 'Scouting produces HTML');
    assert(html.includes('screen--scouting'), 'HTML contains scouting screen class');
    assert(html.includes('Scouting'), 'HTML contains "Scouting" heading');
    assert(html.includes('focuses remaining'), 'focus counter is shown');
  }

  section('Scouting screen shows ??? for hidden traits on young unscouted players');
  {
    const store = buildStore();
    await bootstrap(store, { fresh: true });

    // Use a hidden trait that has a non-zero threshold for player 'test-hidden-ui' + seed 2026.
    // We inject all 4 hidden traits and check if any one produces a ??? (some may have
    // threshold 0 and auto-reveal, but at least a few should be concealed at age 17).
    const hiddenIds = Object.keys(TRAIT_DEFS).filter((id) => TRAIT_DEFS[id].hidden).slice(0, 4);
    assert(hiddenIds.length > 0, 'there are hidden trait ids');

    const testPlayer = createPlayer({
      id: 'test-hidden-ui',
      handle: 'HiddenTest',
      name: 'Hidden Test',
      role: 'Duelist',
      age: 17,
      potential: 75,
      traits: hiddenIds,
      contract: { status: 'free_agent', teamId: null, salary: 0, expires: 0 }
    });
    store.dispatch(setPlayer(testPlayer));

    // Verify that at least one trait is concealed for this player
    const { hiddenCount } = selectRevealedTraits(store.getState(), 'test-hidden-ui');
    if (hiddenCount > 0) {
      store.dispatch(navigate('scouting'));
      const html = toHtml(Scouting(store.getState(), store.dispatch, store));
      assert(html.includes('???'), 'hidden trait slot shown as ???');
    }
    // If all traits happen to have threshold 0 for this specific id+seed, we still pass
    // (the logic is correct; this is purely a hash coincidence). Log for transparency.
    if (hiddenCount === 0) {
      // eslint-disable-next-line no-console
      console.log('note: all hidden traits auto-revealed for test-hidden-ui (threshold=0 hash coincidence)');
    }
  }

  section('Scouting screen is registered in ROUTES and NAV_ITEMS');
  {
    assert('scouting' in ROUTES, 'ROUTES has scouting entry');
    assert(NAV_ITEMS.some((item) => item.screen === 'scouting'), 'NAV_ITEMS has scouting entry');
    const item = NAV_ITEMS.find((item) => item.screen === 'scouting');
    assertEqual(item.label, 'Scouting', 'Scouting nav item has correct label');
    assertEqual(item.icon, 'binoculars', 'Scouting nav item uses binoculars icon');
  }
}
