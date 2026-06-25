/**
 * state/createRootStore.js — wire the root store (CONTRACTS-UI §2,
 * CONTRACTS-PERSIST §5).
 *
 * Combines the live slices into one root reducer and builds a fresh store off
 * the Phase-1 `createStore`. The store starts empty (each slice supplies its
 * own initial state); `bootstrap(store)` then builds the world, inits the
 * season, and sets the opening route.
 *
 * Slices:
 *   world   — the mutable game world { leagues, teams, players }
 *   season  — the SOURCE-OF-TRUTH SeasonState (calendar progress, completed
 *             events, CP ledger, Masters seedings, Champions field, champion)
 *   events  — a derived MIRROR of season.events[].result keyed by eventId, kept
 *             so the Phase-3 event-scoped selectors/screens (selectEvent,
 *             selectStandings, selectPlacements, selectSeries, selectLeaders,
 *             selectKickoff) keep working unchanged. Commands mirror each played
 *             event into this slice; season remains the truth.
 *   career  — multi-season meta wrapper { seed, seasonIndex, history, offseason,
 *             phase } (the rest of the engine CareerState; world+season live in
 *             their own slices). Commands reconstruct a full CareerState from these.
 *   transfers — the user's brokered-move log for the open transfer window (the
 *             free-agent pool + rosters are derived from `world`, not duplicated).
 *   ui      — transient UI (route, followed team, ticker, modals, toasts)
 */

import { createStore, combineReducers } from '../core/store.js';
import { worldReducer, initialWorldState } from './slices/world.js';
import { seasonReducer, initialSeasonState } from './slices/season.js';
import { eventsReducer, initialEventsState } from './slices/events.js';
import { careerReducer, initialCareerState } from './slices/career.js';
import { transfersReducer, initialTransfersState } from './slices/transfers.js';
import { inboxReducer, initialInboxState } from './slices/inbox.js';
import { revealReducer, initialRevealState } from './slices/reveal.js';
import { scoutingReducer, initialScoutingState } from './slices/scouting.js';
import { uiReducer, initialUiState } from './slices/ui.js';

/** The root reducer over { world, season, events, career, transfers, inbox, reveal, scouting, ui }. */
export const rootReducer = combineReducers({
  world: worldReducer,
  season: seasonReducer,
  events: eventsReducer,
  career: careerReducer,
  transfers: transfersReducer,
  inbox: inboxReducer,
  reveal: revealReducer,
  scouting: scoutingReducer,
  ui: uiReducer
});

/**
 * Build a fresh root store with each slice's initial state.
 * @returns {import('../core/store.js').Store}
 */
export function buildStore() {
  const initial = {
    world: initialWorldState,
    season: initialSeasonState,
    events: initialEventsState,
    career: initialCareerState,
    transfers: initialTransfersState,
    inbox: initialInboxState,
    reveal: initialRevealState,
    scouting: initialScoutingState,
    ui: initialUiState
  };
  return createStore(rootReducer, initial);
}
