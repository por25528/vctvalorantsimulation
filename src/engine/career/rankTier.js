/**
 * engine/career/rankTier.js — pure Valorant-style RANK TIER derivation
 * (Iron → Bronze → … → Immortal → Radiant) from a player's skill/overall.
 *
 * PURE + deterministic: NO rng / Date / DOM, no draws at call time — safe to call
 * per row while the UI virtualizes thousands of ladder entries. The tier cut
 * points are tuning and live in `BALANCE.CAREER.LADDER.TIERS`.
 *
 * `playerRankTier(player)` reads `player.skill` when present (the lean ladder
 * records carry a single skill scalar) and otherwise falls back to the player's
 * `overall` (mean of the nine attributes) — so it works for full Player objects
 * (pros) and for the lean ladder rows alike. It returns the tier name plus an
 * RR-like 0..99 sub-rating giving the player's position WITHIN that tier's band
 * (so two Diamonds can still be ordered) — exactly like Valorant's per-tier RR.
 */

import { BALANCE } from '../../config/balance.js';
import { overall } from './playerStats.js';

const L = BALANCE.CAREER.LADDER;

/** Tier cut points sorted ascending by `min` (defensive copy; data is frozen). */
const TIERS = L.TIERS.slice().sort((a, b) => a.min - b.min);
const LOWEST_TIER = TIERS[0].tier;

/**
 * Resolve a numeric skill for a player-like input. Honours an explicit numeric
 * `skill`; else uses the player's overall. Non-finite input → 0 (graceful, Iron).
 * @param {{skill?:number, attributes?:object}|number|null|undefined} input
 * @returns {number}
 */
function skillOf(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
  if (input && typeof input.skill === 'number' && Number.isFinite(input.skill)) return input.skill;
  const o = overall(input);
  return Number.isFinite(o) ? o : 0;
}

/**
 * Map a skill/overall scalar (≈0..100) to a Valorant rank tier + RR sub-rating.
 *
 * @param {{skill?:number, attributes?:object}|number|null|undefined} player
 * @returns {{ tier:string, rr:number }} rr is 0..99 within the resolved tier band
 */
export function playerRankTier(player) {
  const skill = skillOf(player);

  // Find the highest tier whose lower bound the skill clears.
  let idx = 0;
  for (let i = 0; i < TIERS.length; i += 1) {
    if (skill >= TIERS[i].min) idx = i;
    else break;
  }
  const tier = TIERS[idx] ? TIERS[idx].tier : LOWEST_TIER;
  const lo = TIERS[idx] ? TIERS[idx].min : 0;
  // Band width = distance to the next tier's lower bound; the top tier is open-ended,
  // so use a sane span so its RR still spreads instead of pinning to 0/99.
  const hi = TIERS[idx + 1] ? TIERS[idx + 1].min : lo + 14;
  const span = Math.max(1, hi - lo);
  const frac = (skill - lo) / span;
  const rr = Math.max(0, Math.min(99, Math.round(frac * 99)));
  return { tier, rr };
}

/**
 * The full ascending list of tier names (Iron → Radiant). Useful for UI filters.
 * @returns {string[]}
 */
export function rankTierOrder() {
  return TIERS.map((t) => t.tier);
}
