/**
 * domain/player.js — Player factory & typedefs (CONTRACTS §7).
 *
 * `createPlayer(partial)` returns a fully-formed, immutable Player even from
 * input as terse as `{ name, role }`, so seed data can stay minimal:
 *  - attributes filled with role-appropriate defaults, clamped 0-100
 *  - dynamics default { form:0, morale:60, fatigue:0 }
 *  - development/contract defaulted; proficiency maps default to a baseline
 *
 * Pure, no randomness, no DOM. Runs unchanged in Node and browser (ES modules).
 *
 * Domain-shape defaults (which fields exist and their starting values) are a
 * domain-layer concern and are centralized in DOMAIN below rather than scattered
 * as inline literals. Engine *tuning* numbers live in config/balance.js.
 */

import { languagesFor } from '../data/languages.js';

/** @typedef {'Duelist'|'Initiator'|'Controller'|'Sentinel'} Role */

/**
 * @typedef Attributes
 * @property {number} aim
 * @property {number} movement
 * @property {number} reaction
 * @property {number} composure
 * @property {number} consistency
 * @property {number} gameSense
 * @property {number} utility
 * @property {number} trading
 * @property {number} igl
 */

/**
 * @typedef Player
 * @property {string} id
 * @property {string} name
 * @property {string} handle
 * @property {string} nationality
 * @property {string[]} languages  // P12: spoken languages, native first (chemistry/comms)
 * @property {string[]} traits     // P12: personality/play traits (effects in engine/career/traits.js)
 * @property {'t1'|'t2'|'prospect'} tier  // P12: competitive tier (T1 roster | Tier-2 | academy prospect)
 * @property {number} age
 * @property {Role} role
 * @property {Attributes} attributes
 * @property {number} potential
 * @property {{ potentialLow:number, potentialHigh:number, knowledge:number }} scouting  // P12: hidden-potential reveal band (knowledge 0..100)
 * @property {{ roles:Record<string,number>, agents:Record<string,number>, maps:Record<string,number> }} proficiency
 * @property {{ form:number, morale:number, fatigue:number }} dynamics
 * @property {{ trajectory:number, growthRate:number, peakAge:number, declineAge:number, archetype:'normal'|'wonderkid'|'bust'|'lateBloomer' }} development
 * @property {{ teamId:string|null, salary:number, expires:number, status:'active'|'free_agent'|'retired' }} contract
 * @property {{ weeks:number, type:string }|null} injury  // P7c: null = fit; weeks>0 = slots until recovered
 */

