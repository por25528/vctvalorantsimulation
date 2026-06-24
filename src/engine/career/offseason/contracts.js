/**
 * engine/career/offseason/contracts.js — contract renewal/release at off-season
 * (CONTRACTS-CAREER §1.5). Phase 6 (off-season).
 *
 * Called for a player whose contract is EXPIRING. Decides whether the team
 * re-signs them (and on what salary/length) or lets them walk into free agency.
 * Renewal is likelier for valuable, happy, in-prime players at a reputable org;
 * clubs let aging vets leave. On renewal the salary scales with overall (current
 * value) plus remaining upside (potential − overall).
 *
 * Pure & rng-injected (one rng.chance draw; a renewal also draws the length).
 * Constants from BALANCE.CAREER.CONTRACT.
 */

import { BALANCE } from '../../../config/balance.js';
import { overall, clamp, num } from '../playerStats.js';

const C = BALANCE.CAREER.CONTRACT;

/**
 * The salary a player commands: a base, plus their current value (overall) and a
 * premium for unrealized upside (potential − overall). Shared by contract
 * renewals and transfer-market signings so pay is consistent across the layer.
 *
 * @param {object} player
 * @returns {number} salary (rounded, ≥ SALARY_BASE)
 */
export function salaryFor(player) {
  const o = overall(player);
  const potential = num(player && player.potential, o);
  // A progressive ELITE premium on top of the linear term so the very best
  // players command dramatically higher wages than journeymen (P13).
  const elite = C.SALARY_ELITE_K * Math.pow(Math.max(0, o - C.SALARY_ELITE_PIVOT), C.SALARY_ELITE_POW);
  // Upside premium is measured from where the value term starts paying (overall 60),
  // not from the raw overall — otherwise below 60 (where value-pay is floored at 0)
  // rising overall would only SHRINK the upside term, making a better young player
  // paid LESS. Anchoring at 60 keeps salary monotonic non-decreasing in overall.
  const upside = C.SALARY_POT_K * Math.max(0, potential - Math.max(o, 60));
  return Math.round(
    C.SALARY_BASE
    + C.SALARY_OVERALL_K * Math.max(0, o - 60)
    + upside
    + elite
  );
}

/**
 * The term (in seasons) a club offers a player, biased by age: young/prime players
 * get the full LENGTH_MIN..LENGTH_MAX range, players at/over LENGTH_AGE_MID are
 * capped a year shorter, and veterans at/over LENGTH_AGE_VET only get the minimum
 * term — clubs don't lock a fading 34-yo into a 3-year deal. Always within
 * [LENGTH_MIN, LENGTH_MAX] and consumes exactly one rng draw (determinism intact).
 *
 * @param {object} player
 * @param {import('../../../core/rng.js').Rng} rng
 * @returns {number} term length in seasons
 */
export function contractLengthFor(player, rng) {
  const age = num(player && player.age, 21);
  let maxLen = C.LENGTH_MAX;
  if (age >= C.LENGTH_AGE_VET) maxLen = C.LENGTH_MIN;
  else if (age >= C.LENGTH_AGE_MID) maxLen = Math.max(C.LENGTH_MIN, C.LENGTH_MAX - 1);
  return rng.range(C.LENGTH_MIN, maxLen);
}

/**
 * Resolve an expiring player's contract.
 *
 * @param {object} player
 * @param {object|null} team   the player's current team (for budget/reputation pull)
 * @param {import('../../../core/rng.js').Rng} rng
 * @param {{ season?:number }} [opts]
 * @returns {{ teamId:string|null, salary:number, expires:number, status:'active'|'free_agent' }}
 */
export function resolveContract(player, team, rng, opts = {}) {
  if (!rng || typeof rng.chance !== 'function') {
    throw new Error('resolveContract: an Rng is required');
  }
  const season = num(opts.season, 0);
  const o = overall(player);
  const morale = num(player && player.dynamics && player.dynamics.morale, 60);
  const age = num(player && player.age, 21);
  const reputation = num(team && team.reputation, 50);

  let p = C.RENEW_BASE
    + C.RENEW_MORALE_K * (morale - 60)
    + C.RENEW_VALUE_K * (o - 70)
    - C.RENEW_AGE_K * Math.max(0, age - 28)
    + 0.002 * (reputation - 50);

  if (!rng.chance(clamp(p, 0.02, 0.98))) {
    return { teamId: null, salary: 0, expires: 0, status: 'free_agent' };
  }

  const length = contractLengthFor(player, rng);
  const salary = salaryFor(player);
  const teamId = team && typeof team.id === 'string'
    ? team.id
    : (player && player.contract && player.contract.teamId) || null;

  return { teamId, salary, expires: season + length, status: 'active' };
}
