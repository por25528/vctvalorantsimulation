/**
 * tests/unit/momentum.test.mjs — engine/match/momentum.js + round integration.
 *
 * Asserts:
 *  - updateMomentum is bounded and decays correctly (MOMENTUM invariants).
 *  - momentumDuelFactor and momentumEcoBias respect their ±MAX limits.
 *  - stakesAmplifier returns correct tier for match-point / OT / eco-upset.
 *  - Round simulations with positive momentum produce higher win rates (momentum
 *    effect is real and bounded — favorites still win, but momentum tilts odds).
 *  - Determinism: same seed + same momentum → identical RoundLog.
 *  - Bounds: even at max momentum (1.0), the strongest team still wins the
 *    majority of rounds vs max-negative-momentum opponents.
 *
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createRng } from '../../src/core/rng.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { BALANCE } from '../../src/config/balance.js';
import {
  updateMomentum,
  momentumDuelFactor,
  momentumEcoBias,
  stakesAmplifier
} from '../../src/engine/match/momentum.js';
import { simRound } from '../../src/engine/match/roundSim.js';
import { simMap } from '../../src/engine/match/mapSim.js';

const M = BALANCE.MOMENTUM;

// ============ Helpers ============

function makeWorld(opts = {}) {
  const aSkill = typeof opts.aSkill === 'number' ? opts.aSkill : 75;
  const bSkill = typeof opts.bSkill === 'number' ? opts.bSkill : 75;
  const players = {};
  const rosterA = [];
  const rosterB = [];
  for (let i = 0; i < 5; i++) {
    const aId = `A${i}`;
    const bId = `B${i}`;
    players[aId] = createPlayer({ id: aId, name: aId, role: 'Duelist', attributes: { aim: aSkill, reaction: aSkill, movement: aSkill, gameSense: aSkill, trading: 70, composure: 70, utility: 60 } });
    players[bId] = createPlayer({ id: bId, name: bId, role: 'Duelist', attributes: { aim: bSkill, reaction: bSkill, movement: bSkill, gameSense: bSkill, trading: 70, composure: 70, utility: 60 } });
    rosterA.push(aId);
    rosterB.push(bId);
  }
  return { players, rosterA, rosterB };
}

function makeTeams(rosterA, rosterB) {
  return {
    teamA: createTeam({ id: 'TA', name: 'Team A', tag: 'TA', roster: rosterA }),
    teamB: createTeam({ id: 'TB', name: 'Team B', tag: 'TB', roster: rosterB })
  };
}

function makeRoundArgs(players, rosterA, rosterB, opts = {}) {
  const n = opts.n || 5;
  const sideA = opts.sideA || 'atk';
  const { teamA, teamB } = makeTeams(rosterA, rosterB);
  return {
    n,
    sideA,
    sideB: sideA === 'atk' ? 'def' : 'atk',
    rostersAlive: { A: rosterA.slice(), B: rosterB.slice() },
    econA: { credits: opts.creditsA !== undefined ? opts.creditsA : 4000, lossStreak: 0 },
    econB: { credits: opts.creditsB !== undefined ? opts.creditsB : 4000, lossStreak: 0 },
    teamA,
    teamB,
    players,
    mapId: 'ascent',
    ...(opts.momentumA !== undefined ? { momentumA: opts.momentumA } : {}),
    ...(opts.momentumB !== undefined ? { momentumB: opts.momentumB } : {}),
    ...(opts.scoreA !== undefined ? { scoreA: opts.scoreA } : {}),
    ...(opts.scoreB !== undefined ? { scoreB: opts.scoreB } : {}),
  };
}

export default async function momentumTest() {
  section('momentum.updateMomentum — bounded in [-1, +1]');
  {
    // Win streak: should converge to +1 (capped).
    let m = 0;
    for (let i = 0; i < 30; i++) m = updateMomentum(m, true);
    assert(m <= 1, `win streak saturates at +1, got ${m}`);
    assert(m > 0, `win streak is positive`);

    // Loss streak: should converge to -1 (capped).
    m = 0;
    for (let i = 0; i < 30; i++) m = updateMomentum(m, false);
    assert(m >= -1, `loss streak saturates at -1, got ${m}`);
    assert(m < 0, `loss streak is negative`);

    // Alternating wins/losses decays toward 0.
    m = 0;
    for (let i = 0; i < 30; i++) m = updateMomentum(m, i % 2 === 0);
    assert(Math.abs(m) < 0.5, `alternating results keep momentum near 0, got ${m}`);

    // Single win then rest losses decays back.
    m = updateMomentum(0, true); // single win
    const afterOneLoss = updateMomentum(m, false);
    assert(afterOneLoss < m, `loss decreases momentum from ${m} to ${afterOneLoss}`);
  }

  section('momentum.updateMomentum — decay rate');
  {
    // Full momentum (+1) decays when outcomes alternate.
    const full = 1;
    const afterLoss = updateMomentum(full, false);
    // should be: 1*DECAY - WIN_STEP = DECAY - LOSS_STEP
    const expected = full * M.DECAY - M.LOSS_STEP;
    const clampedExpected = Math.max(-1, expected);
    assert(Math.abs(afterLoss - clampedExpected) < 1e-9, `decay correct: expected ${clampedExpected}, got ${afterLoss}`);
  }

  section('momentum.momentumDuelFactor — bounded');
  {
    // Zero momentum → factor = 1 (no-op).
    const noEffect = momentumDuelFactor(0);
    assert(Math.abs(noEffect - 1) < 1e-9, `zero momentum → factor 1 (got ${noEffect})`);

    // Max positive momentum → 1 + DUEL_MAX.
    const maxFactor = momentumDuelFactor(1);
    assert(Math.abs(maxFactor - (1 + M.DUEL_MAX)) < 1e-9, `max momentum → 1+DUEL_MAX (got ${maxFactor})`);

    // Max negative momentum → 1 - DUEL_MAX.
    const minFactor = momentumDuelFactor(-1);
    assert(Math.abs(minFactor - (1 - M.DUEL_MAX)) < 1e-9, `min momentum → 1-DUEL_MAX (got ${minFactor})`);

    // Always positive (rating can never go below zero from momentum alone).
    assert(minFactor > 0, `min factor is positive (${minFactor})`);
  }

  section('momentum.momentumEcoBias — bounded');
  {
    assertEqual(momentumEcoBias(0), 0, 'zero momentum → zero eco bias');
    assert(Math.abs(momentumEcoBias(1) - M.ECO_BIAS_MAX) < 1e-9, 'max positive → ECO_BIAS_MAX');
    assert(Math.abs(momentumEcoBias(-1) - (-M.ECO_BIAS_MAX)) < 1e-9, 'max negative → -ECO_BIAS_MAX');
  }

  section('momentum.stakesAmplifier — tier detection');
  {
    const OT_AFTER = 2 * (BALANCE.ROUNDS_TO_WIN - 1); // 24
    const mpThreshold = BALANCE.ROUNDS_TO_WIN - 1; // 12

    // Normal round (no special condition).
    const normal = stakesAmplifier({ scoreA: 5, scoreB: 4, roundNo: 10, atkEconType: 'full', defEconType: 'full' });
    assertEqual(normal, 1, 'normal round → amplifier 1');

    // Match point: one team at ROUNDS_TO_WIN-1.
    const mp = stakesAmplifier({ scoreA: mpThreshold, scoreB: 5, roundNo: 10, atkEconType: 'full', defEconType: 'full' });
    assert(Math.abs(mp - (1 + M.STAKES_MATCH_POINT)) < 1e-9, `match point → 1+${M.STAKES_MATCH_POINT} (got ${mp})`);

    // Overtime overrides match point.
    const ot = stakesAmplifier({ scoreA: mpThreshold, scoreB: mpThreshold, roundNo: OT_AFTER + 1, atkEconType: 'full', defEconType: 'full' });
    assert(Math.abs(ot - (1 + M.STAKES_OT)) < 1e-9, `overtime → 1+${M.STAKES_OT} (got ${ot})`);

    // Eco upset: atk eco vs def full.
    const eco = stakesAmplifier({ scoreA: 5, scoreB: 4, roundNo: 8, atkEconType: 'eco', defEconType: 'full' });
    assert(Math.abs(eco - (1 + M.STAKES_ECO_UPSET)) < 1e-9, `eco upset → 1+${M.STAKES_ECO_UPSET} (got ${eco})`);

    // Eco on both sides is NOT an upset (neither is defEco+atkFull, both eco = no disparity).
    const bothEco = stakesAmplifier({ scoreA: 5, scoreB: 4, roundNo: 8, atkEconType: 'eco', defEconType: 'eco' });
    assertEqual(bothEco, 1, 'both eco → normal (no upset disparity)');
  }

  section('momentum.stakesAmplifier — OT priority over match-point');
  {
    const OT_AFTER = 2 * (BALANCE.ROUNDS_TO_WIN - 1);
    // Both conditions true → OT wins.
    const amp = stakesAmplifier({ scoreA: BALANCE.ROUNDS_TO_WIN - 1, scoreB: BALANCE.ROUNDS_TO_WIN - 1, roundNo: OT_AFTER + 2, atkEconType: 'full', defEconType: 'full' });
    assert(Math.abs(amp - (1 + M.STAKES_OT)) < 1e-9, `OT overrides match-point (got ${amp})`);
  }

  section('momentum — positive momentum improves win rate (bounded)');
  {
    const { players, rosterA, rosterB } = makeWorld({ aSkill: 75, bSkill: 75 });
    const trials = 300;
    let winsNeutral = 0;
    let winsMomentum = 0;

    for (let seed = 0; seed < trials; seed++) {
      // Neutral: no momentum.
      const argsN = makeRoundArgs(players, rosterA, rosterB, { n: 5, sideA: 'atk' });
      const logN = simRound(argsN, createRng(1000 + seed));
      if (logN.winnerTeam === 'A') winsNeutral++;

      // Positive momentum for team A.
      const argsM = makeRoundArgs(players, rosterA, rosterB, { n: 5, sideA: 'atk', momentumA: 0.8, momentumB: -0.8 });
      const logM = simRound(argsM, createRng(1000 + seed));
      if (logM.winnerTeam === 'A') winsMomentum++;
    }

    // With equal skill, positive momentum for A should raise A's win rate.
    assert(winsMomentum > winsNeutral, `positive momentum boosts win rate: ${winsMomentum} vs ${winsNeutral} (neutral)`);

    // But not to 100% — favorites still lose sometimes (bounded).
    assert(winsMomentum < trials, `momentum never guarantees 100% wins (${winsMomentum}/${trials})`);
    assert(winsNeutral > 0, `neutral has some A wins (coin-flip basis)`);
  }

  section('momentum — max momentum still loses sometimes (bounded)');
  {
    const { players, rosterA, rosterB } = makeWorld({ aSkill: 75, bSkill: 75 });
    let wins = 0;
    const trials = 200;
    for (let seed = 0; seed < trials; seed++) {
      const args = makeRoundArgs(players, rosterA, rosterB, { n: 5, sideA: 'atk', momentumA: 1, momentumB: -1 });
      const log = simRound(args, createRng(5000 + seed));
      if (log.winnerTeam === 'A') wins++;
    }
    // Max momentum on A (+DUEL_MAX) should lift win rate above 50% but not to 100%.
    assert(wins > trials * 0.50, `max positive momentum > 50% win rate (${wins}/${trials})`);
    assert(wins < trials, `max positive momentum does not guarantee every round (${wins}/${trials})`);
  }

  section('momentum — determinism preserved (same seed + args = same log)');
  {
    const { players, rosterA, rosterB } = makeWorld();
    const args1 = makeRoundArgs(players, rosterA, rosterB, { n: 7, sideA: 'atk', momentumA: 0.5, momentumB: -0.3, scoreA: 8, scoreB: 4 });
    const args2 = makeRoundArgs(players, rosterA, rosterB, { n: 7, sideA: 'atk', momentumA: 0.5, momentumB: -0.3, scoreA: 8, scoreB: 4 });
    const logA = simRound(args1, createRng(77777));
    const logB = simRound(args2, createRng(77777));
    assertEqual(logA, logB, 'same seed + same momentum args → identical RoundLog');
  }

  section('momentum — favored team still wins majority of maps despite opponent momentum');
  {
    const MAP_ID = 'ascent';
    const COMP = ['jett', 'sova', 'omen', 'killjoy', 'raze'];
    let aWins = 0;
    const trials = 60;
    for (let seed = 0; seed < trials; seed++) {
      // Strong A vs weak B, equal start momentum.
      const { players, rosterA, rosterB } = makeWorld({ aSkill: 88, bSkill: 60 });
      const { teamA, teamB } = makeTeams(rosterA, rosterB);
      const res = simMap(teamA, teamB, players, MAP_ID, COMP, COMP, 'atk', createRng(90000 + seed));
      if (res.winner === 'A') aWins++;
    }
    assert(aWins > trials * 0.70, `strong team wins majority even with momentum in play (${aWins}/${trials})`);
  }

  section('momentum — eco-vs-full upset causes stakes amplification');
  {
    // A team on eco (low credits) vs a full-buy opponent: stakes amplifier should be ECO_UPSET.
    const amp = stakesAmplifier({
      scoreA: 3, scoreB: 6,
      roundNo: 7,
      atkEconType: 'eco',
      defEconType: 'full'
    });
    assert(amp > 1, `eco-vs-full produces amplifier > 1 (got ${amp})`);
    assert(amp <= 1 + M.STAKES_ECO_UPSET + 1e-9, `eco amplifier bounded by STAKES_ECO_UPSET (got ${amp})`);
  }

  section('momentum — match-point amplifier is larger than eco-upset amplifier');
  {
    const mpAmp = 1 + M.STAKES_MATCH_POINT;
    const ecoAmp = 1 + M.STAKES_ECO_UPSET;
    assert(mpAmp > ecoAmp, `match-point amplifier (${mpAmp}) > eco-upset amplifier (${ecoAmp})`);
  }

  section('momentum — overtime amplifier is larger than match-point amplifier');
  {
    const otAmp = 1 + M.STAKES_OT;
    const mpAmp = 1 + M.STAKES_MATCH_POINT;
    assert(otAmp > mpAmp, `OT amplifier (${otAmp}) > match-point amplifier (${mpAmp})`);
  }
}
