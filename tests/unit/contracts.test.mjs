/**
 * tests/unit/contracts.test.mjs — off-season contract renewal/release
 * (CONTRACTS-CAREER §1.5, §5). Pure & rng-injected.
 */

import { assert, section } from '../_assert.mjs';
import { resolveContract, salaryFor } from '../../src/engine/career/offseason/contracts.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { createRng } from '../../src/core/rng.js';
import { BALANCE } from '../../src/config/balance.js';

const C = BALANCE.CAREER.CONTRACT;

/** Renewal rate of resolveContract(make(), team) over N seeded draws. */
function renewRate(makePlayer, team, n, opts) {
  let renewed = 0;
  for (let s = 0; s < n; s += 1) {
    if (resolveContract(makePlayer(), team, createRng(30000 + s), opts).status === 'active') renewed += 1;
  }
  return renewed / n;
}

export default async function run() {
  const team = createTeam({ id: 'drx', name: 'DRX', reputation: 80, budget: 2000000 });
  const star = () => createPlayer({
    name: 'Star', age: 24, potential: 92, dynamics: { morale: 85 },
    attributes: { aim: 88, movement: 86, reaction: 88, composure: 84, consistency: 84, gameSense: 86, utility: 80, trading: 84, igl: 60 }
  });

  section('resolveContract — deterministic for a given seed');
  const r1 = resolveContract(star(), team, createRng(11), { season: 3 });
  const r2 = resolveContract(star(), team, createRng(11), { season: 3 });
  assert(JSON.stringify(r1) === JSON.stringify(r2), 'same seed → identical contract outcome');

  section('resolveContract — renewal shape (active) vs release shape (free agent)');
  // Find one of each across seeds to validate both shapes.
  let renewal = null;
  let release = null;
  for (let s = 0; s < 200 && (!renewal || !release); s += 1) {
    const out = resolveContract(star(), team, createRng(40000 + s), { season: 3 });
    if (out.status === 'active' && !renewal) renewal = out;
    if (out.status === 'free_agent' && !release) release = out;
  }
  assert(renewal, 'at least one renewal occurs across seeds');
  assert(renewal.teamId === 'drx', 'a renewal keeps the player at the team');
  assert(
    renewal.expires >= 3 + C.LENGTH_MIN && renewal.expires <= 3 + C.LENGTH_MAX,
    `renewal length is within bounds (expires ${renewal && renewal.expires})`
  );
  assert(renewal.salary > 0, 'a renewal carries a positive salary');
  if (release) {
    assert(release.teamId === null && release.salary === 0, 'a release sends the player to free agency');
  }

  section('resolveContract — happy stars re-sign more than unhappy fringe players');
  const fringe = () => createPlayer({
    name: 'Fringe', age: 30, potential: 64, dynamics: { morale: 30 },
    attributes: { aim: 60, movement: 60, reaction: 60, composure: 62, consistency: 60, gameSense: 62, utility: 60, trading: 60, igl: 55 }
  });
  const starRate = renewRate(star, team, 400, { season: 3 });
  const fringeRate = renewRate(fringe, team, 400, { season: 3 });
  assert(starRate > fringeRate, `happy stars renew more than unhappy fringe (${starRate.toFixed(2)} vs ${fringeRate.toFixed(2)})`);

  section('resolveContract — salary scales with overall');
  // Compare guaranteed-renewal salaries by reading the salary on renewals only.
  function avgRenewSalary(makePlayer) {
    let sum = 0;
    let k = 0;
    for (let s = 0; s < 400; s += 1) {
      const out = resolveContract(makePlayer(), team, createRng(50000 + s), { season: 0 });
      if (out.status === 'active') {
        sum += out.salary;
        k += 1;
      }
    }
    return k > 0 ? sum / k : 0;
  }
  const eliteSalary = avgRenewSalary(() => createPlayer({ name: 'Elite', age: 25, potential: 90, attributes: { aim: 92, movement: 90, reaction: 92, composure: 88, consistency: 88, gameSense: 90, utility: 86, trading: 88, igl: 70 } }));
  const roleSalary = avgRenewSalary(() => createPlayer({ name: 'Role', age: 25, potential: 74, attributes: { aim: 72, movement: 72, reaction: 72, composure: 72, consistency: 72, gameSense: 72, utility: 72, trading: 72, igl: 65 } }));
  assert(eliteSalary > roleSalary, `elite players earn more than role players (${Math.round(eliteSalary)} vs ${Math.round(roleSalary)})`);

  section('salaryFor — monotonic non-decreasing in overall (P13 regression)');
  // A better current player of the same potential must never be paid LESS — the
  // bug was the sub-60 band where rising overall shrank the upside premium.
  const uniform = (o, potential) => {
    const a = {};
    for (const k of ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl']) a[k] = o;
    return createPlayer({ name: 'P', potential, attributes: a });
  };
  for (const pot of [60, 70, 80, 90, 95]) {
    let prev = -Infinity;
    for (let o = 30; o <= pot; o += 1) {
      const s = salaryFor(uniform(o, pot));
      assert(s >= prev, `salaryFor non-decreasing: overall ${o} (pot ${pot}) pays ${s} < previous ${prev}`);
      assert(s >= 0, `salaryFor never negative (overall ${o}, pot ${pot})`);
      prev = s;
    }
  }
}
