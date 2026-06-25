/**
 * engine/match/momentum.js — in-map momentum and round-stakes pressure.
 *
 * Pure functions used by mapSim (to update and carry momentum) and roundSim
 * (to compute per-round factors that feed into duel contexts).
 *
 * Momentum is a single scalar in [-1, +1] per team, built by exponential
 * smoothing over round outcomes: consecutive wins push it toward +1, losses
 * toward -1, and alternating results decay it toward 0. It then tilts duel
 * ratings and buy-tier decisions within bounded limits so comebacks feel earned
 * without erasing the underlying skill gap.
 *
 * High-stakes rounds (match point, overtime, eco-vs-full) amplify trait
 * deviations (clutch/bigGame bonuses, choker penalties) so pressure situations
 * produce more dramatic individual moments.
 *
 * All constants come from BALANCE.MOMENTUM. Pure: no side-effects, no rng.
 */

import { BALANCE } from '../../config/balance.js';

const M = BALANCE.MOMENTUM;

/**
 * Update a team's momentum scalar after a round result.
 * Applies exponential decay then adds ±WIN_STEP/LOSS_STEP. Clamped to [-1, +1].
 * @param {number} current current momentum
 * @param {boolean} won whether this team won the round
 * @returns {number} new momentum in [-1, +1]
 */
export function updateMomentum(current, won) {
  const next = current * M.DECAY + (won ? M.WIN_STEP : -M.LOSS_STEP);
  if (next > 1) return 1;
  if (next < -1) return -1;
  return next;
}

/**
 * Convert a momentum value into a duel-rating multiplier.
 * Range: [1 - DUEL_MAX, 1 + DUEL_MAX].
 * @param {number} momentum in [-1, +1]
 * @returns {number}
 */
export function momentumDuelFactor(momentum) {
  return 1 + M.DUEL_MAX * momentum;
}

/**
 * Convert a momentum value into a credits bias for buy-tier decisions.
 * A team on a winning streak can afford to stretch into the next tier;
 * a losing-streak team saves more conservatively.
 * Range: [-ECO_BIAS_MAX, +ECO_BIAS_MAX].
 * @param {number} momentum in [-1, +1]
 * @returns {number}
 */
export function momentumEcoBias(momentum) {
  return M.ECO_BIAS_MAX * momentum;
}

/**
 * Compute the stakes amplifier for trait deviations this round.
 * Returns a value >= 1.0; multiply this against (traitMod - 1) then add 1
 * to amplify clutch/bigGame/choker effects in pressure situations.
 *
 * Priority (highest takes precedence): overtime > match point > eco-upset.
 *
 * @param {{
 *   scoreA: number,
 *   scoreB: number,
 *   roundNo: number,
 *   atkEconType: 'pistol'|'eco'|'force'|'full',
 *   defEconType: 'pistol'|'eco'|'force'|'full'
 * }} ctx
 * @returns {number} amplifier (1.0 = normal; >1 = amplified)
 */
export function stakesAmplifier(ctx) {
  const { scoreA, scoreB, roundNo, atkEconType, defEconType } = ctx;

  // Overtime: highest stakes tier.
  const OT_AFTER = 2 * (BALANCE.ROUNDS_TO_WIN - 1);
  if (roundNo > OT_AFTER) return 1 + M.STAKES_OT;

  // Match point: either team is one win from the map.
  const mpThreshold = BALANCE.ROUNDS_TO_WIN - 1;
  if (scoreA >= mpThreshold || scoreB >= mpThreshold) return 1 + M.STAKES_MATCH_POINT;

  // Eco upset: one side on eco/pistol while the other is on full buy.
  const atkEco = atkEconType === 'eco' || atkEconType === 'pistol';
  const defEco = defEconType === 'eco' || defEconType === 'pistol';
  const atkFull = atkEconType === 'full';
  const defFull = defEconType === 'full';
  if ((atkEco && defFull) || (defEco && atkFull)) return 1 + M.STAKES_ECO_UPSET;

  return 1;
}
