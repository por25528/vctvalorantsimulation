/**
 * engine/career/offseason/development.js — aging & attribute development
 * (CONTRACTS-CAREER §1.2; P12.1 rewrite).
 *
 * One off-season ages a player by a year and drifts their attributes so that a
 * talent ARRIVES inside their prime (a season = a year) rather than decades later:
 *
 *   - GROWTH  (age < peak): the player climbs toward `potential` (an OVERALL
 *     ceiling). The overall step = K·(potential − overall)/10, scaled by the
 *     player's growthRate, their archetype multiplier (wonderkid↑/bust↓), and a
 *     logistic AGE-FALLOFF 1/(1+exp((age−peak)·rate)) that fades growth to ~0 by
 *     the prime. That same step is added to EVERY attribute (+mild per-attr
 *     noise), so role slants are preserved — a duelist stays aim-heavy/igl-light.
 *   - PLATEAU (peak ≤ age < decline): small zero-mean jitter.
 *   - DECLINE (age ≥ decline): per-attribute fall, deepening each year past
 *     decline. PHYSICAL (aim/movement/reaction) fades fast; MENTAL (gameSense/
 *     igl/composure) fades slowly and even ticks up a touch. High-IGL players
 *     peak later and decline softer, so veteran leaders compete into their 30s.
 *
 * `development.trajectory` records the net overall change. Identity, role,
 * potential, peak/decline ages, archetype, proficiency, dynamics and contract are
 * preserved. Pure & rng-injected; input never mutated; output frozen. Each phase
 * consumes EXACTLY one gaussian per attribute, so the off-season rng stream's draw
 * COUNT is unchanged from the prior model (downstream draws keep their positions).
 * Constants from BALANCE.CAREER.AGING.
 */

import { BALANCE } from '../../../config/balance.js';
import { ATTR_KEYS, clamp, num, meanAttrs } from '../playerStats.js';
import { traitDevMod } from '../traits.js';

const A = BALANCE.CAREER.AGING;
const PHYSICAL = new Set(A.PHYSICAL);
const MENTAL = new Set(A.MENTAL);

/** Round to one decimal place (keeps trajectory tidy & stable). */
function round1(x) {
  return Math.round(x * 10) / 10;
}

/** Growth-rate multiplier for a development archetype. */
function archetypeGrowthMult(archetype) {
  switch (archetype) {
    case 'wonderkid': return A.WONDERKID_GROWTH_MULT;
    case 'bust': return A.BUST_GROWTH_MULT;
    case 'lateBloomer': return A.LATEBLOOMER_GROWTH_MULT;
    default: return 1;
  }
}

/**
 * Apply one off-season of aging/development to a player.
 *
 * @param {object} player
 * @param {import('../../../core/rng.js').Rng} rng
 * @returns {object} a NEW frozen Player (age+1, attributes drifted, trajectory set)
 */
export function developPlayer(player, rng) {
  if (!player || typeof player !== 'object') {
    throw new Error('developPlayer: a Player is required');
  }
  if (!rng || typeof rng.gaussian !== 'function') {
    throw new Error('developPlayer: an Rng is required');
  }

  const dev = (player.development && typeof player.development === 'object') ? player.development : {};
  const growthRate = num(dev.growthRate, 1);
  const archetype = typeof dev.archetype === 'string' ? dev.archetype : 'normal';
  const potential = num(player.potential, 75);

  // Personality traits shape growth speed, season-to-season variance, and the arc.
  const tmod = traitDevMod(player);

  const newAge = num(player.age, 21) + 1;
  const attrs0 = (player.attributes && typeof player.attributes === 'object') ? player.attributes : {};
  const overall0 = meanAttrs(attrs0);
  const igl = num(attrs0.igl, 0);

  // Game-sense longevity + late-bloomer arc + trait peak shift the effective ages.
  const iglShift = clamp(A.IGL_PEAK_SHIFT_K * Math.max(0, igl - 60), 0, A.IGL_PEAK_SHIFT_MAX);
  const archShift = archetype === 'lateBloomer' ? A.LATEBLOOMER_PEAK_SHIFT : 0;
  const peakAge = num(dev.peakAge, 25) + iglShift + archShift + tmod.peakShift;
  const declineAge = num(dev.declineAge, 29) + iglShift + archShift + tmod.peakShift;

  // GROWTH: one shape-preserving overall step (same for every attribute), faded
  // by the logistic age-falloff. Computed once; applied to each attr with noise.
  const headroom = potential - overall0;
  const ageFactor = 1 / (1 + Math.exp((newAge - peakAge) * A.GROWTH_RATE_BASE));
  const overallStep = A.GROWTH_HEADROOM_K * (headroom / 10) * growthRate * tmod.growthMult * archetypeGrowthMult(archetype) * ageFactor;

  // Trait-scaled noise (consistent steadies, volatile widens).
  const growthNoise = A.GROWTH_NOISE * tmod.noiseMult;
  const plateauNoise = A.PEAK_PLATEAU_NOISE * tmod.noiseMult;

  // DECLINE: per-attribute softening for high-IGL veterans.
  const declineSoften = 1 - clamp(A.IGL_DECLINE_SOFTEN_K * Math.max(0, igl - 60), 0, A.IGL_DECLINE_SOFTEN_MAX);

  /** @type {Record<string, number>} */
  const attrs1 = {};
  for (const k of ATTR_KEYS) {
    const cur = num(attrs0[k], 70);
    let delta;
    if (newAge < peakAge) {
      delta = overallStep + rng.gaussian(0, growthNoise);
    } else if (newAge < declineAge) {
      delta = rng.gaussian(0, plateauNoise);
    } else {
      const yearsPast = newAge - declineAge;
      const mult = PHYSICAL.has(k) ? A.PHYSICAL_DECLINE_MULT : MENTAL.has(k) ? A.MENTAL_DECLINE_MULT : 1;
      delta = -(A.DECLINE_K * yearsPast * mult * declineSoften) + rng.gaussian(0, A.DECLINE_NOISE);
      if (MENTAL.has(k)) delta += A.MENTAL_LATE_GROWTH; // wisdom offsets some decline
    }
    attrs1[k] = clamp(cur + delta, 0, 100);
  }

  const trajectory = round1(meanAttrs(attrs1) - overall0);

  return Object.freeze({
    ...player,
    age: newAge,
    attributes: Object.freeze(attrs1),
    development: Object.freeze({ ...dev, trajectory })
  });
}
