/**
 * tests/unit/retirement.test.mjs — off-season retirement decision
 * (CONTRACTS-CAREER §1.3, §5). Pure & rng-injected.
 */

import { assert, section } from '../_assert.mjs';
import { decideRetirement } from '../../src/engine/career/offseason/retirement.js';
import { createPlayer } from '../../src/domain/player.js';
import { createRng } from '../../src/core/rng.js';
import { BALANCE } from '../../src/config/balance.js';

const R = BALANCE.CAREER.RETIRE;

/** Retirement rate of `make()` over N seeded draws. */
function retireRate(make, n) {
  let retired = 0;
  for (let s = 0; s < n; s += 1) {
    if (decideRetirement(make(), createRng(20000 + s))) retired += 1;
  }
  return retired / n;
}

export default async function run() {
  section('decideRetirement — youth never retire, the ancient always do');
  const young = createPlayer({ name: 'Kid', age: 20 });
  for (let s = 0; s < 50; s += 1) {
    assert(decideRetirement(young, createRng(s)) === false, 'players below MIN_AGE never retire');
  }
  const ancient = createPlayer({ name: 'Legend', age: R.FORCE_AGE + 1 });
  for (let s = 0; s < 50; s += 1) {
    assert(decideRetirement(ancient, createRng(s)) === true, 'players at/above FORCE_AGE always retire');
  }

  section('decideRetirement — deterministic for a given seed');
  const mid = createPlayer({ name: 'Vet', age: 31, attributes: { aim: 70 } });
  assert(decideRetirement(mid, createRng(99)) === decideRetirement(mid, createRng(99)), 'same seed → same decision');

  section('decideRetirement — hazard rises with age');
  const rate30 = retireRate(() => createPlayer({ name: 'A', age: 30, attributes: { aim: 78 } }), 400);
  const rate36 = retireRate(() => createPlayer({ name: 'B', age: 36, attributes: { aim: 78 } }), 400);
  assert(rate36 > rate30, `older players retire more often (${rate30.toFixed(2)} @30 vs ${rate36.toFixed(2)} @36)`);

  section('decideRetirement — a faded, demoralized vet retires more than a happy star');
  const star = retireRate(() => createPlayer({ name: 'Star', age: 31, dynamics: { morale: 85 }, attributes: { aim: 90, movement: 88, reaction: 90, composure: 86, consistency: 86, gameSense: 88, utility: 84, trading: 86, igl: 70 } }), 400);
  const faded = retireRate(() => createPlayer({ name: 'Faded', age: 31, dynamics: { morale: 20 }, attributes: { aim: 55, movement: 54, reaction: 55, composure: 56, consistency: 54, gameSense: 58, utility: 56, trading: 55, igl: 50 } }), 400);
  assert(faded > star, `a faded, low-morale vet retires more than a happy star (${faded.toFixed(2)} vs ${star.toFixed(2)})`);
}
