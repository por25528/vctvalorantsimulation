/**
 * engine/career/chemistry.js — team chemistry & language cohesion (P12.2).
 *
 * PURE, rng-free. Turns a roster's shared languages + the team's evolving
 * `chemistry` (which folds together results history and roster continuity) into a
 * single DETERMINISTIC multiplier on team strength, capped at ±CHEM_MAX so it
 * perturbs — never erases — the underlying skill gap.
 *
 * Language model (faithful to pro VCT, with an English lingua-franca fallback):
 * over the 10 pairs of the starting five, a pair communicates perfectly (1.0)
 * when they share a NATIVE (primary) language, gets by on a common second tongue
 * (ENGLISH_SOFTEN) when they merely share one, and hits a real barrier (0) when
 * they share nothing. Familiarity (time together) is captured by team.chemistry,
 * which rises with wins/continuity and drops on a fresh signing.
 *
 * Because the multiplier only SCALES existing duel weights/probabilities (it adds
 * no rng draw), same-seed determinism is preserved end to end.
 */

import { BALANCE } from '../../config/balance.js';
import { teamTraitChem } from './traits.js';

const C = BALANCE.CAREER.CHEMISTRY;
const NEUTRAL_RAW = 0.5; // the blend value that maps to a 1.0 (no-op) multiplier

/** First five valid roster ids → player objects (the lineup the engine fields). */
function startingFive(team, players) {
  const roster = team && Array.isArray(team.roster) ? team.roster : [];
  const out = [];
  for (const id of roster) {
    if (typeof id === 'string' && id.length > 0 && players && players[id]) out.push(players[id]);
    if (out.length >= 5) break;
  }
  return out;
}

/** A player's languages, primary first; missing → English (neutral). */
function langsOf(p) {
  const l = p && Array.isArray(p.languages) ? p.languages.filter((x) => typeof x === 'string' && x) : null;
  return l && l.length ? l : ['en'];
}

/**
 * Cohesion for one pair:
 *   1.0           — same NATIVE (primary) language (e.g. two Koreans).
 *   ENGLISH_SOFTEN— share only a SECOND language, i.e. they get by in English
 *                   with some friction (e.g. a Brazilian and a Turk).
 *   0             — no shared language at all (a real barrier).
 */
function pairCohesion(a, b) {
  const la = langsOf(a);
  const lb = langsOf(b);
  if (la[0] === lb[0]) return 1;
  const setB = new Set(lb);
  for (const x of la) { if (setB.has(x)) return C.ENGLISH_SOFTEN; }
  return 0;
}

/**
 * Mean language cohesion over the starting five's pairs (0..1). A solo/empty
 * lineup returns a neutral 0.6 (no barrier).
 * @param {object[]} fivePlayers
 * @returns {number}
 */
export function languageCohesion(fivePlayers) {
  const five = Array.isArray(fivePlayers) ? fivePlayers : [];
  if (five.length < 2) return 0.6;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < five.length; i += 1) {
    for (let j = i + 1; j < five.length; j += 1) {
      sum += pairCohesion(five[i], five[j]);
      pairs += 1;
    }
  }
  return pairs > 0 ? sum / pairs : 0.6;
}

/**
 * The deterministic chemistry multiplier for a team's lineup. Blends language
 * cohesion (LANG_WEIGHT) with the team's stored chemistry+continuity (the rest),
 * optionally lifted by a coach's chemistry bonus, mapped to [1−CHEM_MAX, 1+CHEM_MAX].
 *
 * @param {object} team
 * @param {Record<string,object>} players
 * @param {{ coachChem?:number }} [opts]  coachChem: flat 0..100-scale chemistry lift (P12.5)
 * @returns {number} multiplier centered on 1.0
 */
export function teamChemistryMultiplier(team, players, opts = {}) {
  const five = startingFive(team, players);
  const langC = languageCohesion(five);
  const chemRaw = team && typeof team.chemistry === 'number' ? team.chemistry : C.CHEM_BASE;
  const coachChem = typeof opts.coachChem === 'number' ? opts.coachChem : 0;
  const traitChem = teamTraitChem(five); // mentor/leader lift, hothead drags
  const chemN = Math.max(0, Math.min(100, chemRaw + coachChem + traitChem)) / 100;
  const chemWeight = C.FAMILIARITY_WEIGHT + C.RESULTS_WEIGHT; // continuity + results folded into team.chemistry
  const raw = C.LANG_WEIGHT * langC + chemWeight * chemN;
  const mult = 1 + 2 * C.CHEM_MAX * (raw - NEUTRAL_RAW);
  return Math.max(1 - C.CHEM_MAX, Math.min(1 + C.CHEM_MAX, mult));
}

/**
 * Drift a team's stored chemistry after a slot: toward CHEM_BASE (mean-revert),
 * plus a kick for the slot's map record (won/lost). Pure.
 * @param {number} chem current team.chemistry
 * @param {{ won:boolean }} outcome
 * @returns {number} new chemistry (0..100)
 */
export function driftChemistry(chem, outcome) {
  const cur = typeof chem === 'number' ? chem : C.CHEM_BASE;
  const reverted = cur + C.CHEM_REVERT * (C.CHEM_BASE - cur);
  const kick = outcome && outcome.won ? C.CHEM_WIN : -C.CHEM_LOSS;
  return Math.max(0, Math.min(100, reverted + kick));
}

/**
 * Initial chemistry for a roster after the transfer window: start from CHEM_BASE
 * and dock NEW_SIGNING_PENALTY for each fresh face (continuity matters). Pure.
 * @param {number} newSignings count of players new to the roster this window
 * @returns {number}
 */
export function initialChemistry(newSignings) {
  const n = Math.max(0, Math.floor(typeof newSignings === 'number' ? newSignings : 0));
  return Math.max(0, Math.min(100, C.CHEM_BASE - n * C.NEW_SIGNING_PENALTY));
}
