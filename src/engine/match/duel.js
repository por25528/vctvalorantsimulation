/**
 * engine/match/duel.js — ONE gunfight resolution (CONTRACTS §9-11).
 *
 * `duelRating(player, ctx)` turns a player + RoundContext into a single scalar
 * "how likely to win this gunfight" rating. `resolveDuel` puts two ratings head
 * to head through a logistic on their difference and returns the winner.
 *
 * This module owns NO trade logic — the caller (roundSim) handles trades. It is
 * pure: no DOM, no Math.random / Date.now, all randomness via the injected Rng,
 * every tuning number imported from config/balance.js. Runs unchanged in Node
 * and the browser (plain ES modules, named exports only).
 *
 * Rating model (all factors multiply a weighted-attribute base, except the
 * additive clutch term which is applied before econ so it scales with buy):
 *   base   = Σ DUEL_WEIGHTS[k] * attr[k]                      // ~0..100
 *   +clutch= isClutch ? ((composure-50)/100) * CLUTCH_WEIGHT * base : 0
 *   *dyn   = 1 + FORM_WEIGHT*(form/100) - FATIGUE_WEIGHT*(fatigue/100)
 *                 + MORALE_WEIGHT*((morale-50)/100)
 *   *prof  = mapProf & agentProf multipliers, each 1 + WEIGHT*((p-50)/100)
 *   *econ  = ctx.econFactor
 * On pistol econ the spread is compressed toward PISTOL_NEUTRAL by
 * PISTOL_AIM_DAMPEN so aim matters less when everyone holds a Classic.
 */

import { BALANCE } from '../../config/balance.js';
import { traitDuelMod } from '../career/traits.js';

/**
 * @typedef {object} RoundContext
 * @property {'atk'|'def'} side
 * @property {'pistol'|'eco'|'force'|'full'} econType
 * @property {number} econFactor multiplier applied to the rating (see ECON_FACTOR)
 * @property {boolean} isClutch  true when this player is last-alive on their side
 * @property {string} [mapId]    optional; enables map-proficiency weighting
 * @property {string} [agentId]  optional; enables agent-proficiency weighting
 * @property {number} [teamFactor] optional team chemistry multiplier (default 1; P12.2)
 * @property {number} [roundNo]    optional 1-indexed round number (enables trait timing; P12.3)
 */

/**
 * Neutral midpoint the pistol dampener compresses ratings toward. Attributes are
 * 0..100 and DUEL_WEIGHTS sum to ~1, so a perfectly average lineup rates ~50.
 * Centralizing it here keeps the only literal in one named place.
 */
const PISTOL_NEUTRAL = 50;

/**
 * Proficiency baseline: a missing/neutral proficiency entry sits at 50 (matches
 * domain PROFICIENCY_BASELINE) and contributes a 1.0 (no-op) multiplier.
 */
const PROFICIENCY_BASELINE = 50;

/**
 * How strongly map/agent proficiency swings the rating. Proficiency is 0..100;
 * a value of 100 gives +PROFICIENCY_WEIGHT, a value of 0 gives -PROFICIENCY_WEIGHT.
 * Kept local (not a balance global) because it is specific to this resolver's
 * proficiency coupling, not a shared tuning knob in CONTRACTS §8.
 */
const PROFICIENCY_WEIGHT = 0.10;

/**
 * Safely read a numeric attribute, treating anything non-finite as 0 so a
 * malformed player can never produce a NaN rating.
 * @param {Record<string, number>|undefined} attrs
 * @param {string} key
 * @returns {number}
 */
