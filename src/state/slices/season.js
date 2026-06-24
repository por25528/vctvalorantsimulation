/**
 * state/slices/season.js — reducer slice holding the live SeasonState
 * (CONTRACTS-PERSIST §5). The season is the SOURCE OF TRUTH for the whole
 * 2026 cycle: the calendar, how far it has progressed (slotIndex), every
 * completed event (in calendar order), the cumulative CP ledger, the
 * Masters seedings, the Champions field and the crowned champion.
 *
 * The SeasonState object itself is produced by the (pure, Date-free) engine
 * — engine/career/season.js {initSeason, advanceSeason, seasonToResult}. This
 * slice never computes a season; it only stores whichever SeasonState the
 * commands layer hands it. That keeps the engine the single owner of the
 * stepping logic and the slice a trivial holder.
 *
 * Actions (payload is always a whole SeasonState):
 *   season/init    {state}  — install a fresh, unplayed SeasonState (slotIndex 0)
 *   season/advance {state}  — replace with the next SeasonState (post advanceSeason)
 *   season/load    {state}  — install a SeasonState restored from a save
 *
 * All three are structurally identical (replace the held state); they are kept
 * distinct so the action log reads intentionally and middleware/devtools can
 * tell a fresh start from an advance from a load.
 *
 * Pure reducer (state, action) -> new state. Immutable: never mutates input.
 * No Date.now / Math.random / DOM here.
 *
 * @typedef {import('../../engine/career/season.js').SeasonState} SeasonState
 *
 * @typedef {Object} SeasonSlice
 * @property {SeasonState|null} state   the held SeasonState (null before init)
 */

/** Action type constants (owned here; re-exported by state/actions.js). */
export const SEASON_INIT = 'season/init';
export const SEASON_ADVANCE = 'season/advance';
export const SEASON_LOAD = 'season/load';

/** @type {SeasonSlice} */
export const initialSeasonState = Object.freeze({
  state: null
});

/**
 * Season reducer. Each action carries a complete SeasonState in `action.state`
 * and simply installs it. A malformed action (missing `state`) is a no-op.
 *
 * @param {SeasonSlice} [slice]
 * @param {{type:string, state?:SeasonState}} action
 * @returns {SeasonSlice}
 */
export function seasonReducer(slice = initialSeasonState, action) {
  switch (action.type) {
    case SEASON_INIT:
    case SEASON_ADVANCE:
    case SEASON_LOAD: {
      if (!action.state || typeof action.state !== 'object') return slice;
      return { state: action.state };
    }
    default:
      return slice;
  }
}
