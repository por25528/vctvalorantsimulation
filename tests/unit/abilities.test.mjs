/**
 * tests/unit/abilities.test.mjs — targeted tests for engine/match/abilities.js
 *
 * Asserts:
 *  - compProfile correctly counts agent archetypes by id.
 *  - compAbilityEffects returns bounded, sensible multipliers.
 *  - Info agents raise tradeBonus; smoke/flash agents raise atkFactor;
 *    anchor agents raise defFactor; balanced comps earn a synergy bonus.
 *  - A well-balanced comp wins more rounds against an all-Duelist comp over
 *    many seeded simulations (ability effects measurably shift outcomes).
 *  - Ult state: advanceUltState accrues points, charges at threshold, fires
 *    on the next round, then resets correctly.
 *  - Determinism: same seed → identical simSeries result after abilities added.
 *
 * All randomness via createRng (no Math.random). Default export throws on failure.
 */

import { assert, assertEqual, assertClose, section } from '../_assert.mjs';
import { createRng } from '../../src/core/rng.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { BALANCE } from '../../src/config/balance.js';
import {
  compProfile,
  compAbilityEffects,
  createUltState,
  advanceUltState
} from '../../src/engine/match/abilities.js';
import { simRound } from '../../src/engine/match/roundSim.js';
import { buildWorld } from '../../src/data/seed/index.js';
import { simSeries } from '../../src/engine/match/matchSim.js';

const AB = BALANCE.ABILITY;

/** Build a minimal players+rosters world for roundSim tests. */
function makeWorld(skill = 75) {
  const players = {};
  const rosterA = [];
  const rosterB = [];
  for (let i = 0; i < 5; i++) {
    const aid = `A${i}`, bid = `B${i}`;
    players[aid] = createPlayer({ id: aid, name: aid, role: 'Duelist',
      attributes: { aim: skill, reaction: skill, movement: skill, gameSense: skill, trading: 70, composure: 70, utility: 60 } });
    players[bid] = createPlayer({ id: bid, name: bid, role: 'Duelist',
      attributes: { aim: skill, reaction: skill, movement: skill, gameSense: skill, trading: 70, composure: 70, utility: 60 } });
    rosterA.push(aid);
    rosterB.push(bid);
  }
  return { players, rosterA, rosterB };
}

function makeArgs(cfg) {
  const { n = 6, sideA = 'atk', players, rosterA, rosterB, compA, compB,
          ultReadyA = false, ultReadyB = false } = cfg;
  const sideB = sideA === 'atk' ? 'def' : 'atk';
  return {
    n, sideA, sideB,
    rostersAlive: { A: rosterA.slice(), B: rosterB.slice() },
    econA: { credits: 4000, lossStreak: 0 },
    econB: { credits: 4000, lossStreak: 0 },
    teamA: createTeam({ id: 'TA', name: 'Team A', tag: 'TA', roster: rosterA }),
    teamB: createTeam({ id: 'TB', name: 'Team B', tag: 'TB', roster: rosterB }),
    players, mapId: 'ascent',
    compA, compB, ultReadyA, ultReadyB
  };
}

