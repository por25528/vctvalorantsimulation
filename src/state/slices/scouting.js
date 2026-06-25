/**
 * state/slices/scouting.js — reducer slice for the manager's scouting focuses.
 *
 * Tracks which players the manager has explicitly scouted, and in which seasons.
 * Each "focus" is a { playerId, seasonIndex } entry. The limit (MAX_SCOUT_FOCUSES
 * from the engine) caps how many distinct players can be focused per season.
 *
 * Pure reducer (state, action) -> new state. No Date.now / Math.random / DOM.
 *
 * @typedef {Object} ScoutingSlice
 * @property {Array<{playerId:string, seasonIndex:number}>} focuses
 */

export const SCOUTING_ADD_FOCUS = 'scouting/addFocus';
export const SCOUTING_RESET = 'scouting/reset';

/** @type {ScoutingSlice} */
export const initialScoutingState = Object.freeze({
  focuses: []
});

/**
 * @param {ScoutingSlice} [slice]
 * @param {{type:string, playerId?:string, seasonIndex?:number}} action
 * @returns {ScoutingSlice}
 */
export function scoutingReducer(slice = initialScoutingState, action) {
  switch (action.type) {
    case SCOUTING_ADD_FOCUS: {
      const { playerId, seasonIndex } = action;
      if (!playerId || typeof seasonIndex !== 'number') return slice;
      // Idempotent: don't double-add the same player+season
      if (slice.focuses.some((f) => f.playerId === playerId && f.seasonIndex === seasonIndex)) {
        return slice;
      }
      return { ...slice, focuses: [...slice.focuses, { playerId, seasonIndex }] };
    }
    case SCOUTING_RESET:
      return initialScoutingState;
    default:
      return slice;
  }
}
