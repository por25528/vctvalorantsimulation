/**
 * core/store.js — minimal reactive store (CONTRACTS §12).
 * Responsibility: Redux-style single immutable state tree + combineReducers.
 * Middleware deferred to Phase 3. Dependency-free; Node + browser.
 *
 * @typedef {{ type:string, [k:string]:* }} Action
 * @typedef {(state:*, action:Action) => *} Reducer
 * @typedef {Object} Store
 * @property {() => *} getState                       current state tree
 * @property {(action:Action) => Action} dispatch     apply an action; returns it
 * @property {(fn:() => void) => (() => void)} subscribe register listener; returns unsub
 */

/**
 * Create a store.
 * @param {Reducer} rootReducer
 * @param {*} [initialState] optional preloaded state; otherwise reducers init it
 * @returns {Store}
 */
export function createStore(rootReducer, initialState) {
  let state = initialState === undefined
    ? rootReducer(undefined, { type: '@@INIT' })
    : initialState;

  /** @type {Set<() => void>} */
  const listeners = new Set();
  let dispatching = false;

  const getState = () => state;

  /** @type {Store['dispatch']} */
  const dispatch = (action) => {
    if (dispatching) throw new Error('store: cannot dispatch during a dispatch');
    if (action == null || typeof action.type === 'undefined') {
      throw new Error('store: actions must have a type');
    }
    dispatching = true;
    try {
      state = rootReducer(state, action);
    } finally {
      dispatching = false;
    }
    for (const fn of [...listeners]) fn();
    return action;
  };

  /** @type {Store['subscribe']} */
  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  return { getState, dispatch, subscribe };
}

/**
 * Compose a map of slice reducers into one root reducer over a keyed state tree.
 * Each slice owns `state[key]`. Returns the same object reference when no slice
 * changed, so subscribers can cheaply detect no-ops.
 * @param {Record<string, Reducer>} map
 * @returns {Reducer}
 */
export function combineReducers(map) {
  const keys = Object.keys(map);
  return function rootReducer(state = {}, action) {
    let changed = false;
    /** @type {Record<string, *>} */
    const next = {};
    for (const key of keys) {
      const prevSlice = state[key];
      const nextSlice = map[key](prevSlice, action);
      next[key] = nextSlice;
      if (nextSlice !== prevSlice) changed = true;
    }
    // Also changed if a key was removed from the reducer map vs prior state.
    changed = changed || keys.length !== Object.keys(state).length;
    return changed ? next : state;
  };
}
