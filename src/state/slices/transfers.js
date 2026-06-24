/**
 * state/slices/transfers.js — reducer slice for the transfer-market state
 * (CONTRACTS-CAREER §4). Phase 6 (P6d). Pure reducer (state, action) -> new state.
 *
 * The free-agent POOL and the followed team's ROSTER are derived live from the
 * `world` slice (selectFreeAgents / selectRoster) — they are not duplicated here.
 * What this slice owns is the user's brokered-move LOG for the current transfer
 * window: the signings, releases and renewals the manager has made since the
 * window opened. The Transfer Market screen renders this log ("your moves this
 * window"); it resets when a new season begins (the window re-opens).
 *
 * A logged Move reuses the engine Move shape (offseason/transfers.js) plus a
 * 'renew' kind for a user contract extension:
 *   { playerId, fromTeamId|null, toTeamId|null, fee, salary, kind, name? }
 * (`name` is a display convenience captured at move time so the log reads well
 * even after the player's team changes again.)
 *
 * No Date.now / Math.random / DOM — a plain reducer.
 *
 * @typedef {Object} TransfersSlice
 * @property {Array<object>} moves  user-brokered moves this window, oldest first
 */

/** Action type constants (owned here; re-exported by state/actions.js). */
export const TRANSFERS_RECORD = 'transfers/record';
export const TRANSFERS_RESET = 'transfers/reset';

/** @type {TransfersSlice} */
export const initialTransfersState = Object.freeze({ moves: [] });

/**
 * Transfer-market reducer.
 *   transfers/record  — append one user Move to the window log
 *   transfers/reset   — clear the log (a new window / season has opened)
 *
 * @param {TransfersSlice} [slice]
 * @param {{type:string, move?:object}} action
 * @returns {TransfersSlice}
 */
export function transfersReducer(slice = initialTransfersState, action) {
  switch (action.type) {
    case TRANSFERS_RECORD: {
      if (!action.move || typeof action.move !== 'object') return slice;
      return { ...slice, moves: [...slice.moves, action.move] };
    }
    case TRANSFERS_RESET:
      return initialTransfersState;
    default:
      return slice;
  }
}
