/**
 * state/slices/ui.js — transient UI slice (CONTRACTS-UI §2).
 *
 * Holds everything the shell needs that isn't game truth: the active route,
 * the followed team, the match round-ticker playback cursor, and the open
 * modal / toast stacks. Pure reducer (state, action) -> new state; immutable
 * updates only, never mutates input.
 *
 * Toast/modal ids are derived from a monotonic `seq` counter kept in this slice
 * (no Date.now / Math.random — the UI layer stays deterministic and testable).
 *
 * @typedef {Object} Route
 * @property {string} screen   screen id (CONTRACTS-UI §5)
 * @property {object} params
 * @typedef {Object} Ticker
 * @property {string|null} seriesId
 * @property {number} mapIndex
 * @property {number} roundIndex
 * @property {boolean} playing
 * @typedef {Object} Modal  { id, type, props }
 * @typedef {Object} Toast  { id, kind, text }
 * @typedef {Object} UiState
 * @property {Route} route
 * @property {string|null} followedTeamId
 * @property {Ticker} ticker
 * @property {boolean} autoplay
 * @property {'slow'|'normal'|'fast'} autoplaySpeed  hands-free reveal cadence
 * @property {boolean} spoilerFree  when on, results stay hidden until you watch them
 * @property {Modal[]} modals
 * @property {Toast[]} toasts
 * @property {number} seq      monotonic id source for toasts/modals
 * @property {Array<object>} saveSlots  ui-held mirror of saveManager.listSlots()
 *                                      (slot metas, most-recently-played first).
 *                                      Async listing is wiped into this field by
 *                                      the refreshSlots(store) command; the
 *                                      SaveLoad screen renders from it (pure).
 */

import { produce } from '../../core/produce.js';

/** Action type constants. */
export const UI_NAVIGATE = 'ui/navigate';
export const UI_FOLLOW = 'ui/follow';
export const UI_TICKER = 'ui/ticker';
export const UI_AUTOPLAY = 'ui/autoplay';
export const UI_AUTOPLAY_SPEED = 'ui/autoplay/speed';
export const UI_SPOILERFREE = 'ui/spoilerFree';
export const UI_TOAST_PUSH = 'ui/toast/push';
export const UI_TOAST_DISMISS = 'ui/toast/dismiss';
export const UI_MODAL_OPEN = 'ui/modal/open';
export const UI_MODAL_CLOSE = 'ui/modal/close';
export const UI_SAVESLOTS_SET = 'ui/saveSlots/set';

/** @type {UiState} */
export const initialUiState = Object.freeze({
  route: Object.freeze({ screen: 'home', params: Object.freeze({}) }),
  followedTeamId: null,
  ticker: Object.freeze({ seriesId: null, mapIndex: 0, roundIndex: 0, playing: false, speed: 1 }),
  autoplay: false,
  autoplaySpeed: 'normal',
  // Spoiler-free by default: a freshly opened match plays out live and recaps hide
  // scores until you watch them. Toggle off from the top bar to see results instantly.
  spoilerFree: true,
  modals: Object.freeze([]),
  toasts: Object.freeze([]),
  saveSlots: Object.freeze([]),
  seq: 0
});

/**
 * UI reducer.
 * @param {UiState} [state]
 * @param {{type:string, [k:string]:*}} action
 * @returns {UiState}
 */
export function uiReducer(state = initialUiState, action) {
  switch (action.type) {
    case UI_NAVIGATE:
      return produce(state, (d) => {
        d.route = { screen: action.screen, params: action.params || {} };
      });

    case UI_FOLLOW:
      return produce(state, (d) => {
        d.followedTeamId = action.teamId;
      });

    case UI_TICKER:
      return produce(state, (d) => {
        d.ticker = { ...state.ticker, ...(action.patch || {}) };
      });

    case UI_AUTOPLAY:
      return produce(state, (d) => {
        d.autoplay = !!action.on;
      });

    case UI_AUTOPLAY_SPEED:
      return produce(state, (d) => {
        d.autoplaySpeed = action.speed === 'slow' || action.speed === 'fast' ? action.speed : 'normal';
      });

    case UI_SPOILERFREE:
      return produce(state, (d) => {
        d.spoilerFree = !!action.on;
      });

    case UI_TOAST_PUSH: {
      const id = `toast_${state.seq}`;
      return produce(state, (d) => {
        d.seq = state.seq + 1;
        d.toasts = [...state.toasts, { id, kind: action.kind, text: action.text }];
      });
    }

    case UI_TOAST_DISMISS:
      return produce(state, (d) => {
        d.toasts = state.toasts.filter((t) => t.id !== action.id);
      });

    case UI_MODAL_OPEN: {
      const id = `modal_${state.seq}`;
      return produce(state, (d) => {
        d.seq = state.seq + 1;
        d.modals = [...state.modals, { id, type: action.modalType, props: action.props || {} }];
      });
    }

    case UI_MODAL_CLOSE:
      return produce(state, (d) => {
        d.modals = state.modals.filter((m) => m.id !== action.id);
      });

    case UI_SAVESLOTS_SET:
      return produce(state, (d) => {
        d.saveSlots = Array.isArray(action.slots) ? action.slots : [];
      });

    default:
      return state;
  }
}
