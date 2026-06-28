/**
 * engine/match/matchSim.js — top-level series simulation (CONTRACTS §9, §10).
 *
 * `simSeries(teamA, teamB, players, bestOf, seed)` is the public entry point of
 * the match engine. It:
 *   1. builds a single deterministic Rng from `seed` (createRng),
 *   2. runs the veto (runVeto) to get the ordered list of maps that could be
 *      played plus the pick/ban record,
 *   3. plays maps in veto order up to the clinch: for each map it selects a
 *      proficiency-weighted comp per team (selectComp), alternates which team
 *      starts on attack, and simulates the map (simMap),
 *   4. stops as soon as a team reaches the required wins (ceil(bestOf/2)),
 *   5. aggregates everything into an immutable Series (CONTRACTS §9 shape).
 *
 * Determinism: every random decision flows through the one injected Rng built
 * from `seed`; calling order is fixed (veto, then per map: compA, compB, simMap)
 * so a given seed always reproduces the same Series. No Math.random / Date.now /
 * window / document. All tuning numbers come from config/balance.js (via the
 * modules this orchestrates); the only literal here is the win-count derivation
 * ceil(bestOf/2), which is the definition of "best of" rather than a tunable.
 *
 * Immutability (CONTRACTS §15): inputs are never mutated; the returned Series and
 * its nested arrays/objects are fresh. Named exports only; runs unchanged in Node
 * and the browser (plain ES modules).
 *
 * @typedef {import('../../domain/team.js').Team} Team
 * @typedef {import('../../domain/player.js').Player} Player
 * @typedef {import('./mapSim.js').MapResult} MapResult
 * @typedef {import('./veto.js').VetoPick} VetoPick
 * @typedef {string[]} Comp
 */

import { createRng } from '../../core/rng.js';
import { makeId } from '../../core/id.js';
import { runVeto } from './veto.js';
import { selectComp } from './composition.js';
import { simMap } from './mapSim.js';
import { teamChemistryMultiplier } from '../career/chemistry.js';

/**
 * @typedef Series
 * @property {string} id
 * @property {string} teamAId
 * @property {string} teamBId
 * @property {number} bestOf
 * @property {number} seed
 * @property {{ picks: VetoPick[] }} veto
 * @property {MapResult[]} maps
 * @property {{A:number,B:number}} score
 * @property {string} winnerId
 */

/**
 * Wins required to clinch a best-of-N series: ceil(N/2).
 * (Bo1->1, Bo3->2, Bo5->3.) This is the mathematical definition of the series
 * length, not a balance constant, so it is computed inline.
 * @param {number} bestOf
 * @returns {number}
 */
function winsToClinch(bestOf) {
  const n = Number.isInteger(bestOf) && bestOf > 0 ? bestOf : 3;
  return Math.floor(n / 2) + 1;
}

/**
 * A stable team id for the Series shape. Prefers the team's own id, falling back
 * to its tag/name so a terse team object still yields a usable identifier.
 * @param {Team} team
 * @param {'A'|'B'} slot
 * @returns {string}
 */
function teamIdOf(team, slot) {
  if (team && typeof team === 'object') {
    if (typeof team.id === 'string' && team.id.length > 0) return team.id;
    if (typeof team.tag === 'string' && team.tag.length > 0) return team.tag;
    if (typeof team.name === 'string' && team.name.length > 0) return team.name;
  }
  return slot === 'A' ? 'teamA' : 'teamB';
}

/**
 * Simulate a full best-of-N series and return a fresh Series (CONTRACTS §9).
 *
 * @param {Team} teamA   first team (its first 5 roster ids are the active lineup).
 * @param {Team} teamB   second team.
 * @param {Record<string, Player>} players  playerId -> Player lookup, threaded down.
 * @param {number} bestOf  series length (1, 3 or 5; others fall back to Bo3).
 * @param {number} seed   integer seed; the whole series derives from createRng(seed).
 * @param {{ coachChemA?:number, coachChemB?:number, replay?:boolean }} [ctx]  optional
 *   coach chemistry lifts (P12.5) and a `replay` flag. When `replay:true`, every
 *   played map carries a per-round `replay` timeline (`MapResult.replay`). The
 *   flag is rng-free, so `seed` reproduces byte-identical maps/box-scores/score
 *   with or without it (the replay is purely an extra, additive field).
 * @returns {Series}
 */
export function simSeries(teamA, teamB, players, bestOf, seed, ctx = {}) {
  const rng = createRng(seed);
  const boN = Number.isInteger(bestOf) && bestOf > 0 ? bestOf : 3;
  const target = winsToClinch(boN);
  const mapOpts = ctx && ctx.replay ? { replay: true } : undefined;

  const teamAId = teamIdOf(teamA, 'A');
  const teamBId = teamIdOf(teamB, 'B');

  // P12.2 — chemistry multipliers, computed ONCE per series (rosters/languages
  // are fixed within a series). Deterministic (no rng); default ~1.0 for teams
  // without P12 chemistry fields, so standalone callers are unaffected.
  const chemA = teamChemistryMultiplier(teamA, players, { coachChem: ctx.coachChemA });
  const chemB = teamChemistryMultiplier(teamB, players, { coachChem: ctx.coachChemB });

  // 1) Veto: ordered candidate maps + pick/ban record.
  const veto = runVeto(teamA, teamB, players, boN, rng);
  const mapsToPlay = Array.isArray(veto.mapsToPlay) ? veto.mapsToPlay : [];

  /** @type {MapResult[]} */
  const maps = [];
  const score = { A: 0, B: 0 };

  // 2) Play maps in veto order until a team clinches (or the veto list is spent).
  for (let i = 0; i < mapsToPlay.length; i++) {
    if (score.A >= target || score.B >= target) break;

    const mapId = mapsToPlay[i];

    // Comps are chosen per map; A before B keeps the rng order deterministic.
    const compA = selectComp(teamA, players, mapId, rng);
    const compB = selectComp(teamB, players, mapId, rng);

    // Alternate which team starts on attack each map (team A attacks first on
    // the opening map, then they swap). This is a fixed, deterministic schedule.
    const sideStartA = i % 2 === 0 ? 'atk' : 'def';

    const result = simMap(teamA, teamB, players, mapId, compA, compB, sideStartA, rng, chemA, chemB, mapOpts);
    maps.push(result);

    if (result.winner === 'A') score.A += 1;
    else score.B += 1;
  }

  const winnerId = score.A > score.B ? teamAId : teamBId;

  return {
    id: makeId('series', teamAId, teamBId, seed),
    teamAId,
    teamBId,
    bestOf: boN,
    seed,
    veto: { picks: Array.isArray(veto.picks) ? veto.picks.map((p) => ({ mapId: p.mapId, by: p.by })) : [] },
    maps,
    score: { A: score.A, B: score.B },
    winnerId
  };
}
