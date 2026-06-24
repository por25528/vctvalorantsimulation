/**
 * tests/unit/mapSim.test.mjs — engine/match/mapSim.js (CONTRACTS §9, §10, §11, §14).
 *
 * Over many seeded maps, asserts simMap's map-level invariants:
 *  - the final score reaches ROUNDS_TO_WIN (13) in regulation, or wins by
 *    OT_WIN_BY (>=2) in overtime, and the leader is the recorded winner;
 *  - rounds.length === score.A + score.B (every played round is logged);
 *  - both teams play BOTH attack and defense across the map (halftime swap);
 *  - the box score is finalized for all 10 active players (acs/kd/kast/adr set),
 *    and an MVP is one of those players;
 *  - economy is threaded (credits move off the pistol start) and inputs are not
 *    mutated;
 *  - determinism: same seed -> deep-equal MapResult; different seed -> differs.
 *
 * Deterministic: all randomness via createRng(seed); no Math.random.
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createRng } from '../../src/core/rng.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { BALANCE } from '../../src/config/balance.js';
import { simMap } from '../../src/engine/match/mapSim.js';

const MAP_ID = 'ascent';

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
  for (let i = 0; i < 5; i++) {
    const aId = `A${i}`;
    const bId = `B${i}`;
    players[aId] = createPlayer({
      id: aId,
      name: aId,
      role: 'Duelist',
      attributes: {
        aim: aSkill, reaction: aSkill, movement: aSkill, gameSense: aSkill,
        trading: 70, composure: 70, utility: 60, igl: i === 0 ? 70 : 30
      }
    });
    players[bId] = createPlayer({
      id: bId,
      name: bId,
      role: 'Duelist',
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

const COMP_A = ['omen', 'sova', 'killjoy', 'jett', 'raze'];
const COMP_B = ['brimstone', 'fade', 'cypher', 'phoenix', 'neon'];

/**
 * Validate a finished MapResult's structure + invariants.
 * @param {object} res
 * @param {'atk'|'def'} sideStartA
 * @param {string} ctx
 */
function checkMapResult(res, sideStartA, ctx) {
  assert(res && typeof res === 'object', `${ctx}: returns a MapResult object`);
  assertEqual(res.mapId, MAP_ID, `${ctx}: mapId echoed`);
  assertEqual(res.sideStartA, sideStartA, `${ctx}: sideStartA echoed`);
  assert(res.winner === 'A' || res.winner === 'B', `${ctx}: winner valid`);
  assert(Array.isArray(res.rounds), `${ctx}: rounds is an array`);

  const a = res.score.A;
  const b = res.score.B;

  // Final score reaches 13, or OT win-by-2.
  const win = BALANCE.ROUNDS_TO_WIN;
  const otBy = BALANCE.OT_WIN_BY;
  const max = Math.max(a, b);
  const diff = Math.abs(a - b);
  const regulationWin = max === win && Math.min(a, b) < win - 1;
  const overtimeWin = max >= win && diff >= otBy && Math.min(a, b) >= win - 1;
  assert(regulationWin || overtimeWin, `${ctx}: score ${a}-${b} is a valid 13 / OT win-by-${otBy}`);

  // The leader is the recorded winner.
  const leader = a > b ? 'A' : 'B';
  assertEqual(res.winner, leader, `${ctx}: winner is the score leader`);

  // rounds.length === score.A + score.B
  assertEqual(res.rounds.length, a + b, `${ctx}: rounds.length === score.A + score.B`);

  // Both teams played BOTH attack and defense over the map.
  const aSides = new Set();
  const bSides = new Set();
  for (const log of res.rounds) {
    // winnerSide + winnerTeam pin team A's side that round: if A won, A's side is
    // winnerSide; else A's side is the opposite of winnerSide.
    const aSide = log.winnerTeam === 'A' ? log.winnerSide : (log.winnerSide === 'atk' ? 'def' : 'atk');
    const bSide = aSide === 'atk' ? 'def' : 'atk';
    aSides.add(aSide);
    bSides.add(bSide);
  }
  assert(aSides.has('atk') && aSides.has('def'), `${ctx}: team A played both atk and def`);
  assert(bSides.has('atk') && bSides.has('def'), `${ctx}: team B played both atk and def`);

  // Box score finalized for all 10 active players.
  const ids = Object.keys(res.boxScore);
  assertEqual(ids.length, 10, `${ctx}: box score has all 10 players`);
  for (const id of ids) {
    const row = res.boxScore[id];
    assert(typeof row.acs === 'number', `${ctx}: ${id} acs numeric (finalized)`);
    assert(typeof row.kd === 'number', `${ctx}: ${id} kd numeric (finalized)`);
    assert(typeof row.kast === 'number', `${ctx}: ${id} kast numeric (finalized)`);
    assert(typeof row.adr === 'number', `${ctx}: ${id} adr numeric (finalized)`);
    assertEqual(row.roundsPlayed, res.rounds.length, `${ctx}: ${id} roundsPlayed === total rounds`);
    assert(!('__kastHits' in row), `${ctx}: ${id} transient KAST field stripped`);
  }

  // MVP is one of the 10 players.
  assert(ids.includes(res.mvpPlayerId), `${ctx}: mvp is a tracked player`);

  // Comps echoed as fresh arrays.
  assertEqual(res.compA, COMP_A, `${ctx}: compA echoed`);
  assertEqual(res.compB, COMP_B, `${ctx}: compB echoed`);
}

