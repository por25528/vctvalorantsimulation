/**
 * tests/ui/screens-home.test.mjs — HOME + CALENDAR screens (CONTRACTS-PERSIST §6).
 *
 * Phase 5 rewired both screens to the FULL 4-league season (8 calendar slots),
 * so this suite validates the multi-slot behaviour rather than the old single-
 * Kickoff model. Headless via toHtml (no DOM). Builds the real root store, then:
 *   - renders Home on a FRESH season (slot 1 of 8): Continue enabled, the
 *     season-progress + followed-team + season-path cards present;
 *   - runs ONE Continue (the Kickoff slot) and asserts the season is NOT yet
 *     complete, Continue STILL says "Continue" (7 slots remain), and the followed
 *     team's path now lists its Kickoff result;
 *   - steps the WHOLE season to a champion and asserts Home shows the champion
 *     banner + a disabled "Season complete" button;
 *   - renders the Calendar and asserts it lists the Kickoff (slot name + Pacific
 *     league row) with played/upcoming status badges.
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { HomeInbox } from '../../src/ui/screens/HomeInbox.js';
import { Calendar } from '../../src/ui/screens/Calendar.js';
import {
  selectSeason,
  selectSlotsPlayed,
  selectChampion,
  selectSeasonIndex
} from '../../src/state/selectors.js';

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const dispatch = store.dispatch;

  // ---- Home on a FRESH season (nothing played, slot 1 of 8) ------------
  const beforeHtml = toHtml(HomeInbox(store.getState(), dispatch, store));
  assert(beforeHtml.includes('screen--home'), 'home screen renders before sim');
  assert(beforeHtml.includes('>Continue</span>'), 'Continue CTA present + enabled before sim');
  assert(!beforeHtml.includes('disabled'), 'Continue is enabled while the season is in progress');
  assert(beforeHtml.includes('home__followed'), 'followed-team card present');
  assert(beforeHtml.includes('Season Progress'), 'season-progress card present');
  assert(beforeHtml.includes('of 8'), 'progress reflects the 8-slot season');
  assert(beforeHtml.includes('Season Path'), 'followed-team season-path card present');

  // ---- run ONE slot (the Kickoff) — season is NOT complete (1 of 8) ----
  continueSeason(store);
  let state = store.getState();
  assert(selectSlotsPlayed(state) === 1, 'one calendar slot played after one Continue');
  assert(!selectSeason(state).complete, 'season is NOT complete after only the Kickoff');

  const afterHtml = toHtml(HomeInbox(state, dispatch, store));
  assert(afterHtml.includes('screen--home'), 'home screen renders after the Kickoff');
  assert(afterHtml.includes('>Continue</span>'), 'Continue still says "Continue" mid-season');
  assert(
    !afterHtml.includes('>Season complete</span>'),
    'Continue is NOT "Season complete" after only one of eight slots'
  );
  // the followed team (a Pacific side) now has a Kickoff entry in its path
  assert(
    afterHtml.includes('home__path-item'),
    'followed-team season path lists the Kickoff result after one Continue'
  );
  assert(!afterHtml.includes('home-champion-banner'), 'no champion banner mid-season');

  // ---- step the WHOLE season to a champion (simEvent reveals each slot at once) -
  let guard = 0;
  while (!selectSeason(store.getState()).complete && guard++ < 20) continueSeason(store, { simEvent: true });
  state = store.getState();
  assert(selectSeason(state).complete, 'season completes after stepping every calendar slot');
  const championId = selectChampion(state);
  assert(championId, 'a World Champion is crowned once the season completes');

  // The career pauses in the off-season: champion banner shows, but Continue
  // stays live (it rolls into the off-season, not a dead-end "Season complete").
  const doneHtml = toHtml(HomeInbox(state, dispatch, store));
  assert(doneHtml.includes('home-champion-banner'), 'champion banner shown at season end');
  assert(doneHtml.includes('>Continue</span>'), 'Continue stays live at season end (off-season ahead)');
  assert(!doneHtml.includes('disabled'), 'Continue is NOT disabled — the career is endless');
  assert(doneHtml.includes('Off-season'), 'home prompts the off-season once the season is decided');
  const champName = (state.world.teams[championId] || {}).name || championId;
  assert(doneHtml.includes(champName), 'champion banner names the crowned World Champion');
  // The trophy marker is now a cross-platform inline icon, not a tofu-prone emoji.
  assert(doneHtml.includes('home__champion-trophy'), 'champion banner renders the trophy icon');
  assert(doneHtml.includes('<svg') && !doneHtml.includes('🏆'), 'champion banner uses an svg icon, not an emoji');

  // Continuing again resolves the off-season and starts the next season.
  continueSeason(store);
  const nextState = store.getState();
  assert(selectSeasonIndex(nextState) === 1, 'a second season has begun after the off-season');
  assert(!selectSeason(nextState).complete, 'the new season is not complete');

  // Home renders with NO store (render-only / inert Continue) without throwing.
  const inertHtml = toHtml(HomeInbox(state, dispatch));
  assert(inertHtml.includes('screen--home'), 'home renders without a store reference');

  // ---- Calendar reflects the season ------------------------------------
  const calHtml = toHtml(Calendar(state, dispatch, store));
  assert(calHtml.includes('screen--calendar'), 'calendar screen renders');
  assert(calHtml.includes('>Kickoff<'), 'calendar lists the Kickoff slot');
  assert(calHtml.includes('Pacific'), 'calendar lists the Pacific league row under the Kickoff');
  assert(calHtml.includes('calendar__slot-status'), 'calendar slot carries a status badge');
  assert(calHtml.includes('Played'), 'played events show a Played status');
  // Winner rows mark the champion with the inline trophy icon (no emoji tofu).
  assert(calHtml.includes('calendar__event-trophy'), 'played-event winner carries the trophy icon');
  assert(!calHtml.includes('🏆'), 'calendar no longer ships the trophy emoji');

  // A FRESH (unplayed) calendar shows the Up next / Upcoming badges.
  const freshStore = buildStore();
  await bootstrap(freshStore, { fresh: true });
  const preCalHtml = toHtml(Calendar(freshStore.getState(), freshStore.dispatch, freshStore));
  assert(preCalHtml.includes('Up next'), 'the current slot shows "Up next" before any sim');
  assert(preCalHtml.includes('Upcoming'), 'later slots show "Upcoming" before any sim');
}
