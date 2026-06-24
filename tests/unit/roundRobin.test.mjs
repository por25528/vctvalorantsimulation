/**
 * tests/unit/roundRobin.test.mjs — engine/format/roundRobin.js (CONTRACTS-FORMAT §4).
 *
 * Drives the round-robin tournament kind through the real match engine
 * (simSeries) with a deterministic seed factory and asserts:
 *  - single RR (rounds:1) over N teams produces exactly N*(N-1)/2 series;
 *  - double RR (rounds:2) produces N*(N-1) series (each pair twice);
 *  - standings are fully ranked (ranks 1..N unique, one row per entrant);
 *  - advancers = top `advancersOut`, in standings order;
 *  - every series carries stageId/matchId (SeriesRef) and a real engine result
 *    (maps with finalized scores, a winner that is one of the two teams);
 *  - determinism: same eventSeed -> deep-equal StageResult; inputs not mutated.
 *
 * All randomness flows through hashSeed-derived per-series seeds; no Math.random.
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { hashSeed } from '../../src/core/hash.js';
import { run, scheduleRoundRobin } from '../../src/engine/format/roundRobin.js';

/**
 * Build a world of N teams (each a distinct 5-man roster) + lookups.
 * Team i gets a small skill slant so outcomes vary across teams.
 * @param {number} n
 * @returns {{ entrants:string[], ctx:object }}
 */
function makeWorld(n) {
  const roles = ['Controller', 'Initiator', 'Sentinel', 'Duelist', 'Duelist'];
  /** @type {Record<string, object>} */
  const playersById = {};
  /** @type {Record<string, object>} */
  const teamsById = {};
  const entrants = [];
  for (let t = 0; t < n; t++) {
    const teamId = `T${t}`;
    const skill = 60 + t * 3; // 60, 63, 66, ... distinct strengths
    const roster = [];
    for (let i = 0; i < 5; i++) {
      const pid = `${teamId}_P${i}`;
      playersById[pid] = createPlayer({
        id: pid,
        name: pid,
        role: roles[i],
        attributes: {
          aim: skill, reaction: skill, movement: skill, gameSense: skill,
          trading: 70, composure: 70, utility: 60, igl: i === 0 ? 70 : 30
        }
      });
      roster.push(pid);
    }
    teamsById[teamId] = createTeam({ id: teamId, name: teamId, tag: teamId, roster });
    entrants.push(teamId);
  }
  return { entrants, ctx: { teamsById, playersById } };
}

/**
 * Deterministic per-series seed factory mirroring formatEngine.makeSeedFactory:
 * hashSeed(eventSeed, stageId, matchId).
 * @param {number} eventSeed
 * @param {string} stageId
 * @returns {(matchId:string)=>number}
 */
function makeSeedFactory(eventSeed, stageId) {
  return (matchId) => hashSeed(eventSeed, stageId, matchId);
}

