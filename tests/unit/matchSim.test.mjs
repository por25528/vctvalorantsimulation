/**
 * tests/unit/matchSim.test.mjs — engine/match/matchSim.js (CONTRACTS §9, §10, §14).
 *
 * Over many seeded series, asserts simSeries' series-level invariants:
 *  - a Bo3 ends 2-0 or 2-1; a Bo5 ends 3-x (x in 0..2); the winner reaches
 *    ceil(bestOf/2) map wins and the loser stays below it;
 *  - winnerId is the team id with the majority of map wins;
 *  - maps.length is within the best-of range (clinchWins .. bestOf);
 *  - the veto pick record is carried through onto the Series;
 *  - determinism: same seed -> deep-equal Series; different seed -> differs.
 *
 * Deterministic: all randomness via createRng(seed) inside simSeries; no
 * Math.random. Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { simSeries } from '../../src/engine/match/matchSim.js';

/**
 * Build a players lookup + two teams (each a 5-man roster). Optional per-side
 * skill slant lets a test bias one team.
 * @param {{aSkill?:number, bSkill?:number}} [opts]
 * @returns {{ players:Record<string,object>, teamA:object, teamB:object }}
 */
function makeWorld(opts = {}) {
  const aSkill = typeof opts.aSkill === 'number' ? opts.aSkill : 75;
  const bSkill = typeof opts.bSkill === 'number' ? opts.bSkill : 75;
  /** @type {Record<string, object>} */
  const players = {};
  const rosterA = [];
  const rosterB = [];
  const roles = ['Controller', 'Initiator', 'Sentinel', 'Duelist', 'Duelist'];
  for (let i = 0; i < 5; i++) {
    const aId = `A${i}`;
    const bId = `B${i}`;
    players[aId] = createPlayer({
      id: aId,
      name: aId,
      role: roles[i],
      attributes: {
        aim: aSkill, reaction: aSkill, movement: aSkill, gameSense: aSkill,
        trading: 70, composure: 70, utility: 60, igl: i === 0 ? 70 : 30
      }
    });
    players[bId] = createPlayer({
      id: bId,
      name: bId,
      role: roles[i],
      attributes: {
        aim: bSkill, reaction: bSkill, movement: bSkill, gameSense: bSkill,
        trading: 70, composure: 70, utility: 60, igl: i === 0 ? 70 : 30
      }
    });
    rosterA.push(aId);
    rosterB.push(bId);
  }
  const teamA = createTeam({ id: 'TA', name: 'Team A', tag: 'TA', roster: rosterA });
  const teamB = createTeam({ id: 'TB', name: 'Team B', tag: 'TB', roster: rosterB });
  return { players, teamA, teamB };
}

/**
 * Validate a finished Series' structure + invariants for a given bestOf.
 * @param {object} s
 * @param {number} bestOf
 * @param {string} ctx
 */
function checkSeries(s, bestOf, ctx) {
  const clinch = Math.floor(bestOf / 2) + 1;

  assert(s && typeof s === 'object', `${ctx}: returns a Series object`);
  assertEqual(s.bestOf, bestOf, `${ctx}: bestOf echoed`);
  assert(typeof s.id === 'string' && s.id.length > 0, `${ctx}: id is a non-empty string`);
  assertEqual(s.teamAId, 'TA', `${ctx}: teamAId echoed`);
  assertEqual(s.teamBId, 'TB', `${ctx}: teamBId echoed`);
  assert(s.veto && Array.isArray(s.veto.picks), `${ctx}: veto.picks present`);
  assert(Array.isArray(s.maps), `${ctx}: maps is an array`);

  const a = s.score.A;
  const b = s.score.B;
  const max = Math.max(a, b);
  const min = Math.min(a, b);

  // Winner reaches the clinch count; loser stays strictly below it.
  assertEqual(max, clinch, `${ctx}: winner reaches ceil(bestOf/2) = ${clinch} (score ${a}-${b})`);
  assert(min < clinch, `${ctx}: loser below clinch (score ${a}-${b})`);

  // maps.length === total map wins, and within [clinch, bestOf].
  assertEqual(s.maps.length, a + b, `${ctx}: maps.length === score.A + score.B`);
  assert(s.maps.length >= clinch && s.maps.length <= bestOf,
    `${ctx}: maps.length ${s.maps.length} within [${clinch}, ${bestOf}]`);

  // Each played map's winner contributes to the running score consistently.
  let recountA = 0;
  let recountB = 0;
  for (const m of s.maps) {
    assert(m.winner === 'A' || m.winner === 'B', `${ctx}: map winner valid`);
    if (m.winner === 'A') recountA += 1;
    else recountB += 1;
  }
  assertEqual(recountA, a, `${ctx}: score.A matches map wins`);
  assertEqual(recountB, b, `${ctx}: score.B matches map wins`);

  // winnerId is the team with the majority of map wins.
  const expectedWinnerId = a > b ? s.teamAId : s.teamBId;
  assertEqual(s.winnerId, expectedWinnerId, `${ctx}: winnerId matches majority`);
}

