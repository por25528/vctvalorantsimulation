/**
 * engine/match/mapSim.js — full single-map simulation (CONTRACTS §9, §10, §11).
 *
 * `simMap(teamA, teamB, players, mapId, compA, compB, sideStartA, rng)` plays a
 * map to BALANCE.ROUNDS_TO_WIN (13) with overtime win-by-2 (OT_WIN_BY), swapping
 * sides at the halftime boundary (and every OT_WIN_BY rounds in overtime), and
 * returns a brand-new MapResult.
 *
 * Each round it threads the economy (decideBuy per side -> simRound ->
 * applyRoundResult) and accumulates the box score, then finalizes ratings and
 * picks the MVP after the last round.
 *
 * Pure & immutable (CONTRACTS §15): inputs are never mutated, the returned
 * MapResult and all nested RoundLogs are fresh objects. All randomness flows
 * through the injected Rng (CONTRACTS §1); no Math.random / Date.now / window /
 * document. Every tuning number comes from config/balance.js. Named exports only;
 * runs unchanged in Node and the browser (plain ES modules).
 *
 * @typedef {import('./boxScore.js').RoundLog} RoundLog
 * @typedef {import('./boxScore.js').PlayerMapStat} PlayerMapStat
 * @typedef {import('../../domain/player.js').Player} Player
 * @typedef {import('../../domain/team.js').Team} Team
 * @typedef {string[]} Comp
 */

import { BALANCE } from '../../config/balance.js';
import { decideBuy, createEconomy, applyRoundResult } from './economy.js';
import { simRound } from './roundSim.js';
import { createBoxScore, accumulate, finalize, pickMvp } from './boxScore.js';
import { createUltState, advanceUltState, compProfile } from './abilities.js';
import { updateMomentum } from './momentum.js';

/**
 * @typedef MapResult
 * @property {string} mapId
 * @property {{A:number,B:number}} score
 * @property {'atk'|'def'} sideStartA
 * @property {Comp} compA
 * @property {Comp} compB
 * @property {RoundLog[]} rounds
 * @property {Record<string, PlayerMapStat>} boxScore
 * @property {string|null} mvpPlayerId
 * @property {'A'|'B'} winner
 * @property {{A:number,B:number}} ultUsage  rounds where each team's ult fired
 * @property {{A:object,B:object}} abilityProfile  comp archetype counts per team
 * @property {ReplayRound[]} [replay]  OPTIONAL per-round timeline (only when opts.replay)
 */

/**
 * One entry of the OPTIONAL round-by-round replay timeline. It surfaces values
 * the engine already computes in the round loop (running score, the true
 * decay-smoothed momentum scalars BEFORE/AFTER the round, the ult-ready/fire
 * flags, the buy tier, and the key duel/clutch outcome) so a viewer can play the
 * map back beat by beat. Built only from already-computed loop values — it
 * consumes NO rng, so enabling it never shifts an existing draw (additive &
 * deterministic, exactly like momentum/abilities were added).
 *
 * @typedef ReplayRound
 * @property {number} n round number (1-indexed)
 * @property {'atk'|'def'} sideA team A's side this round
 * @property {'A'|'B'} winnerTeam
 * @property {'elim'|'spike'|'defuse'|'time'} endCondition
 * @property {boolean} planted
 * @property {string|null} clutchPlayerId
 * @property {{A:number,B:number}} score running map score AFTER this round
 * @property {{A:number,B:number}} momentumBefore momentum scalars used FOR this round
 * @property {{A:number,B:number}} momentumAfter momentum scalars after the update
 * @property {{A:('pistol'|'eco'|'force'|'full'),B:('pistol'|'eco'|'force'|'full')}} econ buy tier per team
 * @property {{A:boolean,B:boolean}} ultReady whether each team's ult was charged (and thus fired) this round
 * @property {{A:number,B:number}} kills kills by each team this round
 */

/** Safety cap on total rounds so an OT can never loop unboundedly. */
const MAX_ROUNDS = 100;

/**
 * The active 5 for a team: its first 5 valid roster ids.
 * @param {Team} team
 * @returns {string[]}
 */
function activeFive(team) {
  const roster = team && Array.isArray(team.roster) ? team.roster : [];
  const five = [];
  for (const id of roster) {
    if (typeof id === 'string' && id.length > 0) five.push(id);
    if (five.length >= 5) break;
  }
  return five;
}

/**
 * Opposite side helper.
 * @param {'atk'|'def'} side
 * @returns {'atk'|'def'}
 */
function flip(side) {
  return side === 'atk' ? 'def' : 'atk';
}

