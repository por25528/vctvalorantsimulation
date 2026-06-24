/**
 * domain/team.js — Team factory & typedef (CONTRACTS §7).
 *
 * `createTeam(partial)` returns a fully-formed, immutable Team, filling sane
 * defaults so seed data can be terse. Pure, no randomness, no DOM; runs
 * unchanged in Node and browser.
 */

/**
 * @typedef Team
 * @property {string} id
 * @property {string} name
 * @property {string} tag
 * @property {string|null} leagueId
 * @property {string|null} region   // P12: home region (pacific/americas/emea/china); set by buildWorld
 * @property {'t1'|'t2'} tier        // P12: top flight vs Tier-2 / Challengers
 * @property {string[]} roster   // player ids (5+)
 * @property {number} reputation
 * @property {number} budget
 * @property {number} chemistry      // P12: 0..100 team cohesion, evolves with results
 * @property {string|null} coachId   // P12: head coach (world.staff.coachesById), or null
 * @property {{name:string, rating:number, negotiation:number, salary:number}|null} coach // P13: inline head coach / GM (engine/career/staff.js)
 * @property {number} championshipPoints
 */

/** Domain-shape defaults for a Team. */
const DOMAIN = Object.freeze({
  DEFAULT_NAME: 'Unknown Team',
  DEFAULT_TAG: 'UNK',
  DEFAULT_REPUTATION: 50,
  DEFAULT_BUDGET: 1000000,
  REP_MIN: 0,
  REP_MAX: 100,
  // P12 additions
  TIERS: Object.freeze(['t1', 't2']),
  DEFAULT_TIER: 't1',
  CHEM_MIN: 0,
  CHEM_MAX: 100,
  DEFAULT_CHEMISTRY: 50
});

/**
 * Clamp a numeric value into [min, max]; non-finite falls back to `fallback`.
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
 * Non-negative finite number with fallback (no upper clamp).
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function nonNeg(value, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return n < 0 ? 0 : n;
}

/**
 * Normalize an inline coach object (P13). Accepts a well-formed coach (name +
 * numeric rating/negotiation/salary, all sanitized) or returns null. Identity-free
 * value object — it travels with the team through immutable spreads.
 * @param {*} coach
 * @returns {{name:string, rating:number, negotiation:number, salary:number}|null}
 */
function normalizeCoach(coach) {
  if (!coach || typeof coach !== 'object') return null;
  const name = typeof coach.name === 'string' && coach.name.length > 0 ? coach.name : 'Head Coach';
  return {
    name,
    rating: clampNum(coach.rating, 0, 100, 60),
    negotiation: clampNum(coach.negotiation, 0, 100, 60),
    salary: nonNeg(coach.salary, 0)
  };
}

/**
 * Create a fully-formed, immutable Team from a (possibly terse) partial.
 * @param {Partial<Team>} [partial]
 * @returns {Team}
 */
export function createTeam(partial = {}) {
  const t = partial && typeof partial === 'object' ? partial : {};
  const name = typeof t.name === 'string' && t.name.length > 0 ? t.name : DOMAIN.DEFAULT_NAME;
  const tag = typeof t.tag === 'string' && t.tag.length > 0 ? t.tag : DOMAIN.DEFAULT_TAG;
  const roster = Array.isArray(t.roster) ? t.roster.filter((id) => typeof id === 'string' && id.length > 0).slice() : [];

  return {
    id: typeof t.id === 'string' && t.id.length > 0 ? t.id : `team_${tag}`,
    name,
    tag,
    leagueId: typeof t.leagueId === 'string' && t.leagueId.length > 0 ? t.leagueId : null,
    region: typeof t.region === 'string' && t.region.length > 0 ? t.region : null,
    tier: DOMAIN.TIERS.includes(t.tier) ? t.tier : DOMAIN.DEFAULT_TIER,
    roster,
    reputation: clampNum(t.reputation, DOMAIN.REP_MIN, DOMAIN.REP_MAX, DOMAIN.DEFAULT_REPUTATION),
    budget: nonNeg(t.budget, DOMAIN.DEFAULT_BUDGET),
    chemistry: clampNum(t.chemistry, DOMAIN.CHEM_MIN, DOMAIN.CHEM_MAX, DOMAIN.DEFAULT_CHEMISTRY),
    coachId: typeof t.coachId === 'string' && t.coachId.length > 0 ? t.coachId : null,
    coach: normalizeCoach(t.coach),
    championshipPoints: nonNeg(t.championshipPoints, 0)
  };
}