/** Canonical attribute keys, fixed order (stable object shape for determinism). */
const ATTRIBUTE_KEYS = Object.freeze([
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

/** Valid player roles. */
const ROLES = Object.freeze(['Duelist', 'Initiator', 'Controller', 'Sentinel']);

/** Domain-shape defaults for a Player (single source of domain defaults). */
const DOMAIN = Object.freeze({
  ATTR_MIN: 0,
  ATTR_MAX: 100,

  // Baseline applied to any attribute not given a role-specific default.
  ATTR_BASELINE: 70,

  // Role-appropriate attribute slants. Missing keys fall back to ATTR_BASELINE.
  ROLE_ATTRS: Object.freeze({
    Duelist: Object.freeze({ aim: 82, movement: 82, reaction: 80, composure: 72, trading: 74, utility: 64, gameSense: 70, igl: 40 }),
    Initiator: Object.freeze({ aim: 76, movement: 74, reaction: 76, composure: 74, trading: 78, utility: 82, gameSense: 80, igl: 58 }),
    Controller: Object.freeze({ aim: 72, movement: 70, reaction: 72, composure: 78, trading: 70, utility: 84, gameSense: 82, igl: 66 }),
    Sentinel: Object.freeze({ aim: 76, movement: 70, reaction: 76, composure: 80, trading: 70, utility: 80, gameSense: 80, igl: 50 })
  }),

  DEFAULT_ROLE: 'Initiator',
  DEFAULT_NAME: 'Unknown Player',
  DEFAULT_NATIONALITY: 'INT',
  DEFAULT_AGE: 21,
  DEFAULT_POTENTIAL: 75,

  // P12 — competitive tier; defaults to the franchised top flight.
  TIERS: Object.freeze(['t1', 't2', 'prospect']),
  DEFAULT_TIER: 't1',
  // P12 — max traits a player can carry (keeps personality legible & bounded).
  TRAITS_MAX: 4,
  // P12 — development archetypes (growth-curve shapes).
  ARCHETYPES: Object.freeze(['normal', 'wonderkid', 'bust', 'lateBloomer']),
  DEFAULT_ARCHETYPE: 'normal',

  // Baseline value for any unspecified proficiency entry. Engine code that reads
  // a missing proficiency should treat absence as this baseline; we also seed
  // the role's own proficiency so it is never empty.
  PROFICIENCY_BASELINE: 50,
  PRIMARY_ROLE_PROFICIENCY: 80,

  DYNAMICS: Object.freeze({ form: 0, morale: 60, fatigue: 0 }),
  DYNAMICS_RANGE: Object.freeze({
    form: Object.freeze({ min: -100, max: 100 }),
    morale: Object.freeze({ min: 0, max: 100 }),
    fatigue: Object.freeze({ min: 0, max: 100 })
  }),

  // P12.1: primes pushed a touch later (peak 25 / decline 29) so careers run
  // longer and elite veterans stay competitive (high-IGL players later still).
  DEVELOPMENT: Object.freeze({ trajectory: 0, growthRate: 1, peakAge: 25, declineAge: 29, archetype: 'normal' }),
  CONTRACT: Object.freeze({ teamId: null, salary: 0, expires: 0, status: 'active' })
});

/**
 * Clamp a numeric value into [min, max]. Non-finite input falls back to `fallback`.
 * @param {*} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampNum(value, min, max, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Normalize a role string; unknown/missing roles fall back to the default role.
 * @param {*} role
 * @returns {Role}
 */
function normalizeRole(role) {
  return ROLES.includes(role) ? role : DOMAIN.DEFAULT_ROLE;
}

/**
 * Build the full Attributes object: role defaults overlaid by any provided
 * values, every entry clamped to [0,100].
 * @param {Role} role
 * @param {Partial<Attributes>|undefined} provided
 * @returns {Attributes}
 */
function buildAttributes(role, provided) {
  const roleAttrs = DOMAIN.ROLE_ATTRS[role] || {};
  const src = provided && typeof provided === 'object' ? provided : {};
  /** @type {Attributes} */
  const out = /** @type {Attributes} */ ({});
  for (const key of ATTRIBUTE_KEYS) {
    const fallback = key in roleAttrs ? roleAttrs[key] : DOMAIN.ATTR_BASELINE;
    out[key] = clampNum(src[key], DOMAIN.ATTR_MIN, DOMAIN.ATTR_MAX, fallback);
  }
  return out;
}

/**
 * Build a clamped proficiency sub-map from a provided record (defaulting empty).
 * @param {Record<string,number>|undefined} provided
 * @returns {Record<string,number>}
 */
function buildProficiencyMap(provided) {
  /** @type {Record<string,number>} */
  const out = {};
  if (provided && typeof provided === 'object') {
    for (const key of Object.keys(provided)) {
      out[key] = clampNum(provided[key], DOMAIN.ATTR_MIN, DOMAIN.ATTR_MAX, DOMAIN.PROFICIENCY_BASELINE);
    }
  }
  return out;
}

/**
 * Build the proficiency object. Maps default to empty (consumers treat a missing
 * key as PROFICIENCY_BASELINE) but the player's primary role is always seeded so
 * the roles map is never empty.
 * @param {Role} role
 * @param {{ roles?:Record<string,number>, agents?:Record<string,number>, maps?:Record<string,number> }|undefined} provided
 * @returns {{ roles:Record<string,number>, agents:Record<string,number>, maps:Record<string,number> }}
 */
function buildProficiency(role, provided) {
  const src = provided && typeof provided === 'object' ? provided : {};
  const roles = buildProficiencyMap(src.roles);
  if (!(role in roles)) roles[role] = DOMAIN.PRIMARY_ROLE_PROFICIENCY;
  return {
    roles,
    agents: buildProficiencyMap(src.agents),
    maps: buildProficiencyMap(src.maps)
  };
}

/**
 * Sanitize a languages list: non-empty lowercase strings, de-duplicated, order
 * preserved (primary first). When none are provided, derive from nationality.
 * @param {*} provided
 * @param {string} nationality
 * @returns {string[]}
 */
function buildLanguages(provided, nationality) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(provided)) {
    for (const v of provided) {
      if (typeof v === 'string' && v.length > 0) {
        const code = v.toLowerCase();
        if (!seen.has(code)) { seen.add(code); out.push(code); }
      }
    }
  }
  if (out.length > 0) return out;
  return languagesFor(nationality);
}

/**
 * Sanitize a traits list: non-empty strings, de-duplicated, capped at TRAITS_MAX.
 * Validation against the known-trait registry lives in engine/career/traits.js;
 * the domain only guarantees a clean, bounded string array.
 * @param {*} provided
 * @returns {string[]}
 */
function buildTraits(provided) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(provided)) {
    for (const v of provided) {
      if (typeof v === 'string' && v.length > 0 && !seen.has(v)) {
        seen.add(v);
        out.push(v);
        if (out.length >= DOMAIN.TRAITS_MAX) break;
      }
    }
  }
  return out;
}

/**
 * Build the scouting band. Defaults to fully-known (low=high=potential,
 * knowledge=100) so authored T1 players are not "hidden". Generated youth pass an
 * explicit band with knowledge<100. low<=high is enforced; all values clamp 0..100.
 * @param {*} provided
 * @param {number} potential
 * @returns {{ potentialLow:number, potentialHigh:number, knowledge:number }}
 */
