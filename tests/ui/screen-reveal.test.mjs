/**
 * tests/ui/screen-reveal.test.mjs — the match-day reveal + spoiler gating.
 *
 * Covers the reveal slice reducer, the day-by-day `continueSeason` stepping, the
 * spoiler-gated selectors (Standings/Bracket/Leaders clipped to revealed series),
 * the "Sim event" fast-forward, the MatchDay screen, and the v3→v4 migration.
 * Headless via toHtml + the real store. Default-exported async fn (run.mjs).
 */

import { assert } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { revealReducer, initialRevealState } from '../../src/state/slices/reveal.js';
import { setReveal, advanceReveal, revealToEnd, resetReveal } from '../../src/state/actions.js';
import { MatchDayScreen } from '../../src/ui/screens/MatchDay.js';
import { migrate, SCHEMA_VERSION } from '../../src/persistence/migrations.js';
import {
  selectKickoff,
  selectPlacements,
  selectStandings,
  selectCurrentMatchDay,
  selectMatchDaySeries,
  selectRevealInProgress,
  selectRevealDay,
  selectRevealTotalDays
} from '../../src/state/selectors.js';

export default async function run() {
  /* ----------------------------- reveal reducer ---------------------------- */
  const sched = [
    { dayIndex: 0, refs: [] },
    { dayIndex: 1, refs: [] },
    { dayIndex: 2, refs: [] }
  ];
  let r = revealReducer(initialRevealState, setReveal({ slotId: 'kickoff', schedule: sched, dayIndex: 0 }));
  assert(r.slotId === 'kickoff' && r.totalDays === 3 && r.dayIndex === 0, 'setReveal installs the schedule');
  r = revealReducer(r, advanceReveal());
  assert(r.dayIndex === 1, 'advanceReveal steps +1');
  r = revealReducer(revealReducer(r, advanceReveal()), advanceReveal());
  assert(r.dayIndex === 2, 'advanceReveal clamps to the last day');
  let r2 = revealReducer(initialRevealState, setReveal({ slotId: 'x', schedule: sched, dayIndex: 0 }));
  r2 = revealReducer(r2, revealToEnd());
  assert(r2.dayIndex === 2, 'revealToEnd jumps to the last day');
  assert(revealReducer(r2, resetReveal()).slotId === null, 'resetReveal clears the cursor');

  /* --------------------- day-stepping + spoiler gating --------------------- */
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const st = () => store.getState();

  // First Continue starts the Kickoff and reveals only day 1.
  continueSeason(store);
  assert(selectRevealInProgress(st()), 'a slot is revealing after the first Continue');
  assert(selectRevealDay(st()) === 0, 'on match-day 0');
  const total = selectRevealTotalDays(st());
  assert(total >= 9, `Kickoff has many match-days (got ${total})`);
  assert(st().ui.route.screen === 'matchday', 'the first Continue lands on the Match Day screen');

  const day0 = selectCurrentMatchDay(st());
  assert(day0 && day0.refs.length > 0, 'the current match-day has games');
  const mdSeries = selectMatchDaySeries(st());
  assert(mdSeries.length === day0.refs.length, 'every match-day ref resolves to a game');
  assert(mdSeries.every((g) => g.series), 'each resolved game carries its series');

  // Spoiler gating: the Kickoff event is clipped to revealed series, no placements.
  const fullSeries = st().events.byId['kickoff-pacific'].series.length;
  assert(selectKickoff(st()).series.length < fullSeries, 'Kickoff is gated to revealed series only');
  assert(selectPlacements(st(), 'kickoff-pacific').length === 0, 'no final placements mid-reveal');
  // partial group standings still render (every team, partial records)
  assert(selectStandings(st(), 'kickoff-pacific', 'groupA').length === 6, 'gated group standings keep all teams');

  // The MatchDay screen renders the day's games + counter.
  const mdHtml = toHtml(MatchDayScreen(st(), store.dispatch, store));
  assert(mdHtml.includes('matchday__game'), 'MatchDay screen lists games');
  assert(mdHtml.includes('Day 1 /'), 'MatchDay screen shows the day counter');

  // Advancing a day reveals strictly more series.
  const before = selectKickoff(st()).series.length;
  continueSeason(store);
  assert(selectKickoff(st()).series.length > before, 'advancing a day reveals more series');

  // "Sim event" fast-forwards to the end: full event + final placements appear.
  continueSeason(store, { simEvent: true });
  assert(!selectRevealInProgress(st()), 'the slot is fully revealed after Sim event');
  assert(selectKickoff(st()).series.length === fullSeries, 'every Kickoff series is visible once complete');
  assert(selectPlacements(st(), 'kickoff-pacific').length === 12, 'final placements appear once the event completes');

  /* --------------------------- v3 -> v4 migration -------------------------- */
  const v3 = {
    meta: { schemaVersion: 3, seed: 1, name: 'x', id: 's', slotIndex: 0, createdAt: 0, lastPlayed: 0 },
    world: {}, season: {}, inbox: [], settings: { followedTeamId: null }
  };
  const migrated = migrate(v3);
  assert(migrated.meta.schemaVersion === SCHEMA_VERSION, 'migrated to the current schema version');
  assert('reveal' in migrated && migrated.reveal === null, 'v3→v4 adds a null reveal cursor');
}