/**
 * Resolve team A's side for a given 1-indexed round number, given its first-half
 * starting side. The first half is rounds 1..(ROUNDS_TO_WIN-1) on the starting
 * side; the second half (from ROUNDS_TO_WIN) flips. Overtime keeps flipping every
 * OT_WIN_BY rounds so both teams always play both sides.
 * @param {number} roundNo 1-indexed
 * @param {'atk'|'def'} sideStartA
 * @returns {'atk'|'def'}
 */
function sideForA(roundNo, sideStartA) {
  const half = BALANCE.ROUNDS_TO_WIN; // 13: first half = rounds 1..12, swap at 13
  if (roundNo < half) return sideStartA;

  // Regulation second half: rounds half..(2*half - 1) -> flipped.
  const regulationRounds = 2 * (half - 1); // 24
  if (roundNo <= regulationRounds) return flip(sideStartA);

  // Overtime: each OT "pair" of OT_WIN_BY rounds swaps sides, starting from the
  // first-half side again on the first OT pair (mirrors real OT alternation).
  const otIndex = Math.floor((roundNo - regulationRounds - 1) / BALANCE.OT_WIN_BY);
  return otIndex % 2 === 0 ? sideStartA : flip(sideStartA);
}

/**
 * Decide whether the map has ended given the running score.
 * Regulation: first to ROUNDS_TO_WIN. Overtime: lead of OT_WIN_BY once both
 * sides have reached ROUNDS_TO_WIN (i.e. a 12-12 in 13-format equivalent → both
 * at ROUNDS_TO_WIN-? ). We model: a team wins outright at ROUNDS_TO_WIN unless the
 * opponent also reached ROUNDS_TO_WIN-1 (a tie at ROUNDS_TO_WIN-1 forces OT),
 * after which a 2-round lead is required.
 * @param {number} a team A score
 * @param {number} b team B score
 * @returns {boolean}
 */
function mapOver(a, b) {
  const win = BALANCE.ROUNDS_TO_WIN;
  const otBy = BALANCE.OT_WIN_BY;
  const tieThreshold = win - 1; // 12: a 12-12 forces overtime

  // Overtime regime: both teams have reached the tie threshold.
  if (a >= tieThreshold && b >= tieThreshold) {
    return Math.abs(a - b) >= otBy;
  }
  // Regulation: first to ROUNDS_TO_WIN wins (opponent below tieThreshold).
  return a >= win || b >= win;
}

/**
 * Count kills per team from a RoundLog's events (killerSide mapped to team via
 * the round's side assignment for A).
 * @param {RoundLog} log
 * @param {'atk'|'def'} sideA team A's side that round
 * @returns {{killsA:number, killsB:number}}
 */
function killsPerTeam(log, sideA) {
  let killsA = 0;
  let killsB = 0;
  const events = log && Array.isArray(log.events) ? log.events : [];
  for (const ev of events) {
    if (ev.killerSide === sideA) killsA += 1;
    else killsB += 1;
  }
  return { killsA, killsB };
}

/**
 * Simulate a full map and return a fresh MapResult.
 *
 * @param {Team} teamA
 * @param {Team} teamB
 * @param {Record<string, Player>} players  playerId -> Player lookup
 * @param {string} mapId
 * @param {Comp} compA team A composition (5 agentIds)
 * @param {Comp} compB team B composition (5 agentIds)
 * @param {'atk'|'def'} sideStartA team A's first-half side
 * @param {import('../../core/rng.js').Rng} rng
 * @param {number} [chemA] team A chemistry multiplier (default 1; P12.2)
 * @param {number} [chemB] team B chemistry multiplier (default 1; P12.2)
 * @param {{replay?:boolean}} [opts] optional flags; `replay:true` records a
 *   per-round timeline on the result (`MapResult.replay`). Additive & rng-free —
 *   when omitted the result is byte-identical to before.
 * @returns {MapResult}
 */
