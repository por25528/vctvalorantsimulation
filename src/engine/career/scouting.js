/**
 * engine/career/scouting.js — deterministic trait-reveal logic.
 *
 * Hidden traits (see traits.js TRAIT_DEFS[id].hidden) are not shown on a
 * player's card until the manager has observed or scouted them. This module
 * decides WHICH hidden traits are currently revealed for a given player.
 *
 * REVEAL MODEL (deterministic, seeded):
 *   Each hidden trait is assigned a fixed "reveal difficulty" in [0, 1) derived
 *   from hashSeed(careerSeed, 'scoutreveal', playerId, traitId). Lower = easier
 *   to spot. A trait becomes visible when:
 *
 *     naturalExposure(player.age) + scoutBonus(focusSeasons) >= threshold
 *
 *   naturalExposure: how much the world has simply SEEN the player play.
 *     Range 0..NATURAL_MAX. A 17-yo rookie = 0; a 37-yo veteran ≈ 0.9.
 *
 *   scoutBonus: one targeted scouting focus per season adds SCOUT_BONUS_PER.
 *     Three scout seasons (the max) adds 3 * 0.35 = 1.05, which exceeds any
 *     threshold — so three seasons of dedicated scouting reveals everything.
 *
 * Pure. No side effects. No Math.random / Date.now.
 *
 * @module
 */

import { TRAIT_DEFS } from './traits.js';
import { hashSeed } from '../../core/hash.js';

/** Maximum scouting focuses the user may spend in a single season. */
export const MAX_SCOUT_FOCUSES = 3;

/** Trait-reveal bonus added per season the user focused on this player. */
const SCOUT_BONUS_PER = 0.35;

/**
 * Age-based "natural exposure" — how much of a player's on-stage history the
 * world has seen. Rises linearly from 0 at age 17 to NATURAL_MAX at age 37.
 * Clamped to [0, NATURAL_MAX].
 */
const NATURAL_MAX = 0.9;
const NATURAL_MIN_AGE = 17;
const NATURAL_FULL_AGE = 37;

function naturalExposure(age) {
  const a = typeof age === 'number' ? age : 18;
  const t = (a - NATURAL_MIN_AGE) / (NATURAL_FULL_AGE - NATURAL_MIN_AGE);
  return Math.max(0, Math.min(NATURAL_MAX, t * NATURAL_MAX));
}

/**
 * Fixed reveal threshold for a single hidden trait on a specific player.
 * Returns a value in [0, 1) that is consistent across the entire career.
 *
 * @param {number|string} careerSeed  The master career seed.
 * @param {string} playerId
 * @param {string} traitId
 * @returns {number} threshold in [0, 1)
 */
function revealThreshold(careerSeed, playerId, traitId) {
  const h = hashSeed(careerSeed, 'scoutreveal', playerId, traitId);
  return (h % 100000) / 100000;
}

/**
 * Derive which of a player's traits are visible to the manager.
 *
 *   - Non-hidden traits are always known.
 *   - Hidden traits are known when (naturalExposure + scoutBonus) >= threshold.
 *
 * @param {object} player         Player domain object (needs .id, .age, .traits).
 * @param {number} focusSeasons   How many seasons this player has been scouted.
 * @param {number|string} careerSeed  The master career seed.
 * @returns {{ known: string[], hiddenCount: number }}
 *   known       — trait ids visible to the manager (both non-hidden and revealed-hidden)
 *   hiddenCount — how many hidden traits are still concealed (existence shown as "???" in UI)
 */
export function getRevealedTraits(player, focusSeasons, careerSeed) {
  const traits = Array.isArray(player && player.traits) ? player.traits : [];
  const age = (player && player.age) || 18;
  const playerId = (player && player.id) || '';

  const exposure = naturalExposure(age);
  const bonus = (typeof focusSeasons === 'number' ? focusSeasons : 0) * SCOUT_BONUS_PER;
  const total = exposure + bonus;

  const known = [];
  let hiddenCount = 0;

  for (const traitId of traits) {
    const def = TRAIT_DEFS[traitId];
    if (!def || !def.hidden) {
      known.push(traitId);
    } else {
      const threshold = revealThreshold(careerSeed, playerId, traitId);
      if (total >= threshold) {
        known.push(traitId);
      } else {
        hiddenCount += 1;
      }
    }
  }

  return { known, hiddenCount };
}