function attr(attrs, key) {
  const v = attrs ? attrs[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Look up a proficiency value (0..100) from a player's proficiency sub-map,
 * defaulting to the neutral baseline when absent. Returns a multiplier centered
 * on 1.0: baseline -> 1.0, 100 -> 1+PROFICIENCY_WEIGHT, 0 -> 1-PROFICIENCY_WEIGHT.
 * @param {Record<string, number>|undefined} map
 * @param {string|undefined} id
 * @returns {number} multiplier
 */
function proficiencyMultiplier(map, id) {
  let p = PROFICIENCY_BASELINE;
  if (map && typeof id === 'string' && typeof map[id] === 'number' && Number.isFinite(map[id])) {
    p = map[id];
  }
  return 1 + PROFICIENCY_WEIGHT * ((p - PROFICIENCY_BASELINE) / 100);
}

/**
 * Compute a player's duel rating for a single gunfight in the given context.
 *
 * Applies DUEL_WEIGHTS over attributes, then layers (in order) the clutch
 * composure bonus, the form/fatigue/morale dynamics factor, map & agent
 * proficiency factors (when available on the player and identified in ctx), and
 * finally the economy factor. Pistol econ compresses the spread toward
 * PISTOL_NEUTRAL via PISTOL_AIM_DAMPEN.
 *
 * Never mutates its inputs; returns a fresh number.
 * @param {import('../../domain/player.js').Player} player
 * @param {RoundContext} ctx
 * @returns {number} non-negative duel rating
 */
export function duelRating(player, ctx) {
  const attrs = player && player.attributes;
  const dyn = (player && player.dynamics) || {};
  const prof = (player && player.proficiency) || {};
  const context = ctx || {};

  // 1. Weighted attribute base (~0..100).
  let base = 0;
  const weights = BALANCE.DUEL_WEIGHTS;
  for (const key of Object.keys(weights)) {
    base += weights[key] * attr(attrs, key);
  }

  // 2. Clutch composure bonus (additive, scales with the base buy strength).
  if (context.isClutch) {
    const composure = attr(attrs, 'composure');
    base += ((composure - 50) / 100) * BALANCE.CLUTCH_WEIGHT * base;
  }

  // 3. Dynamics: form lifts, fatigue drags, morale nudges. Clamp the multiplier
  //    to stay positive so the rating can never go negative.
  const form = typeof dyn.form === 'number' && Number.isFinite(dyn.form) ? dyn.form : 0;
  const fatigue = typeof dyn.fatigue === 'number' && Number.isFinite(dyn.fatigue) ? dyn.fatigue : 0;
  const morale = typeof dyn.morale === 'number' && Number.isFinite(dyn.morale) ? dyn.morale : 50;
  let dynFactor =
    1 +
    BALANCE.FORM_WEIGHT * (form / 100) -
    BALANCE.FATIGUE_WEIGHT * (fatigue / 100) +
    BALANCE.MORALE_WEIGHT * ((morale - 50) / 100);
  if (dynFactor < 0) dynFactor = 0;
  let rating = base * dynFactor;

  // 3b. Team chemistry (P12.2): a deterministic per-side multiplier (language
  //     cohesion + evolving chemistry). Default 1 (no-op) when not supplied.
  const teamFactor =
    typeof context.teamFactor === 'number' && Number.isFinite(context.teamFactor) && context.teamFactor > 0
      ? context.teamFactor
      : 1;
  rating *= teamFactor;

  // 3c. Personality traits (P12.3): clutch/big-game/starter reactions to the
  //     moment. Pure function of the player's traits + ctx (no rng); default 1.
  //     Stakes amplification: scale the deviation from 1 so high-pressure rounds
  //     produce larger trait swings (clutch/bigGame lift more; choker drags more).
  const rawTraitMod = traitDuelMod(player, context);
  const stakesAmp =
    typeof context.stakesAmplifier === 'number' && Number.isFinite(context.stakesAmplifier) && context.stakesAmplifier > 0
      ? context.stakesAmplifier
      : 1;
  const traitMod = 1 + (rawTraitMod - 1) * stakesAmp;
  rating *= traitMod > 0 ? traitMod : 0;

  // 3d. Momentum factor: per-team win/loss-streak pressure within the map.
  //     Bounded to [1-DUEL_MAX, 1+DUEL_MAX] so it tilts but never erases skill.
  const momentumFactor =
    typeof context.momentumFactor === 'number' && Number.isFinite(context.momentumFactor) && context.momentumFactor > 0
      ? context.momentumFactor
      : 1;
  rating *= momentumFactor;

  // 4. Proficiency factors (only meaningful when ctx identifies map/agent and
  //    the player carries the corresponding proficiency entry).
  rating *= proficiencyMultiplier(prof.maps, context.mapId);
  rating *= proficiencyMultiplier(prof.agents, context.agentId);

  // 5. Economy factor.
  const econFactor =
    typeof context.econFactor === 'number' && Number.isFinite(context.econFactor) ? context.econFactor : 1;
  rating *= econFactor;

  // 6. Pistol dampener: compress the spread toward the neutral midpoint so aim
  //    differences matter less when both teams are on pistols.
  if (context.econType === 'pistol') {
    rating = PISTOL_NEUTRAL + (rating - PISTOL_NEUTRAL) * BALANCE.PISTOL_AIM_DAMPEN;
  }

  return rating < 0 ? 0 : rating;
}

/**
 * Resolve one gunfight between player A and player B.
 *
 * Computes each side's duelRating in its own context, then runs a logistic on
 * (ratingA - ratingB) / DUEL_SCALE to get P(A wins). A single rng.next() draw
 * decides the winner, so the result is deterministic for a given rng stream.
 *
 * @param {import('../../domain/player.js').Player} pA
 * @param {import('../../domain/player.js').Player} pB
 * @param {RoundContext} ctxA context for A
 * @param {RoundContext} ctxB context for B
 * @param {import('../../core/rng.js').Rng} rng injected PRNG
 * @returns {'A'|'B'} winner
 */
export function resolveDuel(pA, pB, ctxA, ctxB, rng) {
  const ratingA = duelRating(pA, ctxA);
  const ratingB = duelRating(pB, ctxB);
  const pAWin = 1 / (1 + Math.exp(-(ratingA - ratingB) / BALANCE.DUEL_SCALE));
  return rng.next() < pAWin ? 'A' : 'B';
}
