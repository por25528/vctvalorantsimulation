/**
 * tests/unit/seasonStep.test.mjs — the STEPPABLE SEASON API
 * (CONTRACTS-PERSIST §4).
 *
 * Verifies that the one-slot-at-a-time step API is provably equivalent to the
 * straight-through runner, and that log rehydration is deterministic:
 *
 *   1. Equivalence  — initSeason + advanceSeason×until-complete, then
 *                     seasonToResult, deep-equals simSeason(world, seed) for
 *                     several seeds (same per-slot seeds => byte-identical).
 *   2. Transitions  — isSeasonComplete is false until the last slot is played
 *                     (exactly CALENDAR.length advances), then true; slotIndex
 *                     marches 0..N; advancing a complete state is a no-op;
 *                     immutability (each advance returns a fresh state and never
 *                     mutates the prior one).
 *   3. Hydration    — stripping every maps[].rounds from a series then
 *                     hydrateSeries(...) reproduces the ORIGINAL maps deep-equal;
 *                     an already-hydrated series is returned as-is.
 *
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { buildWorld } from '../../src/data/seed/index.js';
import { CALENDAR } from '../../src/engine/career/calendar.js';
import {
  initSeason,
  advanceSeason,
  isSeasonComplete,
  seasonToResult,
  simSeason,
  hydrateSeries
} from '../../src/engine/career/season.js';

/** Deterministic structural fingerprint. */
function stable(v) {
  return JSON.stringify(v);
}

/** Deep clone via JSON (states are plain JSON-safe data). */
function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/** Strip every maps[].rounds from a series (the bulky log a save drops). */
function stripRounds(series) {
  return {
    ...series,
    maps: (series.maps || []).map((m) => {
      const { rounds, ...rest } = m; // eslint-disable-line no-unused-vars
      return rest;
    })
  };
}

