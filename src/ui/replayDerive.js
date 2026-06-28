/**
 * ui/replayDerive.js — round-by-round replay view-model for the match viewer.
 *
 * Turns a played MapResult into a normalized per-round timeline a spectator
 * screen can play back beat by beat: the running score, the engine's TRUE
 * decay-smoothed momentum scalars, the ult-ready/fire flags, the buy tier per
 * team, and the notable "beats" of each round (pistol, eco steal, ult round,
 * ace, clutch, match point, map won).
 *
 * Source of truth, in order of preference:
 *   1. `mapResult.replay` — the OPTIONAL timeline the engine records when
 *      simulated with `{ replay: true }` (engine/match/mapSim.js). Exact.
 *   2. Otherwise the timeline is RECONSTRUCTED deterministically from the
 *      already-persisted `mapResult.rounds` (+ comps + sideStartA) by replaying
 *      the same pure engine functions the loop used (`updateMomentum`,
 *      `createUltState`/`advanceUltState`). This makes the viewer work on plain
 *      season data (which doesn't carry `replay`) with byte-identical results.
 *
 * PURE: no DOM, no rng, no Date — a deterministic function of its input. Heavy
 * presentation maths lives here (per AGENTS.md) so the screen/component stay thin.
 *
 * @typedef {import('../engine/match/mapSim.js').MapResult} MapResult
 */

import { BALANCE } from '../config/balance.js';
import { updateMomentum } from '../engine/match/momentum.js';
import { createUltState, advanceUltState } from '../engine/match/abilities.js';

/** Rounds that open a half are always pistols (mirror roundSim/economy). */
const PISTOL_ROUNDS = Object.freeze([1, 13]);

/**
 * Team A's side for a 1-indexed round given its first-half side. Mirrors the
 * (private) `sideForA` schedule in mapSim.js so kills can be split per team when
 * reconstructing from round logs. Deterministic, rng-free.
 * @param {number} roundNo
 * @param {'atk'|'def'} sideStartA
 * @returns {'atk'|'def'}
 */
function sideForA(roundNo, sideStartA) {
  const half = BALANCE.ROUNDS_TO_WIN;
  const flip = (s) => (s === 'atk' ? 'def' : 'atk');
  if (roundNo < half) return sideStartA;
  const regulationRounds = 2 * (half - 1);
  if (roundNo <= regulationRounds) return flip(sideStartA);
  const otIndex = Math.floor((roundNo - regulationRounds - 1) / BALANCE.OT_WIN_BY);
  return otIndex % 2 === 0 ? sideStartA : flip(sideStartA);
}

/**
 * Has the map ended at this score? Mirrors mapSim.mapOver (regulation: first to
 * ROUNDS_TO_WIN; overtime: win-by OT_WIN_BY once both reach the tie threshold).
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
function mapOver(a, b) {
  const win = BALANCE.ROUNDS_TO_WIN;
  const otBy = BALANCE.OT_WIN_BY;
  const tie = win - 1;
  if (a >= tie && b >= tie) return Math.abs(a - b) >= otBy;
  return a >= win || b >= win;
}

/** Count kills per team for a round log using the round's side assignment. */
function killsPerTeam(log, sideA) {
  let A = 0;
  let B = 0;
  const events = log && Array.isArray(log.events) ? log.events : [];
  for (const ev of events) {
    if (ev.killerSide === sideA) A += 1;
    else B += 1;
  }
  return { A, B };
}

/** The round's first-blood event (the only one flagged isFirstBlood), or null. */
function firstBloodOf(log) {
  const events = log && Array.isArray(log.events) ? log.events : [];
  for (const ev of events) {
    if (ev && ev.isFirstBlood) return { killerId: ev.killerId, victimId: ev.victimId, killerSide: ev.killerSide };
  }
  return null;
}

