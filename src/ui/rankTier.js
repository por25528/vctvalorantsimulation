/**
 * ui/rankTier.js — pure rank-tier presentation helper (Iron → Radiant).
 *
 * The competitive-core UI shows each player's rank-tier at a glance. The TRUTH
 * of which tier a player sits in is owned by the engine half (r9) via the pure
 * `playerRankTier(player)` selector — this module is the VIEW side: an ordered
 * ladder of tier descriptors + a normaliser that maps whatever `tier` token the
 * selector returns onto a stable `{ key, label, index }` used to pick a BEM
 * modifier class (`.rank-badge--<key>`) and a token-driven colour.
 *
 * It also provides a self-contained FALLBACK (`playerRankTier`) derived purely
 * from a player's overall, so the rank-tier badge + screens build and render
 * before r9's selector merges. `ui/rankSelectors.js` prefers r9's selector when
 * present and only falls back to this — so wiring to real data is zero-change.
 *
 * Pure: no DOM, no rng, no Date. Safe to call per-row.
 */

import { overall } from '../engine/career/playerStats.js';

/**
 * The competitive ladder, lowest → highest. `min` is the inclusive lower bound
 * (on a 0–100 "overall" scale) used ONLY by the local fallback; the real tier
 * comes from r9. `key` drives the `.rank-badge--<key>` modifier in main.css.
 * @type {ReadonlyArray<{key:string,label:string,min:number}>}
 */
export const RANK_TIERS = Object.freeze([
  { key: 'iron', label: 'Iron', min: 0 },
  { key: 'bronze', label: 'Bronze', min: 55 },
  { key: 'silver', label: 'Silver', min: 60 },
  { key: 'gold', label: 'Gold', min: 65 },
  { key: 'platinum', label: 'Platinum', min: 70 },
  { key: 'diamond', label: 'Diamond', min: 75 },
  { key: 'ascendant', label: 'Ascendant', min: 80 },
  { key: 'immortal', label: 'Immortal', min: 85 },
  { key: 'radiant', label: 'Radiant', min: 90 }
]);

/** Lookup of normalised key → descriptor (built once). */
const BY_KEY = Object.freeze(
  RANK_TIERS.reduce((acc, t, i) => {
    acc[t.key] = { key: t.key, label: t.label, index: i };
    return acc;
  }, {})
);

/** Lowercase label → key, so a `tier:'Radiant'` token also resolves. */
const BY_LABEL = Object.freeze(
  RANK_TIERS.reduce((acc, t) => {
    acc[t.label.toLowerCase()] = t.key;
    return acc;
  }, {})
);

/** The neutral descriptor used when a tier token is unknown / missing. */
const UNKNOWN = Object.freeze({ key: 'unranked', label: 'Unranked', index: -1 });

/**
 * Normalise any tier token (a key like `'iron'`, a label like `'Radiant'`, or
 * a mixed-case variant) to a stable `{ key, label, index }`. Unknown / empty
 * tokens degrade to the neutral `unranked` descriptor rather than throwing, so
 * the badge always renders something coherent.
 * @param {string|null|undefined} tier
 * @returns {{key:string,label:string,index:number}}
 */
export function tierMeta(tier) {
  if (typeof tier !== 'string' || !tier) return UNKNOWN;
  const lower = tier.toLowerCase();
  if (BY_KEY[lower]) return BY_KEY[lower];
  const viaLabel = BY_LABEL[lower];
  if (viaLabel && BY_KEY[viaLabel]) return BY_KEY[viaLabel];
  return UNKNOWN;
}

/**
 * Map a 0–100 overall onto a tier descriptor — the FALLBACK ladder used only
 * until r9's `playerRankTier` lands. Returns `{ tier, rr }` matching the engine
 * contract: `tier` is the tier KEY, `rr` is a 0–99 rank-rating within the band.
 * @param {number} ov  player overall (mean of nine attributes)
 * @returns {{tier:string, rr:number}}
 */
export function tierFromOverall(ov) {
  const v = typeof ov === 'number' && Number.isFinite(ov) ? ov : 0;
  let idx = 0;
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (v >= RANK_TIERS[i].min) {
      idx = i;
      break;
    }
  }
  const band = RANK_TIERS[idx];
  // Width to the next tier's floor (top tier spans an open 10-point band).
  const next = RANK_TIERS[idx + 1];
  const span = next ? next.min - band.min : 10;
  const rr = Math.max(0, Math.min(99, Math.round(((v - band.min) / span) * 100)));
  return { tier: band.key, rr };
}

/**
 * The local fallback for r9's `playerRankTier(player)` — pure, per-row safe.
 * Derives the tier purely from the player's overall. Honoured only when the
 * engine selector is absent (see {@link module:ui/rankSelectors}).
 * @param {object|null} player
 * @returns {{tier:string, rr:number}}
 */
export function playerRankTier(player) {
  return tierFromOverall(player ? overall(player) : 0);
}