export default async function seasonStepTest() {
  section('seasonStep — steppable season API == simSeason; hydrate is deterministic');

  const world = buildWorld();
  const seeds = [1, 2, 7, 42, 2026, 31337];

  for (const seed of seeds) {
    // === 1. EQUIVALENCE: step path === simSeason ===========================
    const expected = simSeason(world, seed);

    let state = initSeason(world, seed);
    assertEqual(state.slotIndex, 0, `seed ${seed}: initSeason starts at slotIndex 0`);
    assertEqual(state.events.length, 0, `seed ${seed}: initSeason has no events`);
    assertEqual(state.champion, null, `seed ${seed}: initSeason champion is null`);
    assertEqual(state.championsField, null, `seed ${seed}: initSeason championsField null`);
    assertEqual(state.m2Winner, null, `seed ${seed}: initSeason m2Winner null`);
    assertEqual(Object.keys(state.ledger.totals).length, 0,
      `seed ${seed}: initSeason ledger is empty`);
    assert(!isSeasonComplete(state), `seed ${seed}: fresh season is not complete`);

    // === 2. TRANSITIONS + IMMUTABILITY =====================================
    let advances = 0;
    while (!isSeasonComplete(state)) {
      const before = state;
      const beforeSnapshot = stable(before);
      const beforeIndex = before.slotIndex;

      state = advanceSeason(state, world);
      advances++;

      // Immutability: prior state untouched; a fresh object returned.
      assert(state !== before, `seed ${seed}: advance returns a new state object`);
      assertEqual(stable(before), beforeSnapshot,
        `seed ${seed}: advance does not mutate the prior state`);
      assertEqual(state.slotIndex, beforeIndex + 1,
        `seed ${seed}: slotIndex advances by exactly 1`);
      assert(advances <= CALENDAR.length + 1,
        `seed ${seed}: season completes within CALENDAR length`);
    }
    assertEqual(advances, CALENDAR.length,
      `seed ${seed}: exactly ${CALENDAR.length} advances complete the season`);
    assert(isSeasonComplete(state), `seed ${seed}: season is complete after all slots`);
    assertEqual(state.slotIndex, CALENDAR.length,
      `seed ${seed}: final slotIndex == calendar length`);

    // Advancing a complete state is a no-op (same reference back).
    const after = advanceSeason(state, world);
    assert(after === state, `seed ${seed}: advancing a complete season is a no-op`);

    // The assembled SeasonResult is byte-identical to simSeason's.
    const stepped = seasonToResult(state);
    assertEqual(stable(stepped), stable(expected),
      `seed ${seed}: stepped season deep-equals simSeason(world, seed)`);
    assertEqual(stepped.champion, expected.champion,
      `seed ${seed}: stepped champion matches`);
    assertEqual(stepped.championsField, expected.championsField,
      `seed ${seed}: stepped Champions field matches`);
    assertEqual(stepped.ledger.totals, expected.ledger.totals,
      `seed ${seed}: stepped CP totals match`);

    // Mid-stream state checks: m2Winner / championsField become non-null at the
    // right time (after m2 / champions slots, which are the last two events).
    assert(stepped.champion != null, `seed ${seed}: a champion is crowned`);
    assertEqual(state.championsField.length, 16,
      `seed ${seed}: championsField has 16 teams once reached`);
    assert(state.championsField.includes(state.m2Winner),
      `seed ${seed}: m2 winner is in the Champions field`);
  }

  // === isSeasonComplete transition is monotonic (false* then true) =========
  {
    const seed = 99;
    let state = initSeason(world, seed);
    const flags = [isSeasonComplete(state)];
    while (!isSeasonComplete(state)) {
      state = advanceSeason(state, world);
      flags.push(isSeasonComplete(state));
    }
    // Every flag false except the last.
    for (let i = 0; i < flags.length - 1; i++) {
      assertEqual(flags[i], false, `seed ${seed}: not complete at step ${i}`);
    }
    assertEqual(flags[flags.length - 1], true,
      `seed ${seed}: complete only at the final step`);
    assertEqual(flags.length, CALENDAR.length + 1,
      `seed ${seed}: one flag per state (init + ${CALENDAR.length} advances)`);
  }

  // === 3. HYDRATION: log-stripped series reproduces the original maps =======
  {
    const seed = 2026;
    const result = simSeason(world, seed);

    // Gather sample series spanning a regional event AND an international event,
    // and a multi-map (Bo3+) series so rounds[] are substantive.
    const regionalEntry = result.events.find((e) => e.scope === 'regional');
    const intlEntry = result.events.find((e) => e.slotId === 'champions');
    assert(regionalEntry && intlEntry, 'have a regional and an international event');

    const samples = [];
    for (const entry of [regionalEntry, intlEntry]) {
      const multi = entry.result.series.find((s) => s.maps.length >= 2)
        || entry.result.series[0];
      samples.push({ tag: `${entry.slotId}${entry.region ? ':' + entry.region : ''}`, series: multi });
    }

    for (const { tag, series } of samples) {
      // Sanity: the original carries real round logs.
      assert(series.maps.length > 0 && series.maps.every((m) => Array.isArray(m.rounds) && m.rounds.length > 0),
        `${tag}: original series has round logs`);

      const original = clone(series);
      const stripped = stripRounds(series);

      // Stripped really has no rounds.
      assert(stripped.maps.every((m) => !('rounds' in m)),
        `${tag}: stripped series carries no rounds`);

      const rehydrated = hydrateSeries(stripped, world);
      // Rounds restored, byte-identical to the original maps.
      assertEqual(rehydrated.maps, original.maps,
        `${tag}: hydrateSeries reproduces the original maps deep-equal`);
      // Whole series matches the original (id, score, veto, winner, maps).
      assertEqual(stable(clone(rehydrated)), stable(original),
        `${tag}: hydrated series deep-equals the original`);

      // Already-hydrated => returned as-is (same reference, no rework).
      const noop = hydrateSeries(series, world);
      assert(noop === series, `${tag}: already-hydrated series returned unchanged`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `seasonStep: ${seeds.length} seeds stepped == simSeason; ` +
    `isSeasonComplete transitions over ${CALENDAR.length} slots; ` +
    'hydrateSeries reproduces stripped logs deep-equal.');
}