export default async function mapSimTest() {
  section('engine/match/mapSim');

  // --- Many seeded maps: invariants hold, OT path reachable -----------------
  {
    let sawOvertime = false;
    let sawStartAtk = false;
    let sawStartDef = false;

    for (let seed = 0; seed < 120; seed++) {
      const { players, teamA, teamB } = makeWorld();
      const sideStartA = seed % 2 === 0 ? 'atk' : 'def';
      if (sideStartA === 'atk') sawStartAtk = true;
      else sawStartDef = true;

      // Snapshot inputs for immutability check.
      const rosterABefore = teamA.roster.slice();
      const rosterBBefore = teamB.roster.slice();

      const rng = createRng(50000 + seed);
      const res = simMap(teamA, teamB, players, MAP_ID, COMP_A, COMP_B, sideStartA, rng);
      checkMapResult(res, sideStartA, `seed ${seed}`);

      if (Math.max(res.score.A, res.score.B) > BALANCE.ROUNDS_TO_WIN ||
          (res.score.A >= BALANCE.ROUNDS_TO_WIN && res.score.B >= BALANCE.ROUNDS_TO_WIN - 1 &&
           res.score.B >= BALANCE.ROUNDS_TO_WIN)) {
        sawOvertime = true;
      }
      // Simpler OT detection: both sides reached >= 12 and total >= 24.
      if (res.score.A >= BALANCE.ROUNDS_TO_WIN - 1 && res.score.B >= BALANCE.ROUNDS_TO_WIN - 1) {
        sawOvertime = true;
      }

      // Inputs untouched.
      assertEqual(teamA.roster, rosterABefore, `seed ${seed}: teamA.roster not mutated`);
      assertEqual(teamB.roster, rosterBBefore, `seed ${seed}: teamB.roster not mutated`);
    }

    assert(sawStartAtk && sawStartDef, 'both starting sides exercised');
    assert(sawOvertime, 'overtime path reached across seeds');
  }

  // --- Economy is threaded: at least one side leaves the pistol start --------
  {
    const { players, teamA, teamB } = makeWorld();
    const rng = createRng(13579);
    const res = simMap(teamA, teamB, players, MAP_ID, COMP_A, COMP_B, 'atk', rng);
    // Round 2 economy reflects round-1 rewards (credits != CREDIT_START for the
    // winner at minimum). RoundLog.economy carries the credits entering a round.
    assert(res.rounds.length >= 2, 'map has >=2 rounds');
    const r2 = res.rounds[1];
    const movedA = r2.economy.A.credits !== BALANCE.CREDIT_START;
    const movedB = r2.economy.B.credits !== BALANCE.CREDIT_START;
    assert(movedA || movedB, 'economy threaded: credits change after round 1');
  }

  // --- Stronger team wins the large majority of maps ------------------------
  {
    let aWins = 0;
    const trials = 40;
    for (let seed = 0; seed < trials; seed++) {
      const { players, teamA, teamB } = makeWorld({ aSkill: 90, bSkill: 58 });
      const rng = createRng(80000 + seed);
      const res = simMap(teamA, teamB, players, MAP_ID, COMP_A, COMP_B, 'atk', rng);
      if (res.winner === 'A') aWins += 1;
    }
    assert(aWins > trials * 0.7, `strong team wins majority of maps (${aWins}/${trials})`);
  }

  // --- Determinism: same seed -> identical MapResult; different -> differs ---
  {
    const w1 = makeWorld();
    const w2 = makeWorld();
    const a = simMap(w1.teamA, w1.teamB, w1.players, MAP_ID, COMP_A, COMP_B, 'atk', createRng(424242));
    const b = simMap(w2.teamA, w2.teamB, w2.players, MAP_ID, COMP_A, COMP_B, 'atk', createRng(424242));
    assertEqual(a, b, 'same seed produces identical MapResult');

    const w3 = makeWorld();
    const c = simMap(w3.teamA, w3.teamB, w3.players, MAP_ID, COMP_A, COMP_B, 'atk', createRng(999999));
    let differs = a.score.A !== c.score.A || a.score.B !== c.score.B || a.rounds.length !== c.rounds.length;
    assert(differs, 'different seed produces a different MapResult');
  }
}
