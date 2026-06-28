/**
 * tests/unit/replay.test.mjs — the OPTIONAL match replay timeline.
 *
 * Proves the replay output is ADDITIVE & DETERMINISTIC (the workstream's core
 * invariant): enabling `{ replay: true }` must NOT change any existing result —
 * a series simulated with replay, minus its `replay` fields, is byte-identical to
 * the same series simulated without it. Also proves the UI reconstruction
 * (`deriveMapReplay`) recovers the engine's true per-round momentum/ult/score
 * from a plain MapResult (no `replay`) exactly.
 *
 * Default export is an async fn that throws on failure (per CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { PACIFIC_SEED } from '../../src/data/seed/pacific.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { simSeries } from '../../src/engine/match/matchSim.js';
import { deriveMapReplay } from '../../src/ui/replayDerive.js';

/** Boolean deep equality (mirrors tests/_assert deepEqual). */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/** Strip the optional `replay` field from every map of a series (deep clone). */
function stripReplay(series) {
  const clone = JSON.parse(JSON.stringify(series));
  if (Array.isArray(clone.maps)) {
    for (const m of clone.maps) {
      if (m && Object.prototype.hasOwnProperty.call(m, 'replay')) delete m.replay;
    }
  }
  return clone;
}

function normalizeWorld() {
  const playersById = {};
  for (const partial of PACIFIC_SEED.players) {
    const p = createPlayer(partial);
    playersById[p.id] = p;
  }
  const teamsById = {};
  for (const partial of PACIFIC_SEED.teams) {
    const t = createTeam(partial);
    teamsById[t.id] = t;
  }
  return { playersById, teamsById };
}

export default async function replayTest() {
  const { playersById, teamsById } = normalizeWorld();
  const ids = Object.keys(teamsById);
  assert(ids.length >= 2, 'need at least 2 teams');
  const teamA = teamsById[ids[0]];
  const teamB = teamsById[ids[1]];
  const SEED = 4242;

  section('replay — additive: enabling it does not change existing results');

  const plain = simSeries(teamA, teamB, playersById, 3, SEED);
  const withReplay = simSeries(teamA, teamB, playersById, 3, SEED, { replay: true });

  // Every played map carries a replay of exactly score-sum length.
  for (let i = 0; i < withReplay.maps.length; i++) {
    const m = withReplay.maps[i];
    assert(Array.isArray(m.replay), `map ${i}: replay array present when requested`);
    assertEqual(m.replay.length, m.rounds.length, `map ${i}: one replay entry per round`);
    const last = m.replay[m.replay.length - 1];
    assertEqual(last.score.A, m.score.A, `map ${i}: replay final score.A matches`);
    assertEqual(last.score.B, m.score.B, `map ${i}: replay final score.B matches`);
  }

  // The plain run must NOT carry replay at all (default shape untouched).
  for (let i = 0; i < plain.maps.length; i++) {
    assert(!Object.prototype.hasOwnProperty.call(plain.maps[i], 'replay'), `map ${i}: no replay field by default`);
  }

  // Byte-identical existing results: strip replay, compare to the plain series.
  assert(
    deepEqual(stripReplay(withReplay), plain),
    'series with replay (minus the replay field) is byte-identical to the plain series'
  );

  section('replay — reconstruction recovers the engine timeline from plain maps');

  for (let i = 0; i < plain.maps.length; i++) {
    const reconstructed = deriveMapReplay(plain.maps[i]).rounds; // no engine replay present
    const engine = withReplay.maps[i].replay;
    assertEqual(reconstructed.length, engine.length, `map ${i}: reconstruction has one row per round`);
    for (let r = 0; r < engine.length; r++) {
      const rec = reconstructed[r];
      const eng = engine[r];
      assertEqual(rec.n, eng.n, `map ${i} r${r}: round number`);
      assertEqual(rec.winnerTeam, eng.winnerTeam, `map ${i} r${r}: winner`);
      assertEqual(rec.score.A, eng.score.A, `map ${i} r${r}: score.A`);
      assertEqual(rec.score.B, eng.score.B, `map ${i} r${r}: score.B`);
      assertEqual(rec.ult.A, eng.ultReady.A, `map ${i} r${r}: ult A`);
      assertEqual(rec.ult.B, eng.ultReady.B, `map ${i} r${r}: ult B`);
      assert(Math.abs(rec.momentum.A - eng.momentumAfter.A) < 1e-9, `map ${i} r${r}: momentum A matches engine`);
      assert(Math.abs(rec.momentum.B - eng.momentumAfter.B) < 1e-9, `map ${i} r${r}: momentum B matches engine`);
    }
  }

  section('replay — deriveMapReplay summary is well-formed');

  const model = deriveMapReplay(withReplay.maps[0]);
  assert(model.summary && typeof model.summary === 'object', 'summary present');
  assert(model.summary.winner === 'A' || model.summary.winner === 'B', 'summary names a winner');
  assert(model.summary.totalRounds === model.rounds.length, 'summary round count matches');
  // The map is decided exactly once (the final round ends it).
  const decidedRounds = model.rounds.filter((r) => r.decided).length;
  assertEqual(decidedRounds, 1, 'exactly one round is flagged as deciding the map');

  // eslint-disable-next-line no-console
  console.log(
    `replay: Bo3 ${teamA.id} vs ${teamB.id} — ${withReplay.maps.length} maps, replay additive + reconstruction exact`
  );
}
