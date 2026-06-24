/**
 * tests/unit/store.test.mjs — core/store.js + state/slices/world.js (CONTRACTS §12, §14).
 * Verifies: dispatch updates state; subscribe fires & unsubscribes;
 * combineReducers composes slices and preserves identity on no-ops.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createStore, combineReducers } from '../../src/core/store.js';
import {
  worldReducer, initialWorldState, replaceWorld,
  setTeam, setPlayer, setLeague
} from '../../src/state/slices/world.js';

export default async function storeTest() {
  section('core/store');

  // Basic counter reducer: dispatch updates state.
  {
    const reducer = (state = { n: 0 }, action) =>
      action.type === 'inc' ? { n: state.n + 1 } : state;
    const store = createStore(reducer);
    assertEqual(store.getState(), { n: 0 }, 'initial state from reducer');
    store.dispatch({ type: 'inc' });
    assertEqual(store.getState(), { n: 1 }, 'dispatch updated state');
  }

  // subscribe fires on dispatch; unsubscribe stops it.
  {
    const reducer = (state = 0, action) => (action.type === 'inc' ? state + 1 : state);
    const store = createStore(reducer);
    let calls = 0;
    const unsub = store.subscribe(() => { calls++; });
    store.dispatch({ type: 'inc' });
    store.dispatch({ type: 'inc' });
    assertEqual(calls, 2, 'subscriber fired per dispatch');
    unsub();
    store.dispatch({ type: 'inc' });
    assertEqual(calls, 2, 'unsubscribed listener no longer fires');
  }

  // Action without type rejected.
  {
    const store = createStore((s = {}) => s);
    let threw = false;
    try { store.dispatch({}); } catch { threw = true; }
    assert(threw, 'dispatch rejects action without type');
  }

  // combineReducers composes slices.
  {
    const root = combineReducers({
      a: (s = 0, ac) => (ac.type === 'a+' ? s + 1 : s),
      b: (s = 10, ac) => (ac.type === 'b+' ? s + 1 : s)
    });
    const store = createStore(root);
    assertEqual(store.getState(), { a: 0, b: 10 }, 'combined initial state');
    store.dispatch({ type: 'a+' });
    assertEqual(store.getState(), { a: 1, b: 10 }, 'only slice a changed');
  }

  // combineReducers preserves identity when nothing changed.
  {
    const root = combineReducers({ a: (s = 0) => s });
    const store = createStore(root);
    const before = store.getState();
    store.dispatch({ type: 'noop' });
    assert(store.getState() === before, 'state identity preserved on no-op');
  }

  // world slice integration through a combined store.
  {
    const root = combineReducers({ world: worldReducer });
    const store = createStore(root);
    assertEqual(store.getState().world, initialWorldState, 'world initial state');

    store.dispatch(setLeague({ id: 'pacific', name: 'Pacific' }));
    store.dispatch(setTeam({ id: 't1', name: 'DRX' }));
    store.dispatch(setPlayer({ id: 'p1', handle: 'stax' }));

    const w = store.getState().world;
    assertEqual(w.leagues.pacific.name, 'Pacific', 'setLeague upsert');
    assertEqual(w.teams.t1.name, 'DRX', 'setTeam upsert');
    assertEqual(w.players.p1.handle, 'stax', 'setPlayer upsert');
    assertEqual(initialWorldState, { leagues: {}, teams: {}, players: {} }, 'initial state not mutated');

    store.dispatch(replaceWorld({ leagues: { x: { id: 'x' } }, teams: {}, players: {} }));
    assertEqual(store.getState().world.leagues, { x: { id: 'x' } }, 'replaceWorld replaced leagues');
    assertEqual(store.getState().world.teams, {}, 'replaceWorld reset teams');
  }
}
