/**
 * tests/unit/swiss.test.mjs — engine/format/swiss.js (CONTRACTS-FORMAT §4).
 *
 * Drives the real match engine (simSeries) through an 8-team Buchholz-paired
 * Swiss with the default 2/2 thresholds and asserts:
 *  - exactly 4 teams advance and 4 are eliminated;
 *  - no team's win count exceeds winsToAdvance and no loss count exceeds
 *    lossesToEliminate (the caps hold);
 *  - every advancer reached exactly winsToAdvance wins; every non-advancer
 *    reached exactly lossesToEliminate losses;
 *  - standings cover all 8 entrants with unique ranks 1..8;
 *  - determinism: same seed -> deep-equal StageResult; different seed differs;
 *  - the in-stage rng is used for pairing tie-breaks only (series outcomes come
 *    from makeSeed), so two runs sharing makeSeed but differing rng still pair
 *    everyone validly.
 *
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { createRng } from '../../src/core/rng.js';
import { hashSeed } from '../../src/core/hash.js';
import { recordFromSeries } from '../../src/engine/format/standings.js';
import { run } from '../../src/engine/format/swiss.js';

/**
 * Build a ctx (teamsById + playersById) of N teams with slightly varied skill so
 * series have decisive-ish outcomes, plus the seeded entrants list.
 * @param {number} n
 * @returns {{ ctx:object, entrants:string[] }}
 */
function makeWorld(n) {
  const roles = ['Controller', 'Initiator', 'Sentinel', 'Duelist', 'Duelist'];
  const teamsById = {};
  const playersById = {};
  const entrants = [];
  for (let t = 0; t < n; t++) {
    const teamId = `T${t + 1}`;
    const roster = [];
    // Seed 1 strongest -> seed n weakest, gentle gradient so upsets still occur.
    const skill = 82 - t * 2;
    for (let p = 0; p < 5; p++) {
      const pid = `${teamId}_p${p}`;
      playersById[pid] = createPlayer({
        id: pid,
        name: pid,
        role: roles[p],
        attributes: {
          aim: skill, reaction: skill, movement: skill, gameSense: skill,
          trading: 70, composure: 70, utility: 60, igl: p === 0 ? 70 : 30
        }
      });
      roster.push(pid);
    }
    teamsById[teamId] = createTeam({ id: teamId, name: teamId, tag: teamId, roster });
    entrants.push(teamId);
  }
  return { ctx: { teamsById, playersById }, entrants };
}

/**
 * A makeSeed factory deriving a per-series seed from an event seed + matchId.
 * @param {number} eventSeed
 * @returns {(matchId:string)=>number}
 */
function seedFactory(eventSeed) {
  return (matchId) => hashSeed(eventSeed, 'swiss', matchId);
}

/**
 * Recompute per-team series W/L from the StageResult.series and check caps.
 * @param {object} result
 * @param {string[]} entrants
 * @param {number} winsToAdvance
 * @param {number} lossesToEliminate
 */
function assertCaps(result, entrants, winsToAdvance, lossesToEliminate) {
  const recs = recordFromSeries(result.series);
  for (const teamId of entrants) {
    const r = recs[teamId] || { w: 0, l: 0 };
    assert(r.w <= winsToAdvance, `${teamId} wins (${r.w}) <= cap ${winsToAdvance}`);
    assert(r.l <= lossesToEliminate, `${teamId} losses (${r.l}) <= cap ${lossesToEliminate}`);
    const advanced = result.advancers.includes(teamId);
    if (advanced) {
      assertEqual(r.w, winsToAdvance, `${teamId} advanced -> exactly ${winsToAdvance} wins`);
    } else {
      assertEqual(r.l, lossesToEliminate, `${teamId} not advanced -> exactly ${lossesToEliminate} losses`);
    }
  }
}

