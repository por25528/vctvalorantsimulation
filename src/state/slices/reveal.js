/**
 * state/slices/reveal.js — the day-by-day MATCH-DAY REVEAL cursor.
 *
 * The match/format/season engine still computes a whole calendar slot atomically
 * and deterministically; this transient slice paces how much of that computed
 * slot the UI has "played" so far. It holds the current slot's match-day schedule
 * (from engine/career/matchdays.js buildSlotSchedule) plus the index of the
 * highest revealed day. The spoiler-gating selectors read it to clip the
 * Standings / Bracket / Leaders views to only the revealed series.
 *
 * Pure reducer (state, action) -> new state; immutable updates only. No engine
 * call, no Date/Math.random/DOM. The schedule is rebuilt (not trusted from disk)
 * on load, so only { slotId, dayIndex } need persisting.
 *
 * @typedef {import('../../engine/career/matchdays.js').MatchDay} MatchDay
 * @typedef {Object} RevealState
 * @property {string|null} slotId      the calendar slot currently revealing (null = none)
 * @property {ReadonlyArray<MatchDay>} schedule
 * @property {number} dayIndex         highest revealed day (0-based; -1 = nothing yet)
 * @property {number} totalDays        schedule.length (cached)
 */

/** Action type constants (re-exported through state/actions.js). */
export const REVEAL_SET = 'reveal/set';
export const REVEAL_ADVANCE = 'reveal/advance';
export const REVEAL_TO_END = 'reveal/toEnd';
export const REVEAL_RESET = 'reveal/reset';

/** @type {RevealState} */
export const initialRevealState = Object.freeze({
  slotId: null,
  schedule: Object.freeze([]),
  dayIndex: -1,
  totalDays: 0
});

/** Clamp d into [-1, totalDays-1]. */
function clampDay(d, totalDays) {
  if (typeof d !== 'number' || Number.isNaN(d)) return -1;
  if (d < -1) return -1;
  if (d > totalDays - 1) return totalDays - 1;
  return d;
}

/**
 * Reveal reducer.
 * @param {RevealState} [state]
 * @param {{type:string, [k:string]:*}} action
 * @returns {RevealState}
 */
export function revealReducer(state = initialRevealState, action) {
  switch (action.type) {
    case REVEAL_SET: {
      const schedule = Array.isArray(action.schedule) ? action.schedule : [];
      const totalDays = schedule.length;
      const dayIndex = clampDay(typeof action.dayIndex === 'number' ? action.dayIndex : 0, totalDays);
      return { slotId: action.slotId || null, schedule, dayIndex, totalDays };
    }
    case REVEAL_ADVANCE:
      return { ...state, dayIndex: clampDay(state.dayIndex + 1, state.totalDays) };
    case REVEAL_TO_END:
      return { ...state, dayIndex: state.totalDays - 1 };
    case REVEAL_RESET:
      return initialRevealState;
    default:
      return state;
  }
}
