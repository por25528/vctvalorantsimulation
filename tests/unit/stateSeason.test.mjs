/**
 * tests/unit/stateSeason.test.mjs — STATE-layer season wiring
 * (CONTRACTS-PERSIST §5).
 *
 * Headless: builds the real root store and exercises the season slice +
 * season-aware commands + selectors:
 *   - bootstrap builds a 48-team / 240-player world and inits a fresh
 *     SeasonState at slotIndex 0 (nothing played, not complete);
 *   - continueSeason advances slotIndex and records events (a regional slot
 *     mirrors 4 region events into the events slice);
 *   - looping continueSeason to the end crowns a champion and fills the
 *     Champions field (16 teams);
 *   - saveCurrent -> loadSlot round-trips the full state through the
 *     module-level save manager (MemoryAdapter in Node).
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert, assertEqual, section } from '../_assert.mjs';

import { buildStore } from '../../src/state/createRootStore.js';
import {
  bootstrap,
  continueSeason,
  saveCurrent,
  loadSlot,
  DEFAULT_SEED
} from '../../src/state/commands.js';
import {
  selectSeason,
  selectCalendar,
  selectSlot,
  selectEvent,
  selectCPStandings,
  selectChampionsField,
  selectChampion,
  selectSlotsPlayed,
  selectTeams,
  selectFollowedTeam,
  selectKickoff
} from '../../src/state/selectors.js';

export default async function run() {
  /* ------------------------------ bootstrap ----------------------------- */
  section('stateSeason — bootstrap builds the world + inits the season');

  const store = buildStore();
  await bootstrap(store, { fresh: true });
  let st = store.getState();

  assertEqual(selectTeams(st).length, 48, 'bootstrap loads 48 teams');
  assertEqual(Object.keys(st.world.players).length, 240, 'bootstrap loads 240 players');
  assert(selectFollowedTeam(st) != null, 'bootstrap follows a default team');
  assertEqual(st.ui.route.screen, 'home', 'bootstrap lands on home');

  const season0 = selectSeason(st);
  assert(season0 != null, 'season initialised');
  // The CAREER is seeded with DEFAULT_SEED; each season's own seed is derived
  // from it (hashSeed(careerSeed, 'season', idx)), so it's a finite number.
  assertEqual(st.career.seed, DEFAULT_SEED, 'career seeded with DEFAULT_SEED');
  assertEqual(st.career.seasonIndex, 0, 'career starts at season 0');
  assert(Number.isFinite(season0.seed), 'season carries a derived numeric seed');
  assertEqual(season0.slotIndex, 0, 'season starts at slotIndex 0');
  assertEqual(season0.complete, false, 'season not complete at start');
  assertEqual(selectSlotsPlayed(st), 0, 'no slots played yet');
  assertEqual(selectCalendar(st).length, 9, 'calendar has 9 slots');
  assertEqual(st.events.order.length, 0, 'events mirror empty before any slot');

  /* --------------------------- continueSeason --------------------------- */
  section('continueSeason advances slotIndex + records events');

  // First slot is the regional Kickoff: 4 region events get mirrored.
  continueSeason(store, { simEvent: true });
  st = store.getState();

  assertEqual(selectSlotsPlayed(st), 1, 'slotIndex advanced to 1 after one Continue');
  const slot0 = selectSlot(st, 0);
  assert(slot0 != null && slot0.played, 'slot 0 marked played');
  assertEqual(slot0.entries.length, 4, 'regional kickoff slot produced 4 region events');
  assertEqual(st.events.order.length >= 4, true, 'events mirror holds the 4 region events');

  // The Pacific Kickoff event resolves both by composite id and legacy mirror.
  const pacKick = selectEvent(st, 'kickoff', 'pacific');
  assert(pacKick != null, 'selectEvent(slotId, region) resolves the regional event');
  assertEqual(pacKick.eventId, 'kickoff-pacific', 'composite event id is kickoff-pacific');
  assert(selectKickoff(st) != null, 'selectKickoff resolves a kickoff event');
  assert(st.events.byId['pacific-kickoff'] != null, 'legacy pacific-kickoff mirror present');

  // Each region event has 12 placements.
  assertEqual(pacKick.placements.length, 12, 'kickoff event has 12 placements');

  // CP standings are populated after the kickoff.
  const cp = selectCPStandings(st);
  assert(cp.length > 0, 'CP standings populated after kickoff');
  assert(cp.every((r) => Number.isFinite(r.cp) && r.cp >= 0), 'CP values finite + non-negative');

  /* --------------------- loop to the crowned champion ------------------- */
  section('continueSeason to season end crowns a champion');

  let guard = 0;
  while (!selectSeason(store.getState()).complete && guard < 20) {
    continueSeason(store, { simEvent: true });
    guard += 1;
  }
  st = store.getState();
  const season = selectSeason(st);

  assertEqual(season.complete, true, 'season completes');
  assertEqual(selectSlotsPlayed(st), 9, 'all 9 slots played');
  const field = selectChampionsField(st);
  assert(Array.isArray(field) && field.length === 16, 'champions field has 16 teams');
  assertEqual(new Set(field).size, 16, 'champions field teams are unique');
  const champion = selectChampion(st);
  assert(champion != null, 'a champion is crowned');
  assert(field.includes(champion), 'champion is in the champions field');
  assert(st.world.teams[champion] != null, 'champion is a real team');

  // 21 event entries total (4 kickoff + 1 m0 + 4 stage1 + 1 m1 + 4 stage2 + 1 m2 + 4 stage3 + 1 lcq + 1 champions).
  assertEqual(season.events.length, 21, 'season recorded 21 event entries');

  // The events mirror holds every season event id (+ the legacy alias).
  for (const entry of season.events) {
    assert(st.events.byId[entry.result.eventId] != null, `event ${entry.result.eventId} mirrored`);
  }

  /* --------------------------- save -> load ----------------------------- */
  section('saveCurrent -> loadSlot restores state via MemoryAdapter');

  const meta = await saveCurrent(store, 'My Career');
  assert(meta && meta.id, 'saveCurrent returns a meta with an id');
  assertEqual(meta.name, 'My Career', 'slot named as given');

  // Mutate a fresh store, then load the saved slot into it.
  const store2 = buildStore();
  await bootstrap(store2, { fresh: true });
  // Fresh store2's season is unplayed.
  assertEqual(selectSlotsPlayed(store2.getState()), 0, 'store2 starts unplayed');

  const loaded = await loadSlot(store2, meta.id);
  assertEqual(loaded, true, 'loadSlot succeeded');
  const st2 = store2.getState();

  const season2 = selectSeason(st2);
  assert(season2 != null, 'loaded season present');
  assertEqual(season2.complete, true, 'loaded season is complete');
  assertEqual(selectChampion(st2), champion, 'loaded champion matches saved champion');
  assertEqual(season2.events.length, 21, 'loaded season has 21 events');
  assertEqual(selectSlotsPlayed(st2), 9, 'loaded season at slotIndex 9');
  assertEqual(st2.ui.route.screen, 'home', 'loadSlot routes home');
  assertEqual(selectChampionsField(st2).length, 16, 'loaded champions field intact');

  // eslint-disable-next-line no-console
  console.log(
    `stateSeason: bootstrap 48 teams/240 players; continued to a champion ` +
      `(${champion}); 21 events mirrored; saveCurrent->loadSlot restored state ` +
      `via MemoryAdapter.`
  );
}
