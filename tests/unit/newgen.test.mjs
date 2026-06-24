/**
 * tests/unit/newgen.test.mjs — youth (newgen) generation
 * (CONTRACTS-CAREER §1.4, §5). Pure & rng-injected.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { generateNewgens } from '../../src/engine/career/offseason/newgen.js';
import { overall } from '../../src/engine/career/playerStats.js';
import { createRng } from '../../src/core/rng.js';
import { BALANCE } from '../../src/config/balance.js';

const N = BALANCE.CAREER.NEWGEN;

export default async function run() {
  const ARCHETYPES = new Set(['normal', 'wonderkid', 'bust', 'lateBloomer']);

  section('generateNewgens — count, shape, and free-agent status');
  const batch = generateNewgens(20, createRng(42), { idPrefix: 'ng', season: 1, nationalityPool: ['KR', 'US', 'BR'] });
  assert(batch.length === 20, 'produces exactly `count` players');
  for (const p of batch) {
    assert(p.contract.status === 'free_agent' && p.contract.teamId === null, 'every newgen is an unsigned free agent');
    assert(p.age >= N.AGE_MIN && p.age <= N.AGE_MAX, `age ${p.age} within the youth band`);
    assert(p.potential >= N.POT_MIN && p.potential <= N.POT_MAX, `potential ${p.potential} within bounds`);
    assert(['KR', 'US', 'BR'].includes(p.nationality), 'nationality drawn from the pool');
    assert(typeof p.handle === 'string' && p.handle.length > 0, 'has a generated handle');
    // P12.0/P12.1 — languages derived from nationality; development character set.
    assert(Array.isArray(p.languages) && p.languages.length > 0, 'newgen has languages');
    assert(ARCHETYPES.has(p.development.archetype), `archetype valid (${p.development.archetype})`);
    assert(p.development.growthRate >= N.GROWTH_RATE_MIN && p.development.growthRate <= N.GROWTH_RATE_MAX, `growthRate ${p.development.growthRate} within bounds`);
    assert(p.development.peakAge >= N.PEAK_AGE_MIN && p.development.peakAge < N.PEAK_AGE_MIN + N.PEAK_AGE_SPAN, 'peakAge in band');
    assert(p.development.declineAge >= N.DECLINE_AGE_MIN && p.development.declineAge < N.DECLINE_AGE_MIN + N.DECLINE_AGE_SPAN, 'declineAge in band');
  }

  section('generateNewgens — id scheme is prefix-season-index (no handle in id)');
  for (let i = 0; i < batch.length; i += 1) {
    assertEqual(batch[i].id, `ng-1-${i}`, `id ${batch[i].id} follows prefix-season-index`);
  }

  section('generateNewgens — archetypes show variety across a large batch');
  {
    const big = generateNewgens(400, createRng(2025), { season: 3 });
    const seen = new Set(big.map((p) => p.development.archetype));
    assert(seen.has('wonderkid') && seen.has('bust'), `wonderkids and busts both appear (${[...seen].join(', ')})`);
    const normals = big.filter((p) => p.development.archetype === 'normal').length;
    assert(normals > big.length * 0.4, `most prospects are "normal" (${normals}/${big.length})`);
  }

  section('generateNewgens — ids are globally unique within the batch');
  const ids = new Set(batch.map((p) => p.id));
  assert(ids.size === batch.length, 'no duplicate ids');

  section('generateNewgens — deterministic (same count+seed+opts → identical batch)');
  const a = generateNewgens(10, createRng(7), { season: 2 });
  const b = generateNewgens(10, createRng(7), { season: 2 });
  assertEqual(a, b, 'identical seed reproduces the identical batch');
  const c = generateNewgens(10, createRng(8), { season: 2 });
  assert(JSON.stringify(c) !== JSON.stringify(a), 'a different seed yields a different batch');

  section('generateNewgens — raw talent: current overall sits below potential');
  let below = 0;
  for (const p of batch) {
    if (overall(p) < p.potential) below += 1;
  }
  // Newgens start a headroom under their ceiling — the vast majority are unfinished.
  assert(below >= batch.length - 2, `newgens start below their potential (${below}/${batch.length})`);

  section('generateNewgens — empty/zero counts are safe');
  assert(generateNewgens(0, createRng(1)).length === 0, 'count 0 → empty array');
  assert(generateNewgens(-5, createRng(1)).length === 0, 'negative count → empty array');
}
