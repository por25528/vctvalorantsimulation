/**
 * tests/ui/state.test.mjs — STATE LAYER tests (CONTRACTS-UI §2, §3 +
 * CONTRACTS-PERSIST §5).
 *
 * Headless: builds the real root store, runs bootstrap + continueSeason over the
 * FULL season model, and asserts the slices/actions/selectors/commands behave
 * per contract. This suite was updated from the Phase-3 single-Kickoff 'events'
 * model to the Phase-5 season model: `bootstrap` now builds the 48-team world and
 * inits a SeasonState (source of truth), and `continueSeason` advances the
 * calendar one slot at a time (a regional slot plays 4 region events, all
 * mirrored into the events slice). Default export is an async fn that throws on
 * failure (run.mjs convention).
 */

import { assert, assertEqual, section } from '../_assert.mjs';

import { buildStore } from '../../src/state/createRootStore.js';
import {
  bootstrap,
  continueSeason,
  openSeries,
  openEvent,
  KICKOFF_EVENT_ID,
  DEFAULT_SEED
} from '../../src/state/commands.js';
import {
  selectFollowedTeam,
  selectTeams,
  selectTeam,
  selectPlayer,
  selectRoute,
  selectKickoff,
  selectEvent,
  selectStandings,
  selectPlacements,
  selectSeries,
  selectLeaders,
  selectSeason,
  selectCalendar,
  selectSlot,
  selectCPStandings,
  selectChampionsField,
  selectChampion,
  selectSlotsPlayed,
  selectCareerPhase,
  selectSeasonIndex,
  selectCareerHistory
} from '../../src/state/selectors.js';
import {
  navigate,
  follow,
  addEvent,
  setStatus,
  tickerSet,
  pushToast,
  dismissToast,
  openModal,
  closeModal,
  initSeason as initSeasonAction,
  advanceSeason as advanceSeasonAction,
  loadSeason as loadSeasonAction
} from '../../src/state/actions.js';
import { eventsReducer, initialEventsState } from '../../src/state/slices/events.js';
import { uiReducer, initialUiState } from '../../src/state/slices/ui.js';
import { seasonReducer, initialSeasonState } from '../../src/state/slices/season.js';

