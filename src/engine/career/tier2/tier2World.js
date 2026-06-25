/**
 * engine/career/tier2/tier2World.js — build the Tier-2 (Challengers) sub-world.
 *
 * The franchised Tier-1 world comes from `buildWorld()` (48 teams / 240 players /
 * 4 leagues). This module builds the SECOND division that lives ALONGSIDE it in a
 * separate `world.tier2` namespace: for each region, BALANCE.CAREER.TIER2
 * .TEAMS_PER_REGION clubs (identities from data/seed/tier2.js) each with a
 * generated 5-player roster on a realistic T2 quality/age curve — a clear step
 * below T1, youth-skewed, with the upside that fuels the promotion pipeline.
 *
 * Keeping T2 in its OWN namespace (not folded into world.teamsById/playersById)
 * is deliberate: every existing determinism/count test pins the T1 world at exactly
 * 48 teams / 240 players / 4 region leagues, and the T1 season stays byte-identical
 * because nothing here touches its rng streams.
 *
 * Pure & deterministic: all randomness flows from a single dedicated rng built off
 * the career seed (`hashSeed(seed, 'tier2-build')`), so a given seed always yields
 * the identical Challengers world. Output is frozen; no input is mutated.
 */

import { createRng } from '../../../core/rng.js';
import { hashSeed } from '../../../core/hash.js';
import { createTeam } from '../../../domain/team.js';
import { createLeague } from '../../../domain/league.js';
import { createPlayer, roleProfile } from '../../../domain/player.js';
import { ATTR_KEYS, clamp, num, meanAttrs, overall } from '../playerStats.js';
import { salaryFor } from '../offseason/contracts.js';
import { assignTraitsForNewgen } from '../traits.js';
import { BALANCE } from '../../../config/balance.js';
import {
  TIER2_TEAMS_BY_REGION,
  NATIONALITY_POOL_BY_REGION,
  TIER2_REGION_ORDER
} from '../../../data/seed/tier2.js';

const T2 = BALANCE.CAREER.TIER2;
const N = BALANCE.CAREER.NEWGEN;

const ROLES = Object.freeze(['Duelist', 'Initiator', 'Controller', 'Sentinel']);
// Each five is built role-complete (one of each, plus a weighted fifth) so T2
// lineups read like real teams and the match engine fields a balanced side.
const ROLE_SLOTS = Object.freeze(['Duelist', 'Initiator', 'Controller', 'Sentinel']);
const ROLE_WEIGHT = (role) => {
  const w = N.ROLE_WEIGHTS && typeof N.ROLE_WEIGHTS[role] === 'number' ? N.ROLE_WEIGHTS[role] : 1;
  return w > 0 ? w : 0;
};

// Generated-handle syllable tables (data, not tuning) — distinct flavour from the
// T1 newgen tables so a T2 academy name reads a little different.
const HANDLE_HEAD = Object.freeze(['ax', 'bru', 'cyl', 'dro', 'esk', 'fyn', 'gor', 'hux', 'iro', 'jax', 'kez', 'lon', 'myr', 'nox', 'orb', 'pyx']);
const HANDLE_TAIL = Object.freeze(['ko', 'ze', 'ix', 'an', 'ro', 'yu', 'us', 'ei', 'zo', 'er', 'on', 'ux', 'al', 'io', 'ar', 'um']);
const FIRST_NAMES = Object.freeze(['Adriano', 'Bao', 'Cem', 'Dmitri', 'Eko', 'Finn', 'Gen', 'Hiro', 'Ivan', 'Jun', 'Kasper', 'Luca', 'Marek', 'Niels', 'Ozan', 'Pavel']);
const LAST_NAMES = Object.freeze(['Andersen', 'Bauer', 'Chen', 'Duarte', 'Eriksson', 'Fontaine', 'Gomez', 'Huang', 'Ito', 'Jensen', 'Kowalski', 'Lima', 'Moreau', 'Nakamura', 'Ortiz', 'Petrov']);

