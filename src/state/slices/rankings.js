/**
 * state/slices/rankings.js — reducer slice for the GLOBAL-RANKING delta snapshot.
 *
 * Holds the PREVIOUS season's final global ranks (team + player) so the live
 * rankings can show season-to-season movement (climb/fall `deltaRank`). The live
 * ranking itself is always derived fresh from the world + season series by the
 * selectors — only the prior snapshot needs to persist. Tiny by construction
 * (id → rank maps), so it adds no meaningful weight to a save.
 *
 * The huge ranked ladder is NOT stored here: it is rebuilt deterministically from
 * the seed (memoized) by the selector, so several thousand records never touch the
 * redux state or a save file.
 *
 * @typedef {Object} RankingsState
 * @property {number} season                 // the season index these snapshots are FROM (-1 = none)
 * @property {Record<string, number>} teams  // teamId   → final world-rank last season
 * @property {Record<string, number>} players// playerId → final global-rank last season
 */

/** Action type constants. */
export const RANKINGS_SET_SNAPSHOT = 'rankings/setSnapshot';
export const RANKINGS_RESET = 'rankings/reset';

/** @type {RankingsState} */
export const initialRankingsState = Object.freeze({ season: -1, teams: {}, players: {} });

/**
 * Record the just-finished season's final global ranks as the baseline the new
 * season's deltas are measured against.
 * @param {{ season:number, teams:Record<string,number>, players:Record<string,number> }} snapshot
 */
export const setRankSnapshot = (snapshot) => ({ type: RANKINGS_SET_SNAPSHOT, snapshot });

/** Clear the snapshot (a fresh career has no prior season). */
export const resetRankings = () => ({ type: RANKINGS_RESET });

/**
 * Rankings reducer.
 * @param {RankingsState} [state]
 * @param {{type:string, [k:string]:*}} action
 * @returns {RankingsState}
 */
export function rankingsReducer(state = initialRankingsState, action) {
  switch (action.type) {
    case RANKINGS_SET_SNAPSHOT: {
      const s = action.snapshot || {};
      return {
        season: typeof s.season === 'number' ? s.season : -1,
        teams: s.teams || {},
        players: s.players || {}
      };
    }
    case RANKINGS_RESET:
      return initialRankingsState;
    default:
      return state;
  }
}