export default async function roundRobinTest() {
  section('engine/format/roundRobin');

  // --- schedule sizes ------------------------------------------------------
  {
    for (const n of [2, 3, 5, 6, 8]) {
      const ids = Array.from({ length: n }, (_, i) => `T${i}`);
      const single = scheduleRoundRobin(ids, 1);
      const double = scheduleRoundRobin(ids, 2);
      assertEqual(single.length, (n * (n - 1)) / 2, `single RR has N*(N-1)/2 pairings (N=${n})`);
      assertEqual(double.length, n * (n - 1), `double RR has N*(N-1) pairings (N=${n})`);
      // match ids are unique within a schedule.
      const ids1 = new Set(single.map((p) => p.matchId));
      assertEqual(ids1.size, single.length, 'single RR match ids unique');
      const ids2 = new Set(double.map((p) => p.matchId));
      assertEqual(ids2.size, double.length, 'double RR match ids unique');
    }
  }

  // --- run(): single RR over N teams -> N*(N-1)/2 series --------------------
  {
    const N = 6;
    const { entrants, ctx } = makeWorld(N);
    const stage = {
      id: 'group',
      kind: 'roundRobin',
      seriesLen: { default: 3 },
      rounds: 1,
      advancersOut: 4
    };
    const result = run(stage, entrants, ctx, makeSeedFactory(12345, stage.id), null);

    assertEqual(result.kind, 'roundRobin', 'kind is roundRobin');
    assertEqual(result.stageId, 'group', 'stageId carried');
    assertEqual(result.series.length, (N * (N - 1)) / 2, 'single RR -> N*(N-1)/2 series');

    // Every series is a real engine result tagged as a SeriesRef.
    for (const s of result.series) {
      assert(typeof s.stageId === 'string' && s.stageId === 'group', 'series has stageId');
      assert(typeof s.matchId === 'string' && s.matchId.startsWith('RR-'), 'series has matchId');
      assert(Array.isArray(s.maps) && s.maps.length >= 2, 'series has played maps');
      assert(s.winnerId === s.teamAId || s.winnerId === s.teamBId, 'winner is one of the two teams');
      // Bo3: winner reaches 2 map wins.
      assert(Math.max(s.score.A, s.score.B) === 2, 'Bo3 clinches at 2 map wins');
    }

    // No team plays itself; each unordered pair appears exactly once.
    const pairs = new Set();
    for (const s of result.series) {
      assert(s.teamAId !== s.teamBId, 'no team plays itself');
      const key = [s.teamAId, s.teamBId].sort().join('|');
      assert(!pairs.has(key), `pair ${key} appears once`);
      pairs.add(key);
    }
    assertEqual(pairs.size, (N * (N - 1)) / 2, 'all distinct pairs covered');

    // --- standings ranked, one row per entrant, ranks 1..N unique ----------
    assertEqual(result.standings.length, N, 'one standings row per entrant');
    const ranks = result.standings.map((r) => r.rank);
    assertEqual(ranks, Array.from({ length: N }, (_, i) => i + 1), 'ranks 1..N in order');
    const standingTeams = new Set(result.standings.map((r) => r.teamId));
    assertEqual(standingTeams.size, N, 'every entrant present once in standings');
    for (const id of entrants) assert(standingTeams.has(id), `entrant ${id} in standings`);
    // Each team played N-1 series -> w + l === N-1.
    for (const r of result.standings) {
      assertEqual(r.w + r.l, N - 1, `${r.teamId} played N-1 series`);
    }

    // --- advancers = top advancersOut, in standings order ------------------
    assertEqual(result.advancers.length, 4, 'advancers count == advancersOut');
    assertEqual(
      result.advancers,
      result.standings.slice(0, 4).map((r) => r.teamId),
      'advancers are the top-4 standings teams in order'
    );
  }

  // --- run(): double RR -> N*(N-1) series ----------------------------------
  {
    const N = 4;
    const { entrants, ctx } = makeWorld(N);
    const stage = {
      id: 'dgroup',
      kind: 'roundRobin',
      seriesLen: { default: 3 },
      rounds: 2,
      advancersOut: 2
    };
    const result = run(stage, entrants, ctx, makeSeedFactory(777, stage.id), null);
    assertEqual(result.series.length, N * (N - 1), 'double RR -> N*(N-1) series');
    // Each pair played exactly twice.
    const counts = {};
    for (const s of result.series) {
      const key = [s.teamAId, s.teamBId].sort().join('|');
      counts[key] = (counts[key] || 0) + 1;
    }
    for (const key of Object.keys(counts)) {
      assertEqual(counts[key], 2, `pair ${key} played twice in double RR`);
    }
    assertEqual(result.advancers.length, 2, 'double RR advancers count');
    // Each team played 2*(N-1) series.
    for (const r of result.standings) {
      assertEqual(r.w + r.l, 2 * (N - 1), `${r.teamId} played 2*(N-1) series`);
    }
  }

  // --- determinism: same seed -> deep-equal; inputs untouched --------------
  {
    const N = 5;
    const { entrants, ctx } = makeWorld(N);
    const stage = { id: 'det', seriesLen: { default: 3 }, rounds: 1, advancersOut: 2 };
    const snapEntrants = JSON.stringify(entrants);

    const r1 = run(stage, entrants, ctx, makeSeedFactory(42, stage.id), null);
    const r2 = run(stage, entrants, ctx, makeSeedFactory(42, stage.id), null);
    assertEqual(r1, r2, 'same eventSeed -> identical StageResult');

    const r3 = run(stage, entrants, ctx, makeSeedFactory(43, stage.id), null);
    assert(
      JSON.stringify(r1.series) !== JSON.stringify(r3.series),
      'different eventSeed -> different series outcomes'
    );

    assertEqual(JSON.stringify(entrants), snapEntrants, 'entrants input not mutated');
  }

  // --- advancersOut absent/zero -> empty advancers -------------------------
  {
    const { entrants, ctx } = makeWorld(3);
    const stage = { id: 'noadv', seriesLen: { default: 3 }, rounds: 1 };
    const result = run(stage, entrants, ctx, makeSeedFactory(1, stage.id), null);
    assertEqual(result.advancers.length, 0, 'no advancersOut -> no advancers');
    assertEqual(result.standings.length, 3, 'standings still produced');
  }
}
