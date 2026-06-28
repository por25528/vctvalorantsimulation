/**
 * engine/career/ladder/ladderPromotion.js — the LADDER → PRO pipeline.
 *
 * Runs once per off-season, AFTER the T1 and Tier-2 off-seasons, on its OWN
 * injected rng (`hashSeed(seed, 'ladder-promote', idx)`) so it never perturbs the
 * byte-identical T1/T2 transitions. The strongest eligible ladder climbers (skill
 * ≥ PROMOTE_SKILL_MIN, top PROMOTE_PER_REGION per region) earn a pro tryout: each
 * is fleshed out into a full young-prospect Player and dropped into the T1
 * free-agent pool, where the existing T1 market signs them next window — exactly
 * the same intake path the Tier-2 promotion uses. A modest trickle that DEEPENS
 * the validated "stronger rises" pyramid (amateur ladder → pro free agency)
 * without flooding the pro scene.
 *
 * PURE & rng-injected: the input world is never mutated; the output is frozen;
 * only ADDS free agents (never re-runs an existing draw), so simSeason/the T1+T2
 * offseason draws stay identical — the only downstream effect is next season's
 * market seeing a few more high-ceiling free agents.
 *
 * @typedef {Object} LadderOffseasonReport
 * @property {number} season
 * @property {string[]} promoted   // ladder ids that entered the T1 FA pool this year
 */

import { hashSeed } from '../../../core/hash.js';
import { BALANCE } from '../../../config/balance.js';
import { ATTR_KEYS, clamp, meanAttrs } from '../playerStats.js';
import { createPlayer, roleProfile } from '../../../domain/player.js';
import { salaryFor } from '../offseason/contracts.js';
import { assignTraitsForNewgen } from '../traits.js';
import { buildLadder } from './ladderWorld.js';

const L = BALANCE.CAREER.LADDER;
const N = BALANCE.CAREER.NEWGEN;

const ROLES = Object.freeze(['Duelist', 'Initiator', 'Controller', 'Sentinel']);
const ROLE_WEIGHT = (role) => {
  const w = N.ROLE_WEIGHTS && typeof N.ROLE_WEIGHTS[role] === 'number' ? N.ROLE_WEIGHTS[role] : 1;
  return w > 0 ? w : 0;
};

/**
 * Flesh out a lean ladder record into a full young-prospect Player (a T1 free
 * agent). Role-shaped stat line centred on a tryout-grade overall derived from
 * the ladder skill, with age-scaled potential headroom. Mirrors the Tier-2
 * generator so dev curves stay consistent across the pyramid.
 *
 * @param {import('../../../core/rng.js').Rng} rng
 * @param {{ id:string, handle:string, region:string, skill:number }} rec
 * @param {{ season:number }} ctx
 * @returns {object} frozen Player (tier 't1', free agent)
 */
function promoteRecord(rng, rec, ctx) {
  const role = rng.weightedPick(ROLES, ROLE_WEIGHT);
  const age = L.PROMOTE_AGE_MIN + rng.int(Math.max(1, L.PROMOTE_AGE_MAX - L.PROMOTE_AGE_MIN + 1));

  // A tryout-grade current overall: strong but not an instant god (room to grow).
  const ovrTarget = clamp(rec.skill, 72, 86);
  const profile = roleProfile(role);
  const profileMean = meanAttrs(profile);
  /** @type {Record<string, number>} */
  const attributes = {};
  for (const k of ATTR_KEYS) {
    const slant = profile[k] - profileMean;
    attributes[k] = Math.round(clamp(ovrTarget + slant + rng.gaussian(0, L.PROMOTE_ATTR_NOISE), 0, 100));
  }
  const baseOverall = meanAttrs(attributes);
  // Younger climbers carry more headroom toward a higher ceiling.
  const youth = clamp((L.PROMOTE_AGE_MAX - age) / Math.max(1, L.PROMOTE_AGE_MAX - L.PROMOTE_AGE_MIN), 0, 1);
  const potential = Math.round(clamp(baseOverall + L.PROMOTE_POT_HEADROOM * youth, baseOverall, 92));

  const growthRate = clamp(rng.gaussian(N.GROWTH_RATE_MEAN, N.GROWTH_RATE_STD), N.GROWTH_RATE_MIN, N.GROWTH_RATE_MAX);
  const archetype = rng.chance(N.WONDERKID_PROB) ? 'wonderkid'
    : rng.chance(N.LATEBLOOMER_PROB) ? 'lateBloomer'
      : rng.chance(N.BUST_PROB) ? 'bust'
        : 'normal';
  const peakAge = N.PEAK_AGE_MIN + rng.int(N.PEAK_AGE_SPAN);
  const declineAge = N.DECLINE_AGE_MIN + rng.int(N.DECLINE_AGE_SPAN);
  const traits = assignTraitsForNewgen(rng);

  const player = createPlayer({
    id: rec.id,
    name: rec.handle,
    handle: rec.handle,
    nationality: 'INT',
    traits,
    tier: 't1',
    age,
    role,
    attributes,
    potential,
    development: { peakAge, declineAge, growthRate, archetype },
    contract: { teamId: null, salary: 0, expires: 0, status: 'free_agent' }
  });
  return Object.freeze({ ...player, contract: { ...player.contract, salary: salaryFor(player) } });
}

/**
 * Run the ladder → pro promotion for one off-season.
 *
 * @param {object} t1World   the POST-T1/T2-offseason World { leagues, teamsById, playersById }
 * @param {number|string} seed   the career master seed (to rebuild the deterministic ladder)
 * @param {number} season    the season index that just completed
 * @param {import('../../../core/rng.js').Rng} rng  a DEDICATED ladder rng (never the T1/T2 stream)
 * @returns {{ t1World:object, report:LadderOffseasonReport }}
 */
export function runLadderOffseason(t1World, seed, season, rng) {
  const empty = Object.freeze({ season, promoted: Object.freeze([]) });
  if (!t1World || !t1World.playersById) return { t1World, report: empty };
  if (!rng || typeof rng.gaussian !== 'function') {
    throw new Error('runLadderOffseason: a dedicated Rng is required');
  }

  const ladder = buildLadder(seed, season);
  const existing = t1World.playersById;

  // Per region, the strongest eligible climbers not already in the pro world.
  /** @type {Record<string, number>} */
  const takenPerRegion = {};
  const picks = [];
  for (const row of ladder.rows) {
    if (row.skill < L.PROMOTE_SKILL_MIN) break; // rows are skill-desc — none below qualify
    if (existing[row.id]) continue; // already promoted in a prior season (signed/FA/retired)
    const n = takenPerRegion[row.region] || 0;
    if (n >= L.PROMOTE_PER_REGION) continue;
    takenPerRegion[row.region] = n + 1;
    picks.push(row);
  }

  if (picks.length === 0) return { t1World, report: empty };

  /** @type {Record<string, object>} */
  const players = { ...existing };
  const promoted = [];
  for (const rec of picks) {
    players[rec.id] = promoteRecord(rng, rec, { season });
    promoted.push(rec.id);
  }

  const nextWorld = Object.freeze({ ...t1World, playersById: Object.freeze(players) });
  return { t1World: nextWorld, report: Object.freeze({ season, promoted: Object.freeze(promoted) }) };
}
