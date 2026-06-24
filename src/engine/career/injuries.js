/**
 * engine/career/injuries.js — seeded injury mechanics (CONTRACTS-POLISH P7c).
 *
 * PURE & rng-injected. An injury is a career-layer status — NOT a roster change:
 * an injured player stays on the roster (so rosters stay >= 5 and the match engine
 * still fields the first five), but their effective FATIGUE is pinned high while
 * injured, so the engine's existing dynamics read (form/fatigue/morale) makes them
 * play hurt. This needs zero changes to the pure match engine.
 *
 * All randomness comes from the injected `rng` (seeded via hashSeed in the career
 * layer), never Math.random/Date — so the same career reproduces the same injuries.
 * Constants from BALANCE.CAREER.INJURY.
 *
 * An injury field on a Player is `{ weeks:number, type:string }` (weeks = calendar
 * slots remaining) or `null` when fit.
 */

import { BALANCE } from '../../config/balance.js';
import { clamp, num } from './playerStats.js';

const I = BALANCE.CAREER.INJURY;

/** Flavor injury types (the rng picks one on a hit). */
export const INJURY_TYPES = Object.freeze([
  'wrist strain', 'shoulder knock', 'back spasm', 'illness', 'hand injury', 'fatigue flare'
]);

/**
 * Tick an existing injury down by one calendar slot. Pure.
 * @param {{weeks:number,type:string}|null} injury
 * @returns {{weeks:number,type:string}|null} the healed-down injury (null when recovered)
 */
export function tickInjury(injury) {
  if (!injury || typeof injury.weeks !== 'number' || injury.weeks <= 0) return null;
  const weeks = injury.weeks - 1;
  return weeks > 0 ? { weeks, type: injury.type } : null;
}

/**
 * The per-slot injury probability for a player who featured this slot, scaling
 * with accumulated fatigue, maps played and age. Clamped to [0, MAX_CHANCE].
 * @param {object} player
 * @param {{fatigue?:number}} dynamics
 * @param {number} mapsPlayed
 * @returns {number}
 */
export function injuryChance(player, dynamics, mapsPlayed) {
  const fatigue = num(dynamics && dynamics.fatigue, 0);
  const age = num(player && player.age, 21);
  const maps = num(mapsPlayed, 0);
  const p = I.BASE_CHANCE
    + I.FATIGUE_K * (fatigue / 100)
    + I.MAPS_K * maps
    + I.AGE_K * Math.max(0, age - I.AGE_PIVOT);
  return clamp(p, 0, I.MAX_CHANCE);
}

/**
 * Roll a possible NEW injury for a player who featured this slot. Draws exactly
 * one `rng.chance` (and, on a hit, a duration + a type) so the caller's per-slot
 * rng sequence stays deterministic. Returns an injury field or null.
 *
 * @param {object} player
 * @param {{fatigue?:number}} dynamics
 * @param {number} mapsPlayed
 * @param {import('../../core/rng.js').Rng} rng
 * @returns {{weeks:number,type:string}|null}
 */
export function rollInjury(player, dynamics, mapsPlayed, rng) {
  if (!rng || typeof rng.chance !== 'function') {
    throw new Error('rollInjury: an Rng is required');
  }
  if (!rng.chance(injuryChance(player, dynamics, mapsPlayed))) return null;
  const weeks = rng.range(I.MIN_WEEKS, I.MAX_WEEKS);
  const type = INJURY_TYPES[rng.int(INJURY_TYPES.length)];
  return { weeks, type };
}

/**
 * The effective fatigue to pin on an injured player (never below their real
 * fatigue), which drives the engine's performance debuff while they're hurt.
 * @param {number} currentFatigue
 * @returns {number}
 */
export function injuredFatigue(currentFatigue) {
  return clamp(Math.max(num(currentFatigue, 0), I.FATIGUE_FLOOR), 0, 100);
}

/**
 * Did a player pick up a NEW knock across a slot (for the news diff)? True when
 * they ended injured AND were either fit beforehand, OR their prior injury was on
 * its FINAL week. tickInjury clears an injury at weeks 1, so within one slot only
 * an expiring (weeks<=1) injury can be healed and replaced by a fresh roll — a
 * longer injury simply ticks down (same knock), and must not re-fire as news.
 *
 * @param {{weeks:number,type:string}|null} beforeInjury  injury at slot start
 * @param {{weeks:number,type:string}|null} afterInjury   injury at slot end
 * @returns {boolean}
 */
export function isFreshInjury(beforeInjury, afterInjury) {
  if (!afterInjury) return false;
  if (!beforeInjury) return true;
  return num(beforeInjury.weeks, 0) <= 1;
}
