/**
 * state/slices/career.js — reducer slice for multi-season career meta
 * (CONTRACTS-CAREER §4). Phase 6.
 *
 * The career ENGINE (engine/career/career.js) owns a CareerState
 * { seed, seasonIndex, world, season, history, offseason, phase }. The store
 * already keeps `world` and `season` in their own slices, so this slice holds
 * only the rest — the multi-season wrapper:
 *   seed         the master career seed (for deterministic replay)
 *   seasonIndex  which season we're in (0-based)
 *   history      completed SeasonSummary[] (champions of past years)
 *   offseason    the most recent OffseasonReport (retirements/newgens/transfers)
 *   phase        'inSeason' | 'offseason'  ('offseason' = the year is done, the
 *                champion is crowned, and the next Continue resolves the break)
 *
 * The commands layer reconstructs a full CareerState from these three slices,
 * calls the engine, and writes the slices back. This slice is a trivial holder:
 * one action installs a whole career-meta payload.
 *
 * Pure reducer (state, action) -> new state. No Date.now / Math.random / DOM.
 *
 * @typedef {Object} CareerSlice
 * @property {number|string|null} seed
 * @property {number} seasonIndex
 * @property {Array<object>} history
 * @property {object|null} offseason
 * @property {'inSeason'|'offseason'} phase
 */

/** Action type constants (owned here; re-exported by state/actions.js). */
export const CAREER_SET = 'career/set';

/** @type {CareerSlice} */
export const initialCareerState = Object.freeze({
  seed: null,
  seasonIndex: 0,
  history: [],
  offseason: null,
  phase: 'inSeason'
});

/**
 * Career reducer. `career/set` merges a partial career-meta payload onto the
 * held slice (so callers can patch just `phase`, or install a fresh whole).
 *
 * @param {CareerSlice} [slice]
 * @param {{type:string, career?:Partial<CareerSlice>}} action
 * @returns {CareerSlice}
 */
export function careerReducer(slice = initialCareerState, action) {
  switch (action.type) {
    case CAREER_SET: {
      if (!action.career || typeof action.career !== 'object') return slice;
      return { ...slice, ...action.career };
    }
    default:
      return slice;
  }
}
