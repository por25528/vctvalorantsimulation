/**
 * tests/unit/staff.test.mjs — the transfer-focused head coach (P13).
 * Pure & rng-injected.
 */

import { assert, section } from '../_assert.mjs';
import {
  generateCoach,
  coachChemBump,
  seedCoaches,
  runStaff,
  makeCoachNegoOf
} from '../../src/engine/career/staff.js';
import { createTeam } from '../../src/domain/team.js';
import { createRng } from '../../src/core/rng.js';
import { BALANCE } from '../../src/config/balance.js';

const S = BALANCE.CAREER.STAFF;

function worldOf(teams) {
  const teamsById = {};
  for (const t of teams) teamsById[t.id] = t;
  return { leagues: {}, teamsById, playersById: {} };
}

export default async function run() {
  section('generateCoach — valid shape & ranges; prestige biases quality up');
  const rng = createRng(1);
  const c = generateCoach(rng, { reputation: 50 });
  assert(typeof c.name === 'string' && c.name.length > 0, 'coach has a name');
  assert(c.rating >= 25 && c.rating <= 99, 'rating in band');
  assert(c.negotiation >= 25 && c.negotiation <= 99, 'negotiation in band');
  assert(c.salary >= S.SALARY_BASE, 'salary at least the base');
  // Over many draws, a prestige club lands better staff on average.
  let hi = 0; let lo = 0; const N = 200;
  const r = createRng(42);
  for (let i = 0; i < N; i += 1) hi += generateCoach(r, { reputation: 90 }).rating;
  for (let i = 0; i < N; i += 1) lo += generateCoach(r, { reputation: 30 }).rating;
  assert(hi / N > lo / N, `prestige clubs average better coaches (${(hi / N).toFixed(1)} vs ${(lo / N).toFixed(1)})`);

  section('coachChemBump — positive for a good coach, negative for a poor one, clamped');
  assert(coachChemBump({ rating: 90 }) > 0, 'a strong coach lifts chemistry');
  assert(coachChemBump({ rating: 30 }) < 0, 'a weak coach drags chemistry');
  assert(coachChemBump({ rating: 100 }) <= S.CHEM_BUMP_MAX, 'bump is capped');
  assert(coachChemBump(null) === 0, 'no coach = no bump');

  section('seedCoaches — every team gets a coach; pure & deterministic');
  const world = worldOf([
    createTeam({ id: 't1', reputation: 80, budget: 2000000 }),
    createTeam({ id: 't2', reputation: 40, budget: 800000 })
  ]);
  const seeded = seedCoaches(world, createRng(5));
  assert(seeded.teamsById.t1.coach && seeded.teamsById.t2.coach, 'both teams have a coach');
  assert(!world.teamsById.t1.coach, 'input world is not mutated (still coachless)');
  const seeded2 = seedCoaches(world, createRng(5));
  assert(seeded2.teamsById.t1.coach.rating === seeded.teamsById.t1.coach.rating, 'deterministic for the same seed');

  section('runStaff — a coachless club hires; salary is paid; chemistry shifts');
  const w2 = worldOf([createTeam({ id: 'x', reputation: 70, budget: 3000000, chemistry: 50 })]);
  // Try seeds until a hire fires (HIRE_CHANCE < 1), then verify the effects.
  let hired = null;
  for (let s = 0; s < 40 && !hired; s += 1) {
    const out = runStaff(w2, createRng(s));
    if (out.hires.length > 0) hired = out;
  }
  assert(hired, 'a solvent coachless club hires across some windows');
  const tx = hired.world.teamsById.x;
  assert(tx.coach, 'the club now has a coach');
  assert(tx.budget < 3000000, 'the coach salary was paid out of the budget');
  assert(!w2.teamsById.x.coach, 'input world not mutated by runStaff (still coachless)');

  section('makeCoachNegoOf — exposes the coach negotiation rating (0 when none)');
  const negoOf = makeCoachNegoOf(seeded);
  assert(negoOf('t1') === seeded.teamsById.t1.coach.negotiation, 'returns the coach negotiation');
  assert(makeCoachNegoOf(world)('t1') === 0, 'no coach = 0 negotiation');
}