/** The id of any player with 5 kills this round (an ace clears the side), or null. */
function aceOf(log) {
  const events = log && Array.isArray(log.events) ? log.events : [];
  const counts = new Map();
  for (const ev of events) {
    if (!ev || typeof ev.killerId !== 'string') continue;
    const c = (counts.get(ev.killerId) || 0) + 1;
    counts.set(ev.killerId, c);
    if (c >= 5) return ev.killerId;
  }
  return null;
}

/**
 * Build the per-round "base" facts — sourced from `mapResult.replay` when the
 * engine recorded it, otherwise reconstructed from the round logs. Events (for
 * first blood / aces) always come from the logs.
 * @param {MapResult} mapResult
 * @returns {Array<object>}
 */
function buildBase(mapResult) {
  const rounds = (mapResult && Array.isArray(mapResult.rounds)) ? mapResult.rounds : [];
  const replay = mapResult && Array.isArray(mapResult.replay) && mapResult.replay.length === rounds.length
    ? mapResult.replay
    : null;
  const sideStartA = mapResult && mapResult.sideStartA === 'def' ? 'def' : 'atk';

  const base = [];

  if (replay) {
    // Engine-recorded — exact values, just attach the events for each round.
    for (let i = 0; i < replay.length; i += 1) {
      const r = replay[i];
      const log = rounds[i] || {};
      base.push({
        n: r.n,
        winnerTeam: r.winnerTeam,
        sideA: r.sideA,
        endCondition: r.endCondition,
        planted: !!r.planted,
        clutchPlayerId: r.clutchPlayerId || null,
        econ: { A: r.econ.A, B: r.econ.B },
        score: { A: r.score.A, B: r.score.B },
        momentum: { A: r.momentumAfter.A, B: r.momentumAfter.B },
        momentumBefore: { A: r.momentumBefore.A, B: r.momentumBefore.B },
        ult: { A: !!r.ultReady.A, B: !!r.ultReady.B },
        kills: { A: r.kills.A, B: r.kills.B },
        firstBlood: firstBloodOf(log),
        aceId: aceOf(log)
      });
    }
    return base;
  }

  // Reconstruct deterministically from the round logs (no rng).
  let momA = 0;
  let momB = 0;
  let ultA = createUltState(mapResult ? mapResult.compA : []);
  let ultB = createUltState(mapResult ? mapResult.compB : []);
  let scoreA = 0;
  let scoreB = 0;

  for (let i = 0; i < rounds.length; i += 1) {
    const log = rounds[i] || {};
    const n = typeof log.n === 'number' ? log.n : i + 1;
    const sideA = sideForA(n, sideStartA);
    const won = log.winnerTeam === 'A';

    const ultReadyA = ultA.ready;
    const ultReadyB = ultB.ready;
    const momBeforeA = momA;
    const momBeforeB = momB;

    if (won) scoreA += 1;
    else scoreB += 1;

    momA = updateMomentum(momA, won);
    momB = updateMomentum(momB, !won);

    const k = killsPerTeam(log, sideA);
    ultA = advanceUltState(ultA, k.A, won);
    ultB = advanceUltState(ultB, k.B, !won);

    const econ = log.economy || { A: {}, B: {} };
    base.push({
      n,
      winnerTeam: log.winnerTeam,
      sideA,
      endCondition: log.endCondition,
      planted: !!log.planted,
      clutchPlayerId: log.clutchPlayerId || null,
      econ: { A: econ.A ? econ.A.type : 'eco', B: econ.B ? econ.B.type : 'eco' },
      score: { A: scoreA, B: scoreB },
      momentum: { A: momA, B: momB },
      momentumBefore: { A: momBeforeA, B: momBeforeB },
      ult: { A: ultReadyA, B: ultReadyB },
      kills: { A: k.A, B: k.B },
      firstBlood: firstBloodOf(log),
      aceId: aceOf(log)
    });
  }
  return base;
}

