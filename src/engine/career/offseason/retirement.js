/**
 * engine/career/offseason/retirement.js — off-season retirement decision
 * (CONTRACTS-CAREER §1.3). Phase 6 (off-season).
 *
 * Returns whether a player hangs it up this off-season. No chance below MIN_AGE;
 * above it the annual hazard climbs with age and is lifted by low morale and a
 * faded overall; at/above FORCE_AGE retirement is certain. Pure decision only —
 * the caller flips contract.status to 'retired' and frees the roster slot.
 *
 * Pure & rng-injected (a single rng.chance draw on the probabilistic path; the
 * forced/too-young short-circuits consume no rng). Constants from
 * BALANCE.CAREER.RETIRE.
 */

import { BALANCE } from '../../../config/balance.js';
import { overall, clamp, num } from '../playerStats.js';

const R = BALANCE.CAREER.RETIRE;

/**
 * Decide whether a player retires this off-season.
 *
 * @param {object} player
 * @param {import('../../../core/rng.js').Rng} rng
 * @returns {boolean}
 */
export function decideRetirement(player, rng) {
  if (!rng || typeof rng.chance !== 'function') {
    throw new Error('decideRetirement: an Rng is required');
  }
  const age = num(player && player.age, 21);
  if (age >= R.FORCE_AGE) return true;
  if (age < R.MIN_AGE) return false;

  let p = R.BASE + R.AGE_K * (age - R.MIN_AGE);

  const morale = num(player && player.dynamics && player.dynamics.morale, 60);
  if (morale < R.MORALE_PIVOT) p += R.LOW_MORALE_K * (R.MORALE_PIVOT - morale);

  const o = overall(player);
  if (o < R.DECLINE_OVERALL_PIVOT) p += R.DECLINE_K * (R.DECLINE_OVERALL_PIVOT - o);

  return rng.chance(clamp(p, 0, 1));
}