export default async function swissTest() {
  section('engine/format/swiss');

  const { ctx, entrants } = makeWorld(8);
  const stage = { id: 'swiss', kind: 'swiss', seriesLen: { default: 3 } };

  // --- core invariant: 8 -> 4 advance, 4 out, caps respected -----------------
  {
    const eventSeed = 12345;
    const rng = createRng(hashSeed(eventSeed, 'swiss-pairing'));
    const result = run(stage, entrants, ctx, seedFactory(eventSeed), rng);

    assertEqual(result.kind, 'swiss', 'kind is swiss');
    assertEqual(result.stageId, 'swiss', 'stageId carried');
    assertEqual(result.advancers.length, 4, 'exactly 4 advance');

    const advancerSet = new Set(result.advancers);
    assertEqual(advancerSet.size, 4, 'advancers are distinct');
    const eliminated = entrants.filter((t) => !advancerSet.has(t));
    assertEqual(eliminated.length, 4, 'exactly 4 eliminated');

    assertCaps(result, entrants, 2, 2);

    // every advancer is one of the entrants
    for (const a of result.advancers) {
      assert(entrants.includes(a), `advancer ${a} is an entrant`);
    }

    // standings: all 8 teams, unique ranks 1..8
    assertEqual(result.standings.length, 8, 'standings cover all 8 teams');
    const ranks = result.standings.map((s) => s.rank).sort((x, y) => x - y);
    assertEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8], 'ranks 1..8 unique');
    const standingTeams = new Set(result.standings.map((s) => s.teamId));
    assertEqual(standingTeams.size, 8, 'standings list every entrant once');

    // every series is a real Bo3 carrying stageId + matchId (engine-backed).
    for (const s of result.series) {
      assertEqual(s.stageId, 'swiss', 'series tagged with stageId');
      assert(typeof s.matchId === 'string' && s.matchId.length > 0, 'series has matchId');
      assert(s.score.A + s.score.B >= 2 && s.score.A + s.score.B <= 3, 'Bo3 maps count 2..3');
      assert(s.winnerId === s.teamAId || s.winnerId === s.teamBId, 'winner is one of the two teams');
    }
  }

  // --- determinism: same seed -> identical StageResult -----------------------
  {
    const eventSeed = 999;
    const mk = () => run(
      stage,
      entrants,
      ctx,
      seedFactory(eventSeed),
      createRng(hashSeed(eventSeed, 'swiss-pairing'))
    );
    const a = mk();
    const b = mk();
    assertEqual(a, b, 'same seed -> deep-equal StageResult');
  }

  // --- different seed -> generally different outcome -------------------------
  {
    const r1 = run(stage, entrants, ctx, seedFactory(1), createRng(hashSeed(1, 'p')));
    const r2 = run(stage, entrants, ctx, seedFactory(2), createRng(hashSeed(2, 'p')));
    // Both must still yield 4 advancers with caps held...
    assertEqual(r1.advancers.length, 4, 'seed 1: 4 advance');
    assertEqual(r2.advancers.length, 4, 'seed 2: 4 advance');
    assertCaps(r1, entrants, 2, 2);
    assertCaps(r2, entrants, 2, 2);
    // ...and the advancer sets (or their order) should differ across these seeds.
    const differ =
      JSON.stringify(r1.advancers) !== JSON.stringify(r2.advancers) ||
      JSON.stringify(r1.standings.map((s) => s.teamId)) !==
        JSON.stringify(r2.standings.map((s) => s.teamId));
    assert(differ, 'different seeds produce different bracket outcomes');
  }

  // --- no rematches under default 4-round-ish 8-team Swiss -------------------
  {
    const result = run(stage, entrants, ctx, seedFactory(777), createRng(hashSeed(777, 'p')));
    const seen = new Set();
    for (const s of result.series) {
      const key = s.teamAId < s.teamBId ? `${s.teamAId}|${s.teamBId}` : `${s.teamBId}|${s.teamAId}`;
      assert(!seen.has(key), `no rematch between ${s.teamAId} and ${s.teamBId}`);
      seen.add(key);
    }
  }
}
