/**
 * engine/career/playerStats.js — small shared helpers for the career layer
 * (CONTRACTS-CAREER §1). Pure, no randomness, no DOM.
 *
 * `overall(player)` is the mean of the nine canonical attributes — a player's
 * single-number strength used by development/retirement/contract logic. Kept here
 * (rather than re-derived in each module) so every career module agrees on the
 * attribute set and the "overall" definition.
 */

/** Canonical attribute keys, fixed order (mirrors domain/player.js ATTRIBUTE_KEYS). */
export const ATTR_KEYS = Object.freeze([
  'aim',
  'movement',
  'reaction',
  'composure',
  'consistency',
  'gameSense',
  'utility',
  'trading',
  'igl'
]);

/**
 * Clamp a number into [min, max].
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Coerce a value to a finite number, falling back to `fallback`.
 * @param {*} v
 * @param {number} fallback
 * @returns {number}
 */
export function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Mean of an attributes record over {@link ATTR_KEYS}. Missing/non-finite entries
 * are skipped; an empty/absent map yields 0.
 * @param {Record<string, number>} attrs
 * @returns {number}
 */
export function meanAttrs(attrs) {
  const a = attrs && typeof attrs === 'object' ? attrs : {};
  let sum = 0;
  let n = 0;
  for (const k of ATTR_KEYS) {
    const v = a[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * A player's "overall" — the mean of their nine attributes.
 * @param {object} player
 * @returns {number}
 */
export function overall(player) {
  return meanAttrs(player && player.attributes);
}
