/**
 * state/slices/events.js — reducer slice for played event instances.
 *
 * Holds every EventResult produced by the format engine, keyed by event id,
 * plus an insertion order list and a per-event status flag. Phase 3 only ever
 * holds the Pacific Kickoff, but the shape generalises to the full calendar.
 *
 * Pure reducer (state, action) -> new state (CONTRACTS §12, CONTRACTS-UI §2).
 * Immutable updates only; never mutates input.
 *
 * @typedef {'pending'|'complete'} EventStatus
 * @typedef {Object} EventsState
 * @property {Record<string, object>} byId    eventId -> EventResult
 * @property {string[]} order                 eventIds in insertion order
 * @property {Record<string, EventStatus>} status  eventId -> status
 */

import { produce } from '../../core/produce.js';

/** Action type constants. */
export const EVENTS_ADD = 'events/add';
export const EVENTS_STATUS = 'events/status';
export const EVENTS_RESET = 'events/reset';

/** @type {EventsState} */
export const initialEventsState = Object.freeze({
  byId: {},
  order: [],
  status: {}
});

/**
 * Events reducer.
 * @param {EventsState} [state]
 * @param {{type:string, [k:string]:*}} action
 * @returns {EventsState}
 */
export function eventsReducer(state = initialEventsState, action) {
  switch (action.type) {
    case EVENTS_ADD: {
      const { eventId, result } = action;
      if (typeof eventId !== 'string' || !eventId) return state;
      return produce(state, (d) => {
        d.byId = { ...d.byId, [eventId]: result };
        d.order = state.order.includes(eventId)
          ? state.order.slice()
          : [...state.order, eventId];
        // A freshly added event defaults to pending unless a status already set.
        if (!(eventId in d.status)) {
          d.status = { ...d.status, [eventId]: 'pending' };
        }
      });
    }
    case EVENTS_STATUS: {
      const { eventId, status } = action;
      if (typeof eventId !== 'string' || !eventId) return state;
      return produce(state, (d) => {
        d.status = { ...d.status, [eventId]: status };
      });
    }
    case EVENTS_RESET:
      // Clear the per-event mirror (used when a new career season begins so last
      // season's results don't masquerade as the new, unplayed events).
      return { byId: {}, order: [], status: {} };
    default:
      return state;
  }
}