/** Build a generated handle like "Axko" / "Pyxar". */
function makeHandle(rng) {
  const head = rng.pick(HANDLE_HEAD);
  const tail = rng.pick(HANDLE_TAIL);
  const s = head + tail;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Build a generated real-name like "Luca Chen". */
function makeName(rng) {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

/** Pretty region label for a league name. */
function regionLabel(region) {
  switch (region) {
    case 'pacific': return 'Pacific';
    case 'americas': return 'Americas';
    case 'emea': return 'EMEA';
    case 'china': return 'China';
    default: return region;
  }
}

/**
 * Age-decreasing potential headroom: full POT_HEADROOM_MAX at AGE_MIN, fading
 * linearly to 0 by POT_HEADROOM_REF_AGE (a finished player). A young T2 prospect
 * therefore has a real ceiling to climb toward; a 26+ journeyman is at their cap.
 * @param {number} age
 * @returns {number}
 */
function headroomForAge(age) {
  const span = Math.max(1, T2.POT_HEADROOM_REF_AGE - T2.AGE_MIN);
  const frac = clamp((T2.POT_HEADROOM_REF_AGE - age) / span, 0, 1);
  return T2.POT_HEADROOM_MAX * frac;
}

/**
 * Generate one Tier-2 player on the T2 quality/age curve, rostered to `teamId`.
 *
 * @param {import('../../../core/rng.js').Rng} rng
 * @param {{ id:string, role:string, region:string, natPool:string[], teamId:string, season:number }} opts
 * @returns {object} frozen Player (tier 't2', active contract on teamId)
 */
function generateTier2Player(rng, opts) {
  const role = opts.role || rng.weightedPick(ROLES, ROLE_WEIGHT);
  const age = Math.round(clamp(rng.gaussian(T2.AGE_MEAN, T2.AGE_STD), T2.AGE_MIN, T2.AGE_MAX));
  const ovrTarget = clamp(rng.gaussian(T2.OVR_MEAN, T2.OVR_STD), T2.OVR_MIN, T2.OVR_MAX);

  // Role-SHAPED stat line centred on ovrTarget (same technique as newgen): take the
  // role's reference profile, re-centre it to zero mean, add to ovrTarget — so a T2
  // Duelist is aim-heavy/igl-light while overall still equals the target.
  const profile = roleProfile(role);
  const profileMean = meanAttrs(profile);
  /** @type {Record<string, number>} */
  const attributes = {};
  for (const k of ATTR_KEYS) {
    const slant = profile[k] - profileMean;
    attributes[k] = Math.round(clamp(ovrTarget + slant + rng.gaussian(0, T2.ATTR_NOISE), 0, 100));
  }

  // Potential = current overall + age-scaled headroom, capped at POT_MAX.
  const baseOverall = meanAttrs(attributes);
  const potential = Math.round(clamp(baseOverall + headroomForAge(age), baseOverall, T2.POT_MAX));

  // Development character (reuse the T1 newgen bands so curves are consistent).
  const growthRate = clamp(rng.gaussian(N.GROWTH_RATE_MEAN, N.GROWTH_RATE_STD), N.GROWTH_RATE_MIN, N.GROWTH_RATE_MAX);
  const archetype = rng.chance(N.WONDERKID_PROB) ? 'wonderkid'
    : rng.chance(N.LATEBLOOMER_PROB) ? 'lateBloomer'
      : rng.chance(N.BUST_PROB) ? 'bust'
        : 'normal';
  const peakAge = N.PEAK_AGE_MIN + rng.int(N.PEAK_AGE_SPAN);
  const declineAge = N.DECLINE_AGE_MIN + rng.int(N.DECLINE_AGE_SPAN);
  const expires = opts.season + 1 + rng.int(2); // staggered 1..2 seasons out

  const nationality = rng.pick(opts.natPool);
  const handle = makeHandle(rng);
  const name = makeName(rng);
  const traits = assignTraitsForNewgen(rng);

  const player = createPlayer({
    id: opts.id,
    name,
    handle,
    nationality,
    traits,
    tier: 't2',
    age,
    role,
    attributes,
    potential,
    development: { peakAge, declineAge, growthRate, archetype },
    contract: { teamId: opts.teamId, salary: 0, expires, status: 'active' }
  });
  // Salary derived from the finished player (salaryFor reads overall+potential).
  return Object.freeze({ ...player, contract: { ...player.contract, salary: salaryFor(player) } });
}

/**
 * Reputation/budget for a freshly-built T2 club: modest and below the T1 floor of
 * prestige, scaled a touch by squad strength so a stacked T2 side reads stronger.
 * @param {number} squadOverall  mean overall of the generated five
 * @returns {{ reputation:number, budget:number }}
 */
function t2ClubStanding(squadOverall) {
  // Reputation 22..44 (T1 seeds 38..84): Challengers clubs are humble names.
  const reputation = Math.round(clamp(22 + (squadOverall - T2.OVR_MIN) * 0.9, 20, 46));
  // A sane, static T2 operating budget (no franchised sponsor income), comfortably
  // above the league floor so wage bills are coverable.
  const budget = 450000 + Math.round(clamp((squadOverall - T2.OVR_MIN), 0, 40)) * 4000;
  return { reputation, budget };
}

/**
 * Build the full Tier-2 sub-world: 4 region leagues, each TEAMS_PER_REGION clubs
 * with generated rosters. Deterministic from `seed`.
 *
 * @param {number|string} seed  the career master seed
 * @param {number} [season=0]   season index (stamped into contract expiries/ids)
 * @returns {{ leagues:Record<string,object>, teamsById:Record<string,object>, playersById:Record<string,object> }}
 */
export function buildTier2World(seed, season = 0) {
  const rng = createRng(hashSeed(seed, 'tier2-build'));
  /** @type {Record<string, object>} */
  const leagues = {};
  /** @type {Record<string, object>} */
  const teamsById = {};
  /** @type {Record<string, object>} */
  const playersById = {};

  for (const region of TIER2_REGION_ORDER) {
    const metas = TIER2_TEAMS_BY_REGION[region] || [];
    const natPool = NATIONALITY_POOL_BY_REGION[region] || ['INT'];
    const teamIds = [];

    for (const meta of metas) {
      const roster = [];
      const fives = [];
      for (let k = 0; k < T2.ROSTER_SIZE; k += 1) {
        // First four take the four core roles; the fifth is a weighted pick.
        const role = k < ROLE_SLOTS.length ? ROLE_SLOTS[k] : rng.weightedPick(ROLES, ROLE_WEIGHT);
        const id = `${meta.id}-p${k}`;
        const player = generateTier2Player(rng, { id, role, region, natPool, teamId: meta.id, season });
        playersById[id] = player;
        roster.push(id);
        fives.push(player);
      }
      const squadOverall = fives.reduce((s, p) => s + overall(p), 0) / Math.max(1, fives.length);
      const standing = t2ClubStanding(squadOverall);
      const team = createTeam({
        id: meta.id,
        name: meta.name,
        tag: meta.tag,
        leagueId: `t2-league-${region}`,
        region,
        tier: 't2',
        roster,
        reputation: standing.reputation,
        budget: standing.budget,
        chemistry: 50
      });
      teamsById[team.id] = Object.freeze(team);
      teamIds.push(team.id);
    }

    leagues[region] = Object.freeze(createLeague({
      id: `t2-league-${region}`,
      name: `${regionLabel(region)} Challengers`,
      region,
      teamIds
    }));
  }

  return Object.freeze({
    leagues: Object.freeze(leagues),
    teamsById: Object.freeze(teamsById),
    playersById: Object.freeze(playersById)
  });
}

/**
 * Attach a freshly-built Tier-2 sub-world to a T1 World under `world.tier2`.
 * Non-mutating: returns a new frozen World that is the input plus `tier2`.
 *
 * @param {object} world  a T1 World { leagues, teamsById, playersById }
 * @param {number|string} seed
 * @param {number} [season=0]
 * @returns {object} frozen World with `tier2`
 */
export function attachTier2(world, seed, season = 0) {
  const tier2 = buildTier2World(seed, season);
  return Object.freeze({ ...world, tier2 });
}

/** Strip the `tier2` namespace from a World (returns a T1-only `{leagues, teamsById, playersById}`). */
export function stripTier2(world) {
  return { leagues: world.leagues, teamsById: world.teamsById, playersById: world.playersById };
}