export default async function run() {
  /* ---------------------- reducers handle each action ---------------------- */
  section('reducers');

  // ui: navigate
  {
    const s = uiReducer(initialUiState, navigate('standings', { eventId: 'e1' }));
    assertEqual(s.route.screen, 'standings', 'navigate sets screen');
    assertEqual(s.route.params.eventId, 'e1', 'navigate sets params');
  }
  // ui: follow
  {
    const s = uiReducer(initialUiState, follow('t9'));
    assertEqual(s.followedTeamId, 't9', 'follow sets followedTeamId');
  }
  // ui: ticker patch (partial)
  {
    const s = uiReducer(initialUiState, tickerSet({ seriesId: 'sX', mapIndex: 2 }));
    assertEqual(s.ticker.seriesId, 'sX', 'ticker seriesId patched');
    assertEqual(s.ticker.mapIndex, 2, 'ticker mapIndex patched');
    assertEqual(s.ticker.roundIndex, 0, 'ticker roundIndex preserved');
  }
  // ui: toast push + dismiss
  {
    const s1 = uiReducer(initialUiState, pushToast('info', 'hi'));
    assertEqual(s1.toasts.length, 1, 'toast pushed');
    assertEqual(s1.toasts[0].kind, 'info', 'toast kind');
    assertEqual(s1.toasts[0].text, 'hi', 'toast text');
    const id = s1.toasts[0].id;
    const s2 = uiReducer(s1, dismissToast(id));
    assertEqual(s2.toasts.length, 0, 'toast dismissed');
    // ids are unique (monotonic seq)
    const s3 = uiReducer(s1, pushToast('error', 'bye'));
    assert(s3.toasts[0].id !== s3.toasts[1].id, 'toast ids unique');
  }
  // ui: modal open + close
  {
    const s1 = uiReducer(initialUiState, openModal('confirm', { msg: 'sure?' }));
    assertEqual(s1.modals.length, 1, 'modal opened');
    assertEqual(s1.modals[0].type, 'confirm', 'modal type');
    assertEqual(s1.modals[0].props.msg, 'sure?', 'modal props');
    const s2 = uiReducer(s1, closeModal(s1.modals[0].id));
    assertEqual(s2.modals.length, 0, 'modal closed');
  }
  // events: add + status
  {
    const s1 = eventsReducer(initialEventsState, addEvent('e1', { foo: 1 }));
    assertEqual(s1.order.length, 1, 'event order grows');
    assertEqual(s1.byId.e1.foo, 1, 'event stored byId');
    assertEqual(s1.status.e1, 'pending', 'new event defaults pending');
    const s2 = eventsReducer(s1, setStatus('e1', 'complete'));
    assertEqual(s2.status.e1, 'complete', 'status set complete');
    // re-add same id does not duplicate order
    const s3 = eventsReducer(s2, addEvent('e1', { foo: 2 }));
    assertEqual(s3.order.length, 1, 'no dup in order on re-add');
    assertEqual(s3.byId.e1.foo, 2, 'event byId replaced');
  }
  // season: init / advance / load all install the carried SeasonState
  {
    const sA = { seed: 1, slotIndex: 0, complete: false };
    const sB = { seed: 1, slotIndex: 1, complete: false };
    const sC = { seed: 1, slotIndex: 8, complete: true };
    let slice = seasonReducer(initialSeasonState, initSeasonAction(sA));
    assertEqual(slice.state, sA, 'season/init installs the state');
    slice = seasonReducer(slice, advanceSeasonAction(sB));
    assertEqual(slice.state, sB, 'season/advance replaces the state');
    slice = seasonReducer(slice, loadSeasonAction(sC));
    assertEqual(slice.state, sC, 'season/load replaces the state');
    // malformed action is a no-op
    const same = seasonReducer(slice, { type: 'season/advance' });
    assert(same === slice, 'season action without state is a no-op');
  }

  /* ----------------------------- bootstrap ----------------------------- */
  section('bootstrap');

  const store = buildStore();
  await bootstrap(store, { fresh: true });
  let st = store.getState();

  assertEqual(selectTeams(st).length, 48, 'bootstrap loads 48 teams');
  assertEqual(Object.keys(st.world.players).length, 240, 'bootstrap loads 240 players');
  assert(selectFollowedTeam(st) != null, 'bootstrap sets a default followed team');
  assertEqual(selectRoute(st).screen, 'home', 'bootstrap lands on home');

  const season0 = selectSeason(st);
  assert(season0 != null, 'bootstrap inits a season');
  // Career seed is DEFAULT_SEED; each season's seed is derived from it.
  assertEqual(st.career.seed, DEFAULT_SEED, 'career uses DEFAULT_SEED');
  assert(Number.isFinite(season0.seed), 'season carries a derived numeric seed');
  assertEqual(season0.slotIndex, 0, 'season starts at slot 0');
  assertEqual(season0.complete, false, 'season not complete at start');
  assertEqual(selectCalendar(st).length, 8, 'calendar has 8 slots');
  assertEqual(selectSlotsPlayed(st), 0, 'no slots played at start');

  // followed team is a real team object
  const ft = selectFollowedTeam(st);
  assertEqual(selectTeam(st, ft.id).id, ft.id, 'selectTeam round-trips followed team');
  // a player from that team's roster resolves
  assert(selectPlayer(st, ft.roster[0]) != null, 'selectPlayer resolves a roster id');

  /* --------------------------- continueSeason -------------------------- */
  section('continueSeason (regional Kickoff slot)');

  // simEvent reveals the whole slot at once (the day-by-day reveal is exercised
  // in screen-reveal.test.mjs); slot-level semantics match the pre-reveal engine.
  continueSeason(store, { simEvent: true });
  st = store.getState();

  assertEqual(selectSlotsPlayed(st), 1, 'slotIndex advanced after one Continue');
  assertEqual(selectRoute(st).screen, 'calendar', 'navigated to calendar after a regional slot');
  assert(st.ui.toasts.length >= 1, 'continueSeason pushed a toast');

  // The regional Kickoff slot produced 4 region events, mirrored into events.
  const slot0 = selectSlot(st, 0);
  assert(slot0 != null && slot0.played, 'slot 0 marked played');
  assertEqual(slot0.entries.length, 4, 'kickoff slot produced 4 region events');

  // selectKickoff resolves a kickoff event; the Pacific event resolves by id.
  const kickoff = selectKickoff(st);
  assert(kickoff != null, 'selectKickoff returns a kickoff event');
  const pacKick = selectEvent(st, 'kickoff', 'pacific');
  assert(pacKick != null, 'selectEvent(slotId, region) resolves the Pacific Kickoff');
  assertEqual(pacKick.eventId, 'kickoff-pacific', 'composite event id is kickoff-pacific');
  assert(st.events.byId[KICKOFF_EVENT_ID] != null, 'legacy pacific-kickoff mirror present');
  assertEqual(st.events.status[KICKOFF_EVENT_ID], 'complete', 'legacy kickoff mirror marked complete');

  /* --------------------------- selectPlacements ------------------------ */
  section('selectPlacements');

  const placements = selectPlacements(st, 'kickoff-pacific');
  assertEqual(placements.length, 12, '12-placement Kickoff');
  // ranks 1..12 unique
  const ranks = placements.map((p) => p.rank).sort((a, b) => a - b);
  for (let i = 0; i < 12; i++) assertEqual(ranks[i], i + 1, `rank ${i + 1} present`);
  const byRank = new Map(placements.map((p) => [p.rank, p]));
  // CP 4/3/2/1 to top 4, 0 below
  assertEqual(byRank.get(1).cp, 4, 'rank1 CP 4');
  assertEqual(byRank.get(2).cp, 3, 'rank2 CP 3');
  assertEqual(byRank.get(3).cp, 2, 'rank3 CP 2');
  assertEqual(byRank.get(4).cp, 1, 'rank4 CP 1');
  assertEqual(byRank.get(5).cp, 0, 'rank5 CP 0');
  assertEqual(byRank.get(12).cp, 0, 'rank12 CP 0');
  // loss invariant on the podium
  assertEqual(byRank.get(1).losses, 0, 'rank1 0 losses');
  assertEqual(byRank.get(2).losses, 1, 'rank2 1 loss');
  assertEqual(byRank.get(3).losses, 2, 'rank3 2 losses');
  assertEqual(byRank.get(4).losses, 3, 'rank4 3 losses');
  // qualification join: exactly 3 quals, 1->playoff, 2&3->swiss
  assertEqual(byRank.get(1).qual, 'masters-playoff', 'rank1 -> masters-playoff');
  assertEqual(byRank.get(2).qual, 'masters-swiss', 'rank2 -> masters-swiss');
  assertEqual(byRank.get(3).qual, 'masters-swiss', 'rank3 -> masters-swiss');
  assertEqual(byRank.get(4).qual, null, 'rank4 no qual');
  // memoization: same reference returned on repeat call
  assert(selectPlacements(st, 'kickoff-pacific') === placements, 'placements memoized by reference');

  /* ----------------------- standings / series / leaders ---------------- */
  section('standings/series/leaders');

  const groupA = selectStandings(st, 'kickoff-pacific', 'groupA');
  assertEqual(groupA.length, 6, 'group A has 6 standings rows');
  assert(groupA[0].team != null, 'standings rows joined with team');

  // pick a series and assert selectSeries finds it
  const someSeries = kickoff.series[0];
  assertEqual(selectSeries(st, someSeries.id).id, someSeries.id, 'selectSeries finds by id');
  assertEqual(selectSeries(st, '__nope__'), null, 'selectSeries null on miss');

  const leaders = selectLeaders(st, 'kickoff-pacific', 10);
  assert(leaders.length > 0 && leaders.length <= 10, 'leaders topN capped');
  for (let i = 1; i < leaders.length; i++) {
    assert(leaders[i - 1].acs >= leaders[i].acs, 'leaders sorted by ACS desc');
  }
  assert(leaders[0].playerId in st.world.players, 'leader is a real player');
  assert(selectLeaders(st, 'kickoff-pacific', 10) === leaders, 'leaders memoized');

  /* ----------------------------- openEvent ----------------------------- */
  section('openEvent');

  openEvent(store, 'kickoff', 'americas', 'standings');
  st = store.getState();
  assertEqual(selectRoute(st).screen, 'standings', 'openEvent navigates to standings');
  assertEqual(selectRoute(st).params.eventId, 'kickoff-americas', 'openEvent sets composite eventId');
  assertEqual(selectRoute(st).params.region, 'americas', 'openEvent carries region');

  /* ----------------------------- openSeries ---------------------------- */
  section('openSeries');

  openSeries(store, someSeries.id);
  st = store.getState();
  assertEqual(selectRoute(st).screen, 'match', 'openSeries navigates to match');
  assertEqual(st.ui.ticker.seriesId, someSeries.id, 'openSeries sets ticker seriesId');
  assertEqual(st.ui.ticker.mapIndex, 0, 'openSeries resets mapIndex');

  /* ------------------ continueSeason to the crowned champion ----------- */
  section('continueSeason to season end');

  let guard = 0;
  while (!selectSeason(store.getState()).complete && guard < 20) {
    continueSeason(store, { simEvent: true });
    guard += 1;
  }
  st = store.getState();

  assertEqual(selectSeason(st).complete, true, 'season completes');
  assertEqual(selectSlotsPlayed(st), 8, 'all 8 slots played');
  assertEqual(selectRoute(st).screen, 'champions', 'completion routes to champions');
  const field = selectChampionsField(st);
  assert(Array.isArray(field) && field.length === 16, 'champions field has 16 teams');
  const champion = selectChampion(st);
  assert(champion != null && field.includes(champion), 'champion is in the field');
  // CP standings are populated across the whole season.
  const cp = selectCPStandings(st);
  assert(cp.length > 0 && cp[0].cp >= cp[cp.length - 1].cp, 'CP standings sorted desc');

  /* ----------- continueSeason at season end runs the off-season -------- */
  section('continueSeason resolves the off-season into the next season');

  // At season end the career pauses in the 'offseason' phase (champion crowned).
  assertEqual(selectCareerPhase(st), 'offseason', 'a finished season is in the off-season phase');
  const indexBefore = selectSeasonIndex(st);

  continueSeason(store); // resolve the off-season -> start the next season
  st = store.getState();

  assertEqual(selectSeasonIndex(st), indexBefore + 1, 'the next season has begun');
  assertEqual(selectCareerPhase(st), 'inSeason', 'back in season');
  assertEqual(selectSeason(st).complete, false, 'the new season is not complete');
  assertEqual(selectSlotsPlayed(st), 0, 'the new season starts unplayed');
  assert(selectCareerHistory(st).length >= 1, 'the finished season was recorded in history');
}