export default async function run() {

  // ---------------------------------------------------------------------------
  section('abilities.compProfile — correct archetype counts');
  // ---------------------------------------------------------------------------
  {
    const empty = compProfile([]);
    assertEqual(empty, { info: 0, smoke: 0, flash: 0, anchor: 0, duelist: 0 }, 'empty comp');

    const mixed = compProfile(['sova', 'omen', 'breach', 'killjoy', 'jett']);
    assertEqual(mixed, { info: 1, smoke: 1, flash: 1, anchor: 1, duelist: 1 }, 'one of each');

    const allDuelists = compProfile(['jett', 'raze', 'reyna', 'neon', 'iso']);
    assertEqual(allDuelists, { info: 0, smoke: 0, flash: 0, anchor: 0, duelist: 5 }, 'all duelists');

    const controllers = compProfile(['brimstone', 'omen', 'viper', 'astra', 'harbor']);
    assertEqual(controllers, { info: 0, smoke: 5, flash: 0, anchor: 0, duelist: 0 }, 'all controllers');

    // Cypher → info (not anchor)
    const withCypher = compProfile(['cypher', 'sova', 'jett', 'omen', 'killjoy']);
    assertEqual(withCypher.info, 2, 'cypher + sova = 2 info');
    assertEqual(withCypher.anchor, 1, 'killjoy = 1 anchor');

    // Unknown agent id → not counted, no error
    const unknown = compProfile(['unknown_agent', 'jett']);
    assertEqual(unknown.duelist, 1, 'known agents counted; unknowns silently skipped');

    // undefined / null comp → all zeros (no crash)
    const fromNull = compProfile(undefined);
    assertEqual(fromNull, { info: 0, smoke: 0, flash: 0, anchor: 0, duelist: 0 }, 'undefined comp → zeros');
  }

  // ---------------------------------------------------------------------------
  section('abilities.compAbilityEffects — bounded multipliers');
  // ---------------------------------------------------------------------------
  {
    // Neutral comp (all duelists): no atk/def bonus, no trade bonus.
    const duelistEff = compAbilityEffects(['jett', 'raze', 'reyna', 'neon', 'iso'], false);
    assertEqual(duelistEff.atkFactor, 1, 'all duelists: atkFactor = 1');
    assertEqual(duelistEff.defFactor, 1, 'all duelists: defFactor = 1');
    assertEqual(duelistEff.tradeBonus, 0, 'all duelists: tradeBonus = 0');
    assertEqual(duelistEff.ultBonus, 0, 'no ult ready: ultBonus = 0');

    // Single controller → ATK boost, no DEF bonus.
    const oneSmoke = compAbilityEffects(['omen', 'jett', 'jett', 'jett', 'jett'], false);
    assertClose(oneSmoke.atkFactor, 1 + AB.SMOKE_ATK_BOOST, 1e-9, 'one smoke → ATK lift');
    assertEqual(oneSmoke.defFactor, 1, 'no anchor → defFactor = 1');

    // Single anchor → DEF boost, no ATK bonus.
    const oneAnchor = compAbilityEffects(['killjoy', 'jett', 'jett', 'jett', 'jett'], false);
    assertClose(oneAnchor.defFactor, 1 + AB.ANCHOR_DEF_BOOST, 1e-9, 'one anchor → DEF lift');
    assertEqual(oneAnchor.atkFactor, 1, 'no smoke/flash → atkFactor = 1');

    // Single info agent → trade bonus.
    const oneInfo = compAbilityEffects(['sova', 'jett', 'jett', 'jett', 'jett'], false);
    assertClose(oneInfo.tradeBonus, AB.INFO_TRADE_BONUS, 1e-9, 'one info agent → tradeBonus');

    // Ult ready → ultBonus applied.
    const withUlt = compAbilityEffects(['jett', 'raze', 'reyna', 'neon', 'iso'], true);
    assertClose(withUlt.ultBonus, AB.ULT_BOOST, 1e-9, 'ult ready → ultBonus = ULT_BOOST');

    // Stacking is capped at MAX_ATK_BOOST / MAX_DEF_BOOST.
    const maxSmokes = compAbilityEffects(['brimstone', 'omen', 'viper', 'astra', 'harbor'], false);
    // 5 smokes × SMOKE_ATK_BOOST may exceed the cap.
    assert(maxSmokes.atkFactor - 1 <= AB.MAX_ATK_BOOST + 1e-9, 'ATK boost capped at MAX_ATK_BOOST');

    // Balanced comp (smoke + anchor + info) earns the synergy bonus.
    const balanced = compAbilityEffects(['omen', 'killjoy', 'sova', 'jett', 'raze'], false);
    const unbalanced = compAbilityEffects(['omen', 'jett', 'raze', 'reyna', 'neon'], false); // no anchor or info
    assert(balanced.atkFactor > unbalanced.atkFactor, 'balanced comp has higher atkFactor than unbalanced');
    assert(balanced.defFactor > 1, 'balanced comp: defFactor > 1 (anchor + balance bonus)');
  }

  // ---------------------------------------------------------------------------
  section('abilities.ultState — charge, fire, reset cycle');
  // ---------------------------------------------------------------------------
  {
    // Duelist-heavy comp uses the lower threshold.
    const duelistComp = ['jett', 'raze', 'reyna', 'neon', 'iso'];
    const mixedComp   = ['jett', 'omen', 'sova', 'killjoy', 'breach'];

    const ultD = createUltState(duelistComp);
    const ultM = createUltState(mixedComp);
    assertEqual(ultD.threshold, AB.ULT_THRESHOLD_LOW, 'duelist comp: lower threshold');
    assertEqual(ultM.threshold, AB.ULT_THRESHOLD, 'mixed comp: default threshold');
    assertEqual(ultD.ready, false, 'starts not ready');
    assertEqual(ultD.points, 0, 'starts at 0 points');

    // Accrue just below threshold.
    const threshold = AB.ULT_THRESHOLD;
    const perKill = AB.ULT_POINTS_PER_KILL;
    const perWin  = AB.ULT_POINTS_PER_WIN;

    // Simulate kills to charge but not fire.
    let state = createUltState(mixedComp);
    // Add kills until one before threshold.
    const earnsPerWinRound = 3 * perKill + perWin; // 3 kills + win
    let rounds = 0;
    while (state.points + earnsPerWinRound < threshold && rounds < 20) {
      state = advanceUltState(state, 3, true);
      rounds += 1;
      assert(!state.ready || state.points === 0, `after round ${rounds}: ready only when threshold hit`);
    }
    // Force the threshold to be crossed.
    const stateBeforeFire = { ...state, points: threshold - 1 };
    const fired = advanceUltState(stateBeforeFire, 1, false); // +1 kill tips it over
    assertEqual(fired.ready, true, 'crosses threshold → ready=true');
    assertEqual(fired.points, 0, 'points reset to 0 when charged');

    // Next advance: ult fires (consumed), points restart from 0.
    const afterFire = advanceUltState(fired, 2, false); // 2 kills, no win
    assertEqual(afterFire.ready, 2 * perKill >= threshold, 'ready only if new kills also tip threshold');
    // With threshold=8 and 2 kills (2 pts), it won't re-fire immediately.
    if (threshold > 2 * perKill) {
      assertEqual(afterFire.ready, false, 'does not immediately re-fire after reset with few kills');
      assertEqual(afterFire.points, 2 * perKill, 'points counted fresh after ult consumed');
    }
  }

  // ---------------------------------------------------------------------------
  section('abilities — balanced comp outperforms all-Duelist comp in rounds');
  // ---------------------------------------------------------------------------
  {
    const { players, rosterA, rosterB } = makeWorld(75);
    const TRIALS = 400;

    // "Balanced" comp: smoke + flash + anchor + info + duelist
    const balancedComp = ['omen', 'breach', 'killjoy', 'sova', 'jett'];
    // "Unbalanced" comp: all duelists, no utility
    const duelistComp  = ['jett', 'raze', 'reyna', 'neon', 'iso'];

    // Test ATK advantage: balanced comp attacks, all-duelist defends.
    let atkWins = 0;
    for (let seed = 0; seed < TRIALS; seed++) {
      const rng = createRng(8000 + seed);
      const args = makeArgs({ players, rosterA, rosterB,
        sideA: 'atk', compA: balancedComp, compB: duelistComp });
      const log = simRound(args, rng);
      if (log.winnerSide === 'atk') atkWins += 1;
    }
    const atkWinRate = atkWins / TRIALS;
    // Balanced comp on ATK should beat all-duelist DEF more than 50% of the time.
    assert(atkWinRate > 0.5, `balanced ATK vs duelist DEF wins ${(atkWinRate * 100).toFixed(1)}% (>50% expected)`);

    // Test DEF advantage: all-duelist attacks, balanced comp defends.
    let defWins = 0;
    for (let seed = 0; seed < TRIALS; seed++) {
      const rng = createRng(9000 + seed);
      const args = makeArgs({ players, rosterA, rosterB,
        sideA: 'def', compA: balancedComp, compB: duelistComp });
      const log = simRound(args, rng);
      if (log.winnerTeam === 'A') defWins += 1; // A is DEF with balanced comp
    }
    const defWinRate = defWins / TRIALS;
    assert(defWinRate > 0.5, `balanced DEF vs duelist ATK wins ${(defWinRate * 100).toFixed(1)}% (>50% expected)`);

    // Info agents raise trade rate: comp with 2 info agents should trade more.
    let infoTrades = 0, noInfoTrades = 0;
    const TRADE_TRIALS = 600;
    for (let seed = 0; seed < TRADE_TRIALS; seed++) {
      const rng1 = createRng(10000 + seed);
      const rng2 = createRng(10000 + seed);
      const argsInfo  = makeArgs({ players, rosterA, rosterB, sideA: 'atk',
        compA: ['sova', 'fade', 'jett', 'omen', 'killjoy'], compB: duelistComp });
      const argsDuel  = makeArgs({ players, rosterA, rosterB, sideA: 'atk',
        compA: duelistComp, compB: duelistComp });
      const logInfo = simRound(argsInfo, rng1);
      const logDuel = simRound(argsDuel, rng2);
      infoTrades   += logInfo.events.filter(e => e.isTrade).length;
      noInfoTrades += logDuel.events.filter(e => e.isTrade).length;
    }
    assert(infoTrades > noInfoTrades, `info agents produce more trades (${infoTrades} vs ${noInfoTrades})`);
  }

  // ---------------------------------------------------------------------------
  section('abilities — ult fires measurably shift round outcome');
  // ---------------------------------------------------------------------------
  {
    const { players, rosterA, rosterB } = makeWorld(75);
    const TRIALS = 300;
    const comp = ['jett', 'omen', 'breach', 'killjoy', 'sova'];

    let ultWins = 0, noUltWins = 0;
    for (let seed = 0; seed < TRIALS; seed++) {
      const rngUlt  = createRng(11000 + seed);
      const rngBase = createRng(11000 + seed);
      // Same seed but team A has ult ready in the first run.
      const argsUlt  = makeArgs({ players, rosterA, rosterB, sideA: 'atk',
        compA: comp, compB: comp, ultReadyA: true, ultReadyB: false });
      const argsBase = makeArgs({ players, rosterA, rosterB, sideA: 'atk',
        compA: comp, compB: comp, ultReadyA: false, ultReadyB: false });
      if (simRound(argsUlt,  rngUlt ).winnerTeam === 'A') ultWins++;
      if (simRound(argsBase, rngBase).winnerTeam === 'A') noUltWins++;
    }
    // Team A with ult ready should win more often than without it.
    assert(ultWins > noUltWins, `ult-ready team wins more: ${ultWins} vs ${noUltWins} (out of ${TRIALS})`);
  }

  // ---------------------------------------------------------------------------
  section('abilities — determinism preserved after ability system');
  // ---------------------------------------------------------------------------
  {
    const world = buildWorld(42);
    const teams = Object.values(world.teamsById);
    const r1 = simSeries(teams[0], teams[1], world.playersById, 3, 1234);
    const r2 = simSeries(teams[0], teams[1], world.playersById, 3, 1234);
    const same = JSON.stringify(r1) === JSON.stringify(r2);
    assert(same, 'same seed → byte-identical Series after abilities added');

    const r3 = simSeries(teams[0], teams[1], world.playersById, 3, 5678);
    assert(JSON.stringify(r1) !== JSON.stringify(r3), 'different seeds produce different Series');
  }

  // ---------------------------------------------------------------------------
  section('abilities — MapResult carries ultUsage and abilityProfile');
  // ---------------------------------------------------------------------------
  {
    const world = buildWorld(42);
    const teams = Object.values(world.teamsById);
    const series = simSeries(teams[2], teams[3], world.playersById, 3, 999);
    for (const map of series.maps) {
      assert(typeof map.ultUsage === 'object' && map.ultUsage !== null,
        'map.ultUsage is an object');
      assert(typeof map.ultUsage.A === 'number' && map.ultUsage.A >= 0, 'ultUsage.A >= 0');
      assert(typeof map.ultUsage.B === 'number' && map.ultUsage.B >= 0, 'ultUsage.B >= 0');
      assert(typeof map.abilityProfile === 'object' && map.abilityProfile !== null,
        'map.abilityProfile is an object');
      assert(typeof map.abilityProfile.A === 'object', 'abilityProfile.A is an object');
      assert(typeof map.abilityProfile.B === 'object', 'abilityProfile.B is an object');
      // Profiles should sum to 5 (one per agent in the comp).
      const sumA = Object.values(map.abilityProfile.A).reduce((a, b) => a + b, 0);
      const sumB = Object.values(map.abilityProfile.B).reduce((a, b) => a + b, 0);
      assert(sumA <= 5 && sumA >= 0, `abilityProfile.A counts sum to ≤5 (got ${sumA})`);
      assert(sumB <= 5 && sumB >= 0, `abilityProfile.B counts sum to ≤5 (got ${sumB})`);
    }
  }
}