/**
 * Derive the full replay view-model for one map.
 *
 * @param {MapResult} mapResult
 * @returns {{ rounds: Array<object>, summary: object }}
 *   `rounds[i]` carries: n, winnerTeam, sideA, score{A,B}, lead, momentum{A,B},
 *   swing (signed lead-momentum change toward A), econ{A,B}, ult{A,B},
 *   ecoUpset, ultRound, isPistol, isOT, isMatchPoint, decided (ended the map),
 *   firstBlood, clutchPlayerId, aceId, kills{A,B}, tags[] (ordered beat keys).
 */
export function deriveMapReplay(mapResult) {
  const base = buildBase(mapResult);
  const finalA = mapResult && mapResult.score ? (mapResult.score.A || 0) : 0;
  const finalB = mapResult && mapResult.score ? (mapResult.score.B || 0) : 0;

  let ecoUpsets = 0;
  let ultRounds = 0;
  let clutches = 0;
  let wentOT = false;
  const pistolsWon = { A: 0, B: 0 };

  const out = base.map((r) => {
    const beforeA = r.score.A - (r.winnerTeam === 'A' ? 1 : 0);
    const beforeB = r.score.B - (r.winnerTeam === 'B' ? 1 : 0);

    const isPistol = PISTOL_ROUNDS.includes(r.n) || r.econ.A === 'pistol' || r.econ.B === 'pistol';
    const isOT = beforeA >= BALANCE.ROUNDS_TO_WIN - 1 && beforeB >= BALANCE.ROUNDS_TO_WIN - 1;
    const isMatchPoint = mapOver(beforeA + 1, beforeB) || mapOver(beforeA, beforeB + 1);
    const decided = mapOver(r.score.A, r.score.B);

    const winEcon = r.econ[r.winnerTeam];
    const loseEcon = r.econ[r.winnerTeam === 'A' ? 'B' : 'A'];
    const ecoUpset = (winEcon === 'eco' || winEcon === 'force') && loseEcon === 'full';
    const ultRound = !!(r.ult.A || r.ult.B);

    const swing = (r.momentum.A - r.momentum.B) - (r.momentumBefore.A - r.momentumBefore.B);

    if (ecoUpset) ecoUpsets += 1;
    if (ultRound) ultRounds += 1;
    if (r.clutchPlayerId) clutches += 1;
    if (isOT) wentOT = true;
    if (isPistol) pistolsWon[r.winnerTeam] += 1;

    const tags = [];
    if (isPistol) tags.push('pistol');
    if (ecoUpset) tags.push('eco');
    if (ultRound) tags.push('ult');
    if (r.aceId) tags.push('ace');
    if (r.clutchPlayerId) tags.push('clutch');
    if (decided) tags.push('mapwon');
    else if (isMatchPoint) tags.push('matchpoint');

    return {
      n: r.n,
      winnerTeam: r.winnerTeam,
      sideA: r.sideA,
      score: { A: r.score.A, B: r.score.B },
      lead: r.score.A - r.score.B,
      momentum: { A: r.momentum.A, B: r.momentum.B },
      swing,
      econ: { A: r.econ.A, B: r.econ.B },
      ult: { A: !!r.ult.A, B: !!r.ult.B },
      kills: { A: r.kills.A, B: r.kills.B },
      endCondition: r.endCondition,
      planted: r.planted,
      ecoUpset,
      ultRound,
      isPistol,
      isOT,
      isMatchPoint,
      decided,
      firstBlood: r.firstBlood,
      clutchPlayerId: r.clutchPlayerId,
      aceId: r.aceId,
      tags
    };
  });

  const winner = finalA > finalB ? 'A' : finalB > finalA ? 'B' : (mapResult && mapResult.winner) || null;

  return {
    rounds: out,
    summary: {
      winner,
      score: { A: finalA, B: finalB },
      totalRounds: out.length,
      mvpPlayerId: (mapResult && mapResult.mvpPlayerId) || null,
      ecoUpsets,
      ultRounds,
      clutches,
      wentOT,
      pistolsWon
    }
  };
}
