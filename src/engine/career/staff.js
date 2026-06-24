/**
 * engine/career/staff.js — the transfer-focused head coach / GM (P13, the user's
 * "add a coach who can make better transfer deals" ask).
 *
 * A coach is a light, inline object on the team:
 *   team.coach = { name, rating, negotiation, salary } | null
 *
 * Its two effects are deliberately focused:
 *   1. DEALMAKING — a high `negotiation` rating prises contracted players away for
 *      a smaller fee and identifies targets better. This is wired into the market
 *      via `makeCoachNegoOf` → transferFee's coach discount (transfers.js).
 *   2. MAN-MANAGEMENT — a small off-season bump to the team's stored `chemistry`
 *      (which the match engine already reads, matchSim.js), scaled by the coach's
 *      overall rating. A great coach gels a roster; a poor one is a slight drag.
 *
 * Better-resourced, more prestigious orgs attract better staff (rating/negotiation
 * are biased up by reputation). Coaches cost a salary, paid out of the budget each
 * off-season. PURE & rng-injected — no Date/DOM; same (world, seed) reproduces the
 * same staff. The match/season engines are untouched. Constants from
 * BALANCE.CAREER.STAFF (+ ECONOMY.BUDGET_FLOOR, CHEMISTRY for clamps).
 */

import { BALANCE } from '../../config/balance.js';
import { clamp, num } from './playerStats.js';

const S = BALANCE.CAREER.STAFF;
const FLOOR = BALANCE.CAREER.ECONOMY.BUDGET_FLOOR;

/** Small deterministic name pools for generated coaches. */
const FIRST = Object.freeze(['Marcus', 'Yoann', 'Min-su', 'Rafael', 'Sergey', 'Daniel', 'Hiro', 'Onur', 'Kasper', 'Leo', 'Pavel', 'Andre', 'Felix', 'Jung-ho', 'Diego', 'Tomas', 'Bence', 'Wei', 'Sami', 'Erik']);
const LAST = Object.freeze(['Vargas', 'Petit', 'Kang', 'Almeida', 'Volkov', 'Reyes', 'Tanaka', 'Demir', 'Holm', 'Costa', 'Novak', 'Fischer', 'Park', 'Moreau', 'Silva', 'Horvath', 'Nakamura', 'Korhonen', 'Lindqvist', 'Bauer']);

/**
 * Generate a coach, biased up by the hiring club's reputation (better orgs land
 * better staff). Deterministic given the rng stream.
 *
 * @param {import('../../core/rng.js').Rng} rng
 * @param {{ reputation?:number }} [opts]
 * @returns {{ name:string, rating:number, negotiation:number, salary:number }}
 */
export function generateCoach(rng, opts = {}) {
  const rep = num(opts.reputation, 50);
  const repBias = S.HIRE_RATING_REP_K * (rep - 50);
  const rating = Math.round(clamp(rng.gaussian(S.RATING_MEAN, S.RATING_STD) + repBias, 25, 99));
  const negotiation = Math.round(clamp(rng.gaussian(S.NEGO_MEAN, S.NEGO_STD) + repBias, 25, 99));
  const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
  const salary = Math.round(S.SALARY_BASE + S.SALARY_RATING_K * rating);
  return { name, rating, negotiation, salary };
}

/**
 * The off-season chemistry bump a coach gives (can be slightly negative for a poor
 * coach), clamped to ±CHEM_BUMP_MAX.
 * @param {object|null} coach
 * @returns {number}
 */
export function coachChemBump(coach) {
  if (!coach) return 0;
  const r = num(coach.rating, 50);
  return clamp(S.CHEM_BUMP_K * (r - 50), -S.CHEM_BUMP_MAX, S.CHEM_BUMP_MAX);
}

/**
 * Give every team an initial coach (called once at career init), biased by the
 * club's reputation. Returns a NEW frozen World; the input is not mutated.
 *
 * @param {{leagues:object, teamsById:object, playersById:object}} world
 * @param {import('../../core/rng.js').Rng} rng
 * @returns {object} world with team.coach set on every team
 */
export function seedCoaches(world, rng) {
  if (!world || !world.teamsById) return world;
  /** @type {Record<string, object>} */
  const teamsById = {};
  for (const id of Object.keys(world.teamsById)) {
    const t = world.teamsById[id];
    const coach = generateCoach(rng, { reputation: num(t.reputation, 50) });
    teamsById[id] = Object.freeze({ ...t, coach });
  }
  return Object.freeze({
    leagues: world.leagues,
    teamsById: Object.freeze(teamsById),
    playersById: world.playersById
  });
}

/**
 * Run the off-season staff step on a world: a coachless, solvent club may hire
 * (HIRE_CHANCE); every club then pays its coach's salary (budget debit, floored)
 * and takes the coach's chemistry bump into next season. Returns a NEW frozen
 * World + the list of fresh hires. Pure & rng-injected; input not mutated.
 *
 * @param {{leagues:object, teamsById:object, playersById:object}} world
 * @param {import('../../core/rng.js').Rng} rng
 * @returns {{ world:object, hires:Array<{teamId:string, coach:object}> }}
 */
export function runStaff(world, rng) {
  if (!world || !world.teamsById) return { world, hires: [] };
  /** @type {Record<string, object>} */
  const teamsById = {};
  const hires = [];
  for (const id of Object.keys(world.teamsById)) {
    const t = world.teamsById[id];
    let coach = t.coach || null;
    let budget = num(t.budget, 0);

    // A coachless club hires when it can afford a typical wage and the dice allow.
    if (!coach) {
      const prospect = generateCoach(rng, { reputation: num(t.reputation, 50) });
      if (budget - prospect.salary > FLOOR && rng.chance(S.HIRE_CHANCE)) {
        coach = prospect;
        hires.push({ teamId: id, coach });
      }
    }

    let chemistry = num(t.chemistry, BALANCE.CAREER.CHEMISTRY.CHEM_BASE);
    if (coach) {
      budget = Math.max(FLOOR, budget - num(coach.salary, 0));
      chemistry = clamp(chemistry + coachChemBump(coach), 0, 100);
    }

    teamsById[id] = (coach === (t.coach || null) && budget === num(t.budget, 0) && chemistry === num(t.chemistry, BALANCE.CAREER.CHEMISTRY.CHEM_BASE))
      ? t
      : Object.freeze({ ...t, coach, budget: Math.round(budget), chemistry });
  }
  const next = Object.freeze({
    leagues: world.leagues,
    teamsById: Object.freeze(teamsById),
    playersById: world.playersById
  });
  return { world: next, hires };
}

/**
 * Build a `(teamId) => negotiation` lookup for the transfer market: a club's coach
 * negotiation rating (0 when it has no coach).
 * @param {{teamsById:object}} world
 * @returns {(teamId:string)=>number}
 */
export function makeCoachNegoOf(world) {
  return (teamId) => {
    const t = world && world.teamsById && world.teamsById[teamId];
    return t && t.coach ? num(t.coach.negotiation, 0) : 0;
  };
}