export default async function matchSimTest() {
  section('engine/match/matchSim');

  // --- Bo3: ends 2-0 or 2-1 across many seeds -------------------------------
  {
    const seen = new Set();
    for (let seed = 0; seed < 80; seed++) {
      const { players, teamA, teamB } = makeWorld();
      const s = simSeries(teamA, teamB, players, 3, 1000 + seed);
      checkSeries(s, 3, `Bo3 seed ${seed}`);
      const max = Math.max(s.score.A, s.score.B);
      const min = Math.min(s.score.A, s.score.B);
      assertEqual(max, 2, `Bo3 seed ${seed}: winner has 2 map wins`);
      assert(min === 0 || min === 1, `Bo3 seed ${seed}: result is 2-0 or 2-1`);
      seen.add(`${max}-${min}`);
    }
    // Both 2-0 and 2-1 outcomes should appear across 80 even matchups.
    assert(seen.has('2-0') && seen.has('2-1'), 'Bo3 yields both 2-0 and 2-1 across seeds');
  }

  // --- Bo5: ends 3-x (x in 0..2) across many seeds --------------------------
  {
    const seen = new Set();
    for (let seed = 0; seed < 80; seed++) {
      const { players, teamA, teamB } = makeWorld();
      const s = simSeries(teamA, teamB, players, 5, 2000 + seed);
      checkSeries(s, 5, `Bo5 seed ${seed}`);
      const max = Math.max(s.score.A, s.score.B);
      const min = Math.min(s.score.A, s.score.B);
      assertEqual(max, 3, `Bo5 seed ${seed}: winner has 3 map wins`);
      assert(min >= 0 && min <= 2, `Bo5 seed ${seed}: result is 3-x with x in 0..2`);
      seen.add(min);
    }
    // Multiple loser-scores (e.g. 3-0/3-1/3-2) should appear across seeds.
    assert(seen.size >= 2, 'Bo5 yields a spread of loser scores across seeds');
  }

  // --- Bo1: ends 1-0; exactly one map -------------------------------------
  {
    const { players, teamA, teamB } = makeWorld();
    const s = simSeries(teamA, teamB, players, 1, 31337);
    checkSeries(s, 1, 'Bo1');
    assertEqual(s.maps.length, 1, 'Bo1 plays exactly one map');
  }

  // --- winnerId tracks the stronger team in a lopsided matchup --------------
  {
    let aWins = 0;
    const trials = 40;
    for (let seed = 0; seed < trials; seed++) {
      const { players, teamA, teamB } = makeWorld({ aSkill: 92, bSkill: 56 });
      const s = simSeries(teamA, teamB, players, 3, 5000 + seed);
      if (s.winnerId === s.teamAId) aWins += 1;
    }
    assert(aWins > trials * 0.7, `strong team wins majority of series (${aWins}/${trials})`);
  }

  // --- Determinism: same seed -> identical Series; different -> differs ------
  {
    const w1 = makeWorld();
    const w2 = makeWorld();
    const a = simSeries(w1.teamA, w1.teamB, w1.players, 3, 778899);
    const b = simSeries(w2.teamA, w2.teamB, w2.players, 3, 778899);
    assertEqual(a, b, 'same seed produces an identical Series');

    const w3 = makeWorld();
    const c = simSeries(w3.teamA, w3.teamB, w3.players, 3, 112233);
    const differs =
      a.score.A !== c.score.A ||
      a.score.B !== c.score.B ||
      a.maps.length !== c.maps.length ||
      a.winnerId !== c.winnerId ||
      JSON.stringify(a.veto) !== JSON.stringify(c.veto);
    assert(differs, 'different seed produces a different Series');
  }

  // --- Inputs are not mutated ----------------------------------------------
  {
    const { players, teamA, teamB } = makeWorld();
    const rosterABefore = teamA.roster.slice();
    const rosterBBefore = teamB.roster.slice();
    simSeries(teamA, teamB, players, 5, 24680);
    assertEqual(teamA.roster, rosterABefore, 'teamA.roster not mutated');
    assertEqual(teamB.roster, rosterBBefore, 'teamB.roster not mutated');
  }
}
