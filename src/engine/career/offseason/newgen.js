/**
 * engine/career/offseason/newgen.js — youth ("newgen") player generation
 * (CONTRACTS-CAREER §1.4). Phase 6 (off-season).
 *
 * Each off-season injects a batch of 16–19-year-old free agents into the world.
 * A newgen's `potential` is a gaussian draw (rare wonderkids, mostly average) and
 * their CURRENT attributes start a headroom below that ceiling — a raw teenager
 * far from their peak. Handles/names are generated from deterministic syllable
 * tables. Every newgen is a free agent (no team).
 *
 * Pure & rng-injected: a given (count, seed, opts) always yields the identical
 * batch (each player consumes the rng stream in a fixed order). Output players are
 * frozen (matching buildWorld's shallow freeze). Constants from
 * BALANCE.CAREER.NEWGEN; player shape via domain/createPlayer.
 */

import { BALANCE } from '../../../config/balance.js';
import { createPlayer, roleProfile } from '../../../domain/player.js';
import { ATTR_KEYS, clamp, num, meanAttrs } from '../playerStats.js';
import { assignTraitsForNewgen } from '../traits.js';

const N = BALANCE.CAREER.NEWGEN;
const ROLES = Object.freeze(['Duelist', 'Initiator', 'Controller', 'Sentinel']);
// Per-role intake weight (defaults to uniform if a role is unlisted). A single
// weighted draw per newgen keeps the rng stream's draw count stable.
const ROLE_WEIGHT = (role) => {
  const w = N.ROLE_WEIGHTS && typeof N.ROLE_WEIGHTS[role] === 'number' ? N.ROLE_WEIGHTS[role] : 1;
  return w > 0 ? w : 0;
};

// Syllable tables for generated handles/names (data, not tuning). Kept small and
// stable so ids/handles are reproducible.
const HANDLE_HEAD = Object.freeze(['ze', 'kry', 'vex', 'nyx', 'sol', 'rai', 'zen', 'kai', 'vry', 'lux', 'oni', 'sab', 'tyr', 'dex', 'qro', 'jin']);
const HANDLE_TAIL = Object.freeze(['ku', 'os', 'ix', 'en', 'ra', 'yo', 'us', 'ai', 'zo', 'er', 'on', 'ux', 'el', 'is', 'ar', 'um']);
const FIRST_NAMES = Object.freeze(['Leo', 'Kim', 'Mateo', 'Noah', 'Ravi', 'Yuki', 'Liam', 'Omar', 'Diego', 'Aron', 'Jae', 'Theo', 'Niko', 'Sven', 'Cai', 'Ilya']);
const LAST_NAMES = Object.freeze(['Park', 'Silva', 'Tan', 'Novak', 'Khan', 'Reyes', 'Berg', 'Costa', 'Adeyemi', 'Volkov', 'Sato', 'Mensah', 'Lund', 'Okafor', 'Marin', 'Haas']);

/** Build a generated handle like "Zenku" / "Vexix". */
function makeHandle(rng) {
  const head = rng.pick(HANDLE_HEAD);
  const tail = rng.pick(HANDLE_TAIL);
  return (head + tail).charAt(0).toUpperCase() + (head + tail).slice(1);
}

/** Build a generated real-name like "Leo Park". */
function makeName(rng) {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

/**
 * Generate a batch of newgen free-agent players.
 *
 * @param {number} count
 * @param {import('../../../core/rng.js').Rng} rng
 * @param {{ idPrefix?:string, nationalityPool?:string[], season?:number }} [opts]
 * @returns {object[]} frozen Players (status 'free_agent', teamId null)
 */
export function generateNewgens(count, rng, opts = {}) {
  if (!rng || typeof rng.gaussian !== 'function') {
    throw new Error('generateNewgens: an Rng is required');
  }
  const n = Math.max(0, Math.floor(num(count, 0)));
  const idPrefix = typeof opts.idPrefix === 'string' && opts.idPrefix ? opts.idPrefix : 'ng';
  const season = num(opts.season, 0);
  const natPool = Array.isArray(opts.nationalityPool) && opts.nationalityPool.length
    ? opts.nationalityPool
    : ['INT'];

  /** @type {object[]} */
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const role = rng.weightedPick(ROLES, ROLE_WEIGHT);
    const age = rng.range(N.AGE_MIN, N.AGE_MAX);
    let potential = Math.round(clamp(rng.gaussian(N.POT_MEAN, N.POT_STD), N.POT_MIN, N.POT_MAX));
    const headroom = rng.range(N.HEADROOM_MIN, N.HEADROOM_MAX);
    const baseOverall = clamp(potential - headroom, 20, 95);

    // Role-SHAPED stat line centred on baseOverall: take the role's reference
    // profile, re-centre it to zero mean (delta = slant − profileMean), and add
    // those deltas to baseOverall. A generated Duelist is therefore aim-heavy /
    // igl-light just like an authored one, while the player's OVERALL still
    // equals baseOverall (deltas sum to ~0) so the quality calibration above is
    // untouched. One gaussian per attribute keeps the rng draw count stable.
    const profile = roleProfile(role);
    const profileMean = meanAttrs(profile);
    /** @type {Record<string, number>} */
    const attributes = {};
    for (const k of ATTR_KEYS) {
      const slant = profile[k] - profileMean;
      attributes[k] = Math.round(clamp(baseOverall + slant + rng.gaussian(0, N.ATTR_NOISE), 0, 100));
    }

    const nationality = rng.pick(natPool);
    const handle = makeHandle(rng);
    const name = makeName(rng);
    const peakAge = N.PEAK_AGE_MIN + rng.int(N.PEAK_AGE_SPAN); // 24–27
    const declineAge = N.DECLINE_AGE_MIN + rng.int(N.DECLINE_AGE_SPAN); // 28–31

    // P12.1 — development character (draws appended LAST to keep the prior draw
    // positions stable). Archetype shapes the growth curve; growthRate adds
    // per-player learning-speed variance; wonderkids carry a higher ceiling.
    const archetype = rng.chance(N.WONDERKID_PROB) ? 'wonderkid'
      : rng.chance(N.BUST_PROB) ? 'bust'
        : rng.chance(N.LATEBLOOMER_PROB) ? 'lateBloomer'
          : 'normal';
    const growthRate = clamp(rng.gaussian(N.GROWTH_RATE_MEAN, N.GROWTH_RATE_STD), N.GROWTH_RATE_MIN, N.GROWTH_RATE_MAX);
    if (archetype === 'wonderkid') {
      potential = Math.round(clamp(potential + N.WONDERKID_POT_BOOST, N.POT_MIN, N.POT_MAX));
    }
    const traits = assignTraitsForNewgen(rng);
    const id = `${idPrefix}-${season}-${i}`;

    out.push(Object.freeze(createPlayer({
      id,
      name,
      handle,
      nationality,
      traits,
      age,
      role,
      attributes,
      potential,
      development: { peakAge, declineAge, growthRate, archetype },
      contract: { teamId: null, salary: 0, expires: 0, status: 'free_agent' }
    })));
  }
  return out;
}
