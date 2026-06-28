/**
 * engine/career/ladder/ladderWorld.js — build the HUGE ranked LADDER that lives
 * BENEATH the pro scene.
 *
 * The pro world (T1 `buildWorld()` + the `world.tier2` Challengers division) is
 * the apex of the competitive pyramid. This module generates the LARGE amateur →
 * semi-pro pool below it: `BALANCE.CAREER.LADDER.SIZE_PER_REGION` ranked players
 * per region (×4 ≈ several thousand), each a LEAN record carrying a single skill
 * scalar and a Valorant rank tier (Iron → Radiant) derived from it. Pros sit
 * conceptually above the ladder's Radiant tip; the very best ladder climbers feed
 * the pro free-agent pool each off-season (see ladderPromotion.js).
 *
 * DETERMINISM is sacred: the whole ladder is built from a single dedicated rng,
 * `hashSeed(seed, 'ladder-build')`, so a given seed always yields the identical
 * ladder, and NOTHING here touches the T1/T2 rng streams (this is only ever called
 * lazily by the UI selector — memoized — and read, never re-drawn, by the
 * promotion step). A per-season deterministic skill DRIFT (a pure hash of id +
 * season, no rng) nudges ranks so the ladder reshuffles year to year without a
 * rebuild or any stream interaction.
 *
 * MEMORY: records are intentionally lean ({ id, handle, region, skill, tier, rr })
 * so several thousand hold cheaply on a memory-tight machine; the build runs fast
 * (a handful of draws per record) and is memoized by (seed, season) in the UI.
 */

import { createRng } from '../../../core/rng.js';
import { hashSeed, cyrb53 } from '../../../core/hash.js';
import { clamp } from '../playerStats.js';
import { playerRankTier } from '../rankTier.js';
import { BALANCE } from '../../../config/balance.js';
import { NATIONALITY_POOL_BY_REGION, TIER2_REGION_ORDER } from '../../../data/seed/tier2.js';

const L = BALANCE.CAREER.LADDER;

// Generated-handle syllable tables (data, not tuning) — a third flavour distinct
// from the T1 newgen and T2 academy tables so a ladder grinder's tag reads as its
// own thing (gamer-ish, leetspeak-leaning).
const HANDLE_HEAD = Object.freeze(['zen', 'kry', 'vex', 'nyx', 'qix', 'sol', 'raz', 'tyk', 'wisp', 'glo', 'mox', 'ven', 'dax', 'jyn', 'pho', 'lux', 'arc', 'neb', 'syn', 'oro']);
const HANDLE_TAIL = Object.freeze(['z', 'ix', 'ory', 'en', 'us', 'ah', 'oo', 'ie', 'yx', 'on', 'er', 'al', 'ow', 'um', '7', 'x', 'or', 'ai', 'ey', 'is']);

/** Build a generated ladder handle like "Zenix" / "Voxx7". */
function makeHandle(rng) {
  const head = rng.pick(HANDLE_HEAD);
  const tail = rng.pick(HANDLE_TAIL);
  const s = head + tail;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Deterministic per-season skill drift for a ladder id, in roughly [-3, +3].
 * Pure hash of (id, season) — NO rng stream, so it never shifts any draw; it just
 * makes ranks move season to season (a grinder climbs, another slips).
 * @param {string} id
 * @param {number} season
 * @returns {number}
 */
function seasonDrift(id, season) {
  if (!season) return 0;
  const h = cyrb53(`${id}|drift|${season}`);
  return ((h % 601) / 100) - 3; // 0..600 → -3.00 .. +3.00
}

/**
 * Build the full ranked ladder for a seed (and optional season), sorted by current
 * skill descending. Deterministic & frozen; the input is never mutated.
 *
 * @param {number|string} seed   the career master seed
 * @param {number} [season=0]    season index (applies the deterministic drift)
 * @returns {{ total:number, rows:ReadonlyArray<{id:string, handle:string, region:string, skill:number, tier:string, rr:number}> }}
 */
export function buildLadder(seed, season = 0) {
  const rng = createRng(hashSeed(seed, 'ladder-build'));
  const sIdx = Number.isFinite(season) ? Math.max(0, Math.floor(season)) : 0;
  const regions = TIER2_REGION_ORDER;
  const rows = [];

  for (const region of regions) {
    const natPool = NATIONALITY_POOL_BY_REGION[region] || ['INT'];
    for (let i = 0; i < L.SIZE_PER_REGION; i += 1) {
      // Draws (fixed order/count per record): handle head, handle tail, skill, nat.
      const handle = makeHandle(rng);
      const baseSkill = clamp(rng.gaussian(L.SKILL_MEAN, L.SKILL_STD), L.SKILL_MIN, L.SKILL_MAX);
      rng.pick(natPool); // consume a nat draw to keep the per-record draw count stable (flavour only)
      const id = `lad-${region}-${i}`;
      const skill = Math.round(clamp(baseSkill + seasonDrift(id, sIdx), L.SKILL_MIN, L.SKILL_MAX));
      const { tier, rr } = playerRankTier({ skill });
      rows.push({ id, handle, region, skill, tier, rr });
    }
  }

  rows.sort((a, b) => b.skill - a.skill || b.rr - a.rr || (a.id < b.id ? -1 : 1));
  return Object.freeze({ total: rows.length, rows: Object.freeze(rows) });
}