function buildScouting(provided, potential) {
  const src = provided && typeof provided === 'object' ? provided : {};
  const low = clampNum(src.potentialLow, DOMAIN.ATTR_MIN, DOMAIN.ATTR_MAX, potential);
  const high = clampNum(src.potentialHigh, DOMAIN.ATTR_MIN, DOMAIN.ATTR_MAX, potential);
  const knowledge = clampNum(src.knowledge, 0, 100, 100);
  return {
    potentialLow: Math.min(low, high),
    potentialHigh: Math.max(low, high),
    knowledge
  };
}

/**
 * Create a fully-formed, immutable Player from a (possibly terse) partial.
 * @param {Partial<Player>} [partial]
 * @returns {Player}
 */
export function createPlayer(partial = {}) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const role = normalizeRole(p.role);

  const name = typeof p.name === 'string' && p.name.length > 0 ? p.name : DOMAIN.DEFAULT_NAME;
  const handle = typeof p.handle === 'string' && p.handle.length > 0 ? p.handle : name;

  const providedDyn = p.dynamics && typeof p.dynamics === 'object' ? p.dynamics : {};
  const providedDev = p.development && typeof p.development === 'object' ? p.development : {};
  const providedContract = p.contract && typeof p.contract === 'object' ? p.contract : {};

  const dynamics = {
    form: clampNum(providedDyn.form, DOMAIN.DYNAMICS_RANGE.form.min, DOMAIN.DYNAMICS_RANGE.form.max, DOMAIN.DYNAMICS.form),
    morale: clampNum(providedDyn.morale, DOMAIN.DYNAMICS_RANGE.morale.min, DOMAIN.DYNAMICS_RANGE.morale.max, DOMAIN.DYNAMICS.morale),
    fatigue: clampNum(providedDyn.fatigue, DOMAIN.DYNAMICS_RANGE.fatigue.min, DOMAIN.DYNAMICS_RANGE.fatigue.max, DOMAIN.DYNAMICS.fatigue)
  };

  const development = {
    trajectory: typeof providedDev.trajectory === 'number' && Number.isFinite(providedDev.trajectory) ? providedDev.trajectory : DOMAIN.DEVELOPMENT.trajectory,
    growthRate: typeof providedDev.growthRate === 'number' && Number.isFinite(providedDev.growthRate) ? providedDev.growthRate : DOMAIN.DEVELOPMENT.growthRate,
    peakAge: typeof providedDev.peakAge === 'number' && Number.isFinite(providedDev.peakAge) ? providedDev.peakAge : DOMAIN.DEVELOPMENT.peakAge,
    declineAge: typeof providedDev.declineAge === 'number' && Number.isFinite(providedDev.declineAge) ? providedDev.declineAge : DOMAIN.DEVELOPMENT.declineAge,
    archetype: DOMAIN.ARCHETYPES.includes(providedDev.archetype) ? providedDev.archetype : DOMAIN.DEFAULT_ARCHETYPE
  };

  const status = providedContract.status === 'free_agent' || providedContract.status === 'retired' ? providedContract.status : DOMAIN.CONTRACT.status;
  const contract = {
    teamId: typeof providedContract.teamId === 'string' ? providedContract.teamId : DOMAIN.CONTRACT.teamId,
    salary: typeof providedContract.salary === 'number' && Number.isFinite(providedContract.salary) ? providedContract.salary : DOMAIN.CONTRACT.salary,
    expires: typeof providedContract.expires === 'number' && Number.isFinite(providedContract.expires) ? providedContract.expires : DOMAIN.CONTRACT.expires,
    status
  };

  // Injury (P7c): null when fit. A provided injury is honoured only if it has a
  // positive `weeks` remaining; otherwise the player is fit.
  const pi = p.injury && typeof p.injury === 'object' ? p.injury : null;
  const injury = pi && typeof pi.weeks === 'number' && Number.isFinite(pi.weeks) && pi.weeks > 0
    ? { weeks: Math.floor(pi.weeks), type: typeof pi.type === 'string' && pi.type ? pi.type : 'knock' }
    : null;

  const nationality = typeof p.nationality === 'string' && p.nationality.length > 0 ? p.nationality : DOMAIN.DEFAULT_NATIONALITY;
  const potential = clampNum(p.potential, DOMAIN.ATTR_MIN, DOMAIN.ATTR_MAX, DOMAIN.DEFAULT_POTENTIAL);

  return {
    id: typeof p.id === 'string' && p.id.length > 0 ? p.id : `player_${handle}`,
    name,
    handle,
    nationality,
    languages: buildLanguages(p.languages, nationality),
    traits: buildTraits(p.traits),
    tier: DOMAIN.TIERS.includes(p.tier) ? p.tier : DOMAIN.DEFAULT_TIER,
    age: clampNum(p.age, 14, 60, DOMAIN.DEFAULT_AGE),
    role,
    attributes: buildAttributes(role, p.attributes),
    potential,
    scouting: buildScouting(p.scouting, potential),
    proficiency: buildProficiency(role, p.proficiency),
    dynamics,
    development,
    contract,
    injury
  };
}