export function simMap(teamA, teamB, players, mapId, compA, compB, sideStartA, rng, chemA, chemB, opts) {
  const startSideA = sideStartA === 'def' ? 'def' : 'atk';
  // OPTIONAL replay timeline (additive — built from already-computed loop values,
  // consumes no rng). `null` means "not recording", so existing callers are unaffected.
  const recordReplay = !!(opts && opts.replay);
  /** @type {ReplayRound[]|null} */
  const replay = recordReplay ? [] : null;

  // Active 5 per team (first 5 roster ids). These ids drive both the round sim
  // alive sets and the box score roster.
  const fiveA = activeFive(teamA);
  const fiveB = activeFive(teamB);

  // Fresh economy + box score (immutable through the round loop).
  let econ = createEconomy();
  let box = createBoxScore([...fiveA, ...fiveB]);

  // Ult economy: one meter per team, seeded from their comp.
  let ultA = createUltState(compA);
  let ultB = createUltState(compB);
  const ultUsage = { A: 0, B: 0 };

  /** @type {RoundLog[]} */
  const rounds = [];
  const score = { A: 0, B: 0 };

  // Per-team momentum in [-1,+1]: starts at 0 (no streak), updated after each round.
  let momentumA = 0;
  let momentumB = 0;

  let n = 1;
  while (!mapOver(score.A, score.B) && n <= MAX_ROUNDS) {
    const sideA = sideForA(n, startSideA);
    const sideB = flip(sideA);

    // Buy decisions per side (each consumes rng deterministically). Order is
    // fixed A-before-B for determinism.
    decideBuy(econ.A, n, rng);
    decideBuy(econ.B, n, rng);

    // Ult state from the START of this round (advance happens after).
    const ultReadyA = ultA.ready;
    const ultReadyB = ultB.ready;
    if (ultReadyA) ultUsage.A += 1;
    if (ultReadyB) ultUsage.B += 1;

    // Snapshot the momentum scalars FED INTO this round (before the post-round
    // update) for the optional replay timeline.
    const momBeforeA = momentumA;
    const momBeforeB = momentumB;

    // Simulate the round. Alive sets are copies of the active fives; simRound
    // never mutates its inputs but we hand it fresh arrays regardless.
    const log = simRound(
      {
        n,
        sideA,
        sideB,
        rostersAlive: { A: fiveA.slice(), B: fiveB.slice() },
        econA: econ.A,
        econB: econ.B,
        teamA,
        teamB,
        players,
        mapId,
        chemA,
        chemB,
        compA,
        compB,
        ultReadyA,
        ultReadyB,
        momentumA,
        momentumB,
        scoreA: score.A,
        scoreB: score.B
      },
      rng
    );

    rounds.push(log);

    // Tally score.
    if (log.winnerTeam === 'A') score.A += 1;
    else score.B += 1;

    // Update momentum based on this round's outcome.
    momentumA = updateMomentum(momentumA, log.winnerTeam === 'A');
    momentumB = updateMomentum(momentumB, log.winnerTeam === 'B');

    // Accumulate the box score for this round (consumes rng for assists).
    box = accumulate(box, log, rng);

    // Thread the economy forward (immutable: new econ each round).
    const { killsA, killsB } = killsPerTeam(log, sideA);
    econ = applyRoundResult(econ, {
      winnerTeam: log.winnerTeam,
      planted: log.planted,
      killsA,
      killsB
    });

    // Advance ult meters (consumes the ready flag, accrues new points).
    ultA = advanceUltState(ultA, killsA, log.winnerTeam === 'A');
    ultB = advanceUltState(ultB, killsB, log.winnerTeam === 'B');

    // Record the optional replay beat from values already computed this round.
    if (replay) {
      const econ = log.economy || { A: {}, B: {} };
      replay.push({
        n,
        sideA,
        winnerTeam: log.winnerTeam,
        endCondition: log.endCondition,
        planted: !!log.planted,
        clutchPlayerId: log.clutchPlayerId || null,
        score: { A: score.A, B: score.B },
        momentumBefore: { A: momBeforeA, B: momBeforeB },
        momentumAfter: { A: momentumA, B: momentumB },
        econ: { A: econ.A ? econ.A.type : 'eco', B: econ.B ? econ.B.type : 'eco' },
        ultReady: { A: ultReadyA, B: ultReadyB },
        kills: { A: killsA, B: killsB }
      });
    }

    n += 1;
  }

  // Finalize ratings against the true round count, then pick the MVP.
  const finalBox = finalize(box, rounds.length);
  const mvpPlayerId = pickMvp(finalBox);

  const winner = score.A > score.B ? 'A' : 'B';

  const result = {
    mapId,
    score: { A: score.A, B: score.B },
    sideStartA: startSideA,
    compA: Array.isArray(compA) ? compA.slice() : [],
    compB: Array.isArray(compB) ? compB.slice() : [],
    rounds,
    boxScore: finalBox,
    mvpPlayerId,
    winner,
    ultUsage: { A: ultUsage.A, B: ultUsage.B },
    abilityProfile: { A: compProfile(compA), B: compProfile(compB) }
  };
  // Attach the replay timeline ONLY when requested, so the default MapResult
  // shape (and every existing test/snapshot) is untouched.
  if (replay) result.replay = replay;
  return result;
}
