/**
 * state/actions.js — plain action creators for the Phase-3 UI store
 * (CONTRACTS-UI §2). Each returns a `{ type, ...payload }` POJO; no side
 * effects (orchestration that touches the engine lives in state/commands.js).
 *
 * Action type constants are owned by their slices (slices/events.js,
 * slices/ui.js); these creators re-export the exact string types so callers
 * never hardcode them.
 */

import {
  EVENTS_ADD,
  EVENTS_STATUS,
  EVENTS_RESET
} from './slices/events.js';
import {
  SEASON_INIT,
  SEASON_ADVANCE,
  SEASON_LOAD
} from './slices/season.js';
import { CAREER_SET } from './slices/career.js';
import { TRANSFERS_RECORD, TRANSFERS_RESET } from './slices/transfers.js';
import { INBOX_APPEND, INBOX_MARK_READ, INBOX_LOAD } from './slices/inbox.js';
import { REVEAL_SET, REVEAL_ADVANCE, REVEAL_TO_END, REVEAL_RESET } from './slices/reveal.js';
import { SCOUTING_ADD_FOCUS, SCOUTING_RESET } from './slices/scouting.js';
import {
  UI_NAVIGATE,
  UI_FOLLOW,
  UI_TICKER,
  UI_AUTOPLAY,
  UI_AUTOPLAY_SPEED,
  UI_SPOILERFREE,
  UI_TOAST_PUSH,
  UI_TOAST_DISMISS,
  UI_MODAL_OPEN,
  UI_MODAL_CLOSE,
  UI_SAVESLOTS_SET
} from './slices/ui.js';

/* ----------------------------- ui ----------------------------- */

/**
 * Navigate to a screen.
 * @param {string} screen  screen id (CONTRACTS-UI §5)
 * @param {object} [params]
 */
export const navigate = (screen, params = {}) => ({ type: UI_NAVIGATE, screen, params });

/**
 * Set the followed team.
 * @param {string|null} teamId
 */
export const follow = (teamId) => ({ type: UI_FOLLOW, teamId });

/**
 * Patch the match round-ticker cursor.
 * @param {{seriesId?:string|null, mapIndex?:number, roundIndex?:number, playing?:boolean}} patch
 */
export const tickerSet = (patch) => ({ type: UI_TICKER, patch });

/**
 * Toggle hands-free autoplay (auto-advance match-days on a timer).
 * @param {boolean} on
 */
export const setAutoplay = (on) => ({ type: UI_AUTOPLAY, on });

/**
 * Set the hands-free autoplay cadence.
 * @param {'slow'|'normal'|'fast'} speed
 */
export const setAutoplaySpeed = (speed) => ({ type: UI_AUTOPLAY_SPEED, speed });

/**
 * Toggle spoiler-free mode (results stay hidden until you watch them).
 * @param {boolean} on
 */
export const setSpoilerFree = (on) => ({ type: UI_SPOILERFREE, on });

/**
 * Push a toast.
 * @param {string} kind  e.g. 'info' | 'success' | 'error'
 * @param {string} text
 */
export const pushToast = (kind, text) => ({ type: UI_TOAST_PUSH, kind, text });

/**
 * Dismiss a toast by id.
 * @param {string} id
 */
export const dismissToast = (id) => ({ type: UI_TOAST_DISMISS, id });

/**
 * Open a modal.
 * @param {string} type
 * @param {object} [props]
 */
export const openModal = (type, props = {}) => ({ type: UI_MODAL_OPEN, modalType: type, props });

/**
 * Close a modal by id.
 * @param {string} id
 */
export const closeModal = (id) => ({ type: UI_MODAL_CLOSE, id });

/**
 * Install the ui-held save-slot list (the async listSlots() result). The
 * SaveLoad screen renders from this snapshot; refreshSlots(store) repopulates it.
 * @param {Array<object>} slots  slot metas (most-recently-played first)
 */
