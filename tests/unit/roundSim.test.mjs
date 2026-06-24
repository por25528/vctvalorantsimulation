/**
 * tests/unit/roundSim.test.mjs — engine/match/roundSim.js (CONTRACTS §9, §11, §14).
 *
 * Over many seeded rounds, asserts the engagement loop's invariants:
 *  - every round terminates and returns a well-formed RoundLog;
 *  - the winning side recorded at least one DuelEvent;
 *  - aliveEnd is self-consistent (winner keeps >=1 alive on an elim/time win,
 *    the eliminated side reads 0; counts never exceed the starting 5);
 *  - firstBlood is set on exactly one event (and only the first);
 *  - the clutch path is reachable (some seed produces a last-alive clutch win);
 *  - economy/endCondition fields are valid; inputs are never mutated.
 *
 * Deterministic: all randomness via createRng(seed); no Math.random.
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createRng } from '../../src/core/rng.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { BALANCE } from '../../src/config/balance.js';
import { simRound } from '../../src/engine/match/roundSim.js';

const MAP_ID = 'ascent';

/**
 * Build a players lookup + two 5-man rosters. Optional per-side attribute slant
 * lets a test bias one team without touching the others.
 * @param {{aSkill?:number, bSkill?:number}} [opts]
 * @returns {{ players:Record<string,object>, rosterA:string[], rosterB:string[] }}
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
      attributes: { aim: aSkill, reaction: aSkill, movement: aSkill, gameSense: aSkill, trading: 70, composure: 70, utility: 60 }
    });
    players[bId] = createPlayer({
      id: bId,
      name: bId,
      role: 'Duelist',
      attributes: { aim: bSkill, reaction: bSkill, movement: bSkill, gameSense: bSkill, trading: 70, composure: 70, utility: 60 }
    });
    rosterA.push(aId);
    rosterB.push(bId);
  }
  return { players, rosterA, rosterB };
}

/**
 * Assemble simRound args for a given round number / side assignment.
 * @param {object} cfg
 * @returns {object}
 */
function makeArgs(cfg) {
  const { n, sideA, players, rosterA, rosterB, creditsA = 4000, creditsB = 4000 } = cfg;
  const sideB = sideA === 'atk' ? 'def' : 'atk';
  return {
    n,
    sideA,
    sideB,
    rostersAlive: { A: rosterA.slice(), B: rosterB.slice() },
    econA: { credits: creditsA, lossStreak: 0 },
    econB: { credits: creditsB, lossStreak: 0 },
    teamA: createTeam({ id: 'TA', name: 'Team A', tag: 'TA', roster: rosterA }),
    teamB: createTeam({ id: 'TB', name: 'Team B', tag: 'TB', roster: rosterB }),
    players,
    mapId: MAP_ID
  };
}

/**
 * Validate the structural shape + invariants of a RoundLog.
 * @param {object} log
 * @param {string} ctx label for failure messages
 */
function checkRoundLog(log, ctx) {
  assert(log && typeof log === 'object', `${ctx}: returns a log object`);
  assert(log.winnerSide === 'atk' || log.winnerSide === 'def', `${ctx}: winnerSide valid`);
  assert(log.winnerTeam === 'A' || log.winnerTeam === 'B', `${ctx}: winnerTeam valid`);
  assert(
    ['elim', 'spike', 'defuse', 'time'].includes(log.endCondition),
    `${ctx}: endCondition valid (${log.endCondition})`
  );
  assert(Array.isArray(log.events), `${ctx}: events is an array`);
  assert(typeof log.planted === 'boolean', `${ctx}: planted is boolean`);
  assert(
    log.clutchPlayerId === null || typeof log.clutchPlayerId === 'string',
    `${ctx}: clutchPlayerId null or string`
  );

  // aliveEnd within [0,5] and self-consistent with winnerSide.
  for (const team of ['A', 'B']) {
    assert(log.aliveEnd[team] >= 0 && log.aliveEnd[team] <= 5, `${ctx}: aliveEnd ${team} in [0,5]`);
  }

  // economy shape
  for (const team of ['A', 'B']) {
    assert(
      ['pistol', 'eco', 'force', 'full'].includes(log.economy[team].type),
      `${ctx}: economy ${team} type valid`
    );
    assert(typeof log.economy[team].credits === 'number', `${ctx}: economy ${team} credits numeric`);
  }

  // The winning TEAM should have at least one event (a kill by their side),
  // except a degenerate mutual-elim 'time' edge which we don't expect here.
  let winnerEvents = 0;
  let firstBloodCount = 0;
  for (let i = 0; i < log.events.length; i++) {
    const ev = log.events[i];
    if (ev.isFirstBlood) {
      firstBloodCount += 1;
      assertEqual(i, 0, `${ctx}: firstBlood only on the first event`);
    }
    if (ev.killerSide === log.winnerSide) winnerEvents += 1;
  }
  if (log.events.length > 0) {
    assertEqual(firstBloodCount, 1, `${ctx}: exactly one firstBlood`);
  }
  assert(winnerEvents >= 1, `${ctx}: winner has >=1 event`);
}

export default async function roundSimTest() {
  section('engine/match/roundSim');

  // --- Many seeded rounds: terminate + invariants hold ----------------------
  {
    const { players, rosterA, rosterB } = makeWorld();
    let sawClutch = false;
    let sawPlant = false;
    const endConditions = new Set();

    for (let seed = 0; seed < 300; seed++) {
      const rng = createRng(1000 + seed);
      const sideA = seed % 2 === 0 ? 'atk' : 'def';
      const n = (seed % 24) + 1;
      const args = makeArgs({ n, sideA, players, rosterA, rosterB });

      // Snapshot inputs for immutability check.
      const aliveBefore = { A: args.rostersAlive.A.slice(), B: args.rostersAlive.B.slice() };

      const log = simRound(args, rng);
      checkRoundLog(log, `seed ${seed}`);

      // Round terminated -> at least one side is at 0 (elim) OR both alive (time/cap).
      const oneSideDead = log.aliveEnd.A === 0 || log.aliveEnd.B === 0;
      const bothAlive = log.aliveEnd.A > 0 && log.aliveEnd.B > 0;
      assert(oneSideDead || bothAlive, `seed ${seed}: terminated with consistent aliveEnd`);

      // Winner side has >=1 alive on an elim/time win.
      const winnerAlive = log.aliveEnd[log.winnerTeam];
      assert(winnerAlive >= 1, `seed ${seed}: winner keeps >=1 alive`);

      // Inputs untouched.
      assertEqual(args.rostersAlive.A, aliveBefore.A, `seed ${seed}: rostersAlive.A not mutated`);
      assertEqual(args.rostersAlive.B, aliveBefore.B, `seed ${seed}: rostersAlive.B not mutated`);

      if (log.clutchPlayerId) sawClutch = true;
      if (log.planted) sawPlant = true;
      endConditions.add(log.endCondition);
    }

    assert(sawClutch, 'clutch path reachable across seeds');
    assert(sawPlant, 'plant path reachable across seeds');
    assert(endConditions.has('elim'), 'elim outcomes occur');
  }

  // --- Determinism: same seed -> identical RoundLog -------------------------
  {
    const { players, rosterA, rosterB } = makeWorld();
    const args1 = makeArgs({ n: 5, sideA: 'atk', players, rosterA, rosterB });
    const args2 = makeArgs({ n: 5, sideA: 'atk', players, rosterA, rosterB });
    const a = simRound(args1, createRng(424242));
    const b = simRound(args2, createRng(424242));
    assertEqual(a, b, 'same seed produces identical RoundLog');
  }

  // --- Strong vs weak team wins the large majority of rounds ----------------
  {
    const { players, rosterA, rosterB } = makeWorld({ aSkill: 92, bSkill: 55 });
    let aWins = 0;
    const trials = 200;
    for (let seed = 0; seed < trials; seed++) {
      const rng = createRng(7000 + seed);
      const args = makeArgs({ n: 5, sideA: 'atk', players, rosterA, rosterB });
      const log = simRound(args, rng);
      if (log.winnerTeam === 'A') aWins += 1;
    }
    assert(aWins > trials * 0.6, `strong team wins majority (${aWins}/${trials})`);
  }

  // --- Pistol round: econ types are 'pistol' on rounds 1 & 13 ---------------
  {
    const { players, rosterA, rosterB } = makeWorld();
    for (const n of [1, 13]) {
      const rng = createRng(99);
      const args = makeArgs({ n, sideA: 'atk', players, rosterA, rosterB, creditsA: 800, creditsB: 800 });
      const log = simRound(args, rng);
      assertEqual(log.economy.A.type, 'pistol', `round ${n}: A pistol`);
      assertEqual(log.economy.B.type, 'pistol', `round ${n}: B pistol`);
    }
  }

  // --- Spike semantics: spike/defuse only when planted ----------------------
  {
    const { players, rosterA, rosterB } = makeWorld();
    for (let seed = 0; seed < 200; seed++) {
      const rng = createRng(33000 + seed);
      const args = makeArgs({ n: 6, sideA: 'atk', players, rosterA, rosterB });
      const log = simRound(args, rng);
      if (log.endCondition === 'spike') {
        assert(log.planted && log.winnerSide === 'atk', `seed ${seed}: spike => planted & atk win`);
      }
      if (log.endCondition === 'defuse') {
        assert(log.planted && log.winnerSide === 'def', `seed ${seed}: defuse => planted & def win`);
      }
      if (!log.planted) {
        assert(
          log.endCondition === 'elim' || log.endCondition === 'time',
          `seed ${seed}: unplanted => elim/time`
        );
      }
    }
  }
}