export const setSaveSlots = (slots) => ({ type: UI_SAVESLOTS_SET, slots });

/* --------------------------- events --------------------------- */

/**
 * Add a played EventResult to the store.
 * @param {string} eventId
 * @param {object} result  EventResult
 */
export const addEvent = (eventId, result) => ({ type: EVENTS_ADD, eventId, result });

/**
 * Set an event's status.
 * @param {string} eventId
 * @param {'pending'|'complete'} status
 */
export const setStatus = (eventId, status) => ({ type: EVENTS_STATUS, eventId, status });

/**
 * Clear the per-event mirror (used when a new career season begins).
 */
export const resetEvents = () => ({ type: EVENTS_RESET });

/* --------------------------- career --------------------------- */

/**
 * Install/patch the career-meta slice (seasonIndex, history, offseason, phase, seed).
 * @param {Partial<import('./slices/career.js').CareerSlice>} career
 */
export const setCareer = (career) => ({ type: CAREER_SET, career });

/* -------------------------- transfers ------------------------- */

/**
 * Append a user-brokered Move to the open transfer window's log.
 * @param {object} move  { playerId, fromTeamId, toTeamId, fee, salary, kind, name? }
 */
export const recordTransfer = (move) => ({ type: TRANSFERS_RECORD, move });

/**
 * Clear the transfer-window log (a new window / season has opened).
 */
export const resetTransfers = () => ({ type: TRANSFERS_RESET });

/* ---------------------------- inbox --------------------------- */

/**
 * Append generated NewsItems to the inbox (the slice stamps id + unread).
 * @param {object[]} items  NewsItem[]
 */
export const appendNews = (items) => ({ type: INBOX_APPEND, items });

/**
 * Mark one inbox item read (by id), or ALL read when no id is given.
 * @param {string} [id]
 */
export const markNewsRead = (id) => ({ type: INBOX_MARK_READ, id });

/**
 * Install a whole inbox (restored from a save).
 * @param {object[]} items  InboxItem[]
 */
export const loadInbox = (items) => ({ type: INBOX_LOAD, items });

/* --------------------------- season --------------------------- */

/**
 * Install a fresh, unplayed SeasonState (slotIndex 0).
 * @param {import('../engine/career/season.js').SeasonState} state
 */
export const initSeason = (state) => ({ type: SEASON_INIT, state });

/**
 * Replace the held SeasonState with the next one (post advanceSeason).
 * @param {import('../engine/career/season.js').SeasonState} state
 */
export const advanceSeason = (state) => ({ type: SEASON_ADVANCE, state });

/**
 * Install a SeasonState restored from a save.
 * @param {import('../engine/career/season.js').SeasonState} state
 */
export const loadSeason = (state) => ({ type: SEASON_LOAD, state });

/* ---------------------------- reveal -------------------------- */

/**
 * Begin (or replace) the match-day reveal for a slot.
 * @param {{slotId:string, schedule:Array<object>, dayIndex?:number}} payload
 */
export const setReveal = ({ slotId, schedule, dayIndex = 0 }) => ({ type: REVEAL_SET, slotId, schedule, dayIndex });

/** Reveal the next match-day (clamped to the last day). */
export const advanceReveal = () => ({ type: REVEAL_ADVANCE });

/** Reveal every remaining match-day of the current slot at once. */
export const revealToEnd = () => ({ type: REVEAL_TO_END });

/** Clear the reveal cursor (new season / fresh career). */
export const resetReveal = () => ({ type: REVEAL_RESET });

/* -------------------------- scouting ------------------------- */

/**
 * Record a scouting focus on a player for a specific season.
 * @param {string} playerId
 * @param {number} seasonIndex
 */
export const addScoutFocus = (playerId, seasonIndex) => ({ type: SCOUTING_ADD_FOCUS, playerId, seasonIndex });

/**
 * Clear all scouting focuses (used when importing a fresh save or resetting).
 */
export const resetScouting = () => ({ type: SCOUTING_RESET });
