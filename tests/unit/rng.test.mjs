/**
 * tests/unit/rng.test.mjs — core/rng.js (CONTRACTS §1, §14).
 * Verifies: same seed -> identical sequence; helpers stay in range;
 * weightedPick respects weights statistically; gaussian mean/stdev sane.
 */

import { assert, assertEqual, assertClose, section } from '../_assert.mjs';
import { mulberry32, createRng } from '../../src/core/rng.js';

export default async function rngTest() {
  section('core/rng');

  // mulberry32 raw determinism + [0,1) range.
  {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    assertEqual(seqA, seqB, 'mulberry32 same seed -> same sequence');
    for (const v of seqA) assert(v >= 0 && v < 1, 'mulberry32 in [0,1)');
  }

  // createRng: same seed -> identical next() sequence.
  {
    const r1 = createRng(987654);
    const r2 = createRng(987654);
    const s1 = Array.from({ length: 100 }, () => r1.next());
    const s2 = Array.from({ length: 100 }, () => r2.next());
    assertEqual(s1, s2, 'createRng same seed -> identical sequence');

    const r3 = createRng(987655);
    const s3 = Array.from({ length: 100 }, () => r3.next());
    assert(JSON.stringify(s1) !== JSON.stringify(s3), 'different seed -> different sequence');
  }

  // Same seed -> identical helper outputs (fixed consumption order).
  {
    const draw = (seed) => {
      const r = createRng(seed);
      return [
        r.next(), r.int(10), r.range(5, 8), r.chance(0.5),
        r.pick(['x', 'y', 'z']), r.gaussian(0, 1)
      ];
    };
    assertEqual(draw(42), draw(42), 'mixed helper draws reproducible by seed');
  }

  // int(max) in [0,max); range(min,max) in [min,max].
  {
    const r = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const n = r.int(6);
      assert(Number.isInteger(n) && n >= 0 && n < 6, `int out of range: ${n}`);
      const rg = r.range(3, 9);
      assert(Number.isInteger(rg) && rg >= 3 && rg <= 9, `range out of range: ${rg}`);
    }
  }

  // range hits both endpoints over many draws.
  {
    const r = createRng(99);
    let lo = false, hi = false;
    for (let i = 0; i < 5000; i++) {
      const v = r.range(0, 2);
      if (v === 0) lo = true;
      if (v === 2) hi = true;
    }
    assert(lo && hi, 'range covers inclusive endpoints');
  }

  // chance(p) ~ p; chance(0) never, chance(1) always.
  {
    const r = createRng(2024);
    let hits = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (r.chance(0.3)) hits++;
    assertClose(hits / N, 0.3, 0.03, 'chance(0.3) frequency');
    const r0 = createRng(1);
    for (let i = 0; i < 1000; i++) assert(r0.chance(0) === false, 'chance(0) never true');
    const r1 = createRng(1);
    for (let i = 0; i < 1000; i++) assert(r1.chance(1) === true, 'chance(1) always true');
  }

  // pick returns only elements of the array, covers all.
  {
    const r = createRng(555);
    const arr = ['a', 'b', 'c', 'd'];
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const e = r.pick(arr);
      assert(arr.includes(e), 'pick element belongs to array');
      seen.add(e);
    }
    assertEqual(seen.size, 4, 'pick covers all elements');
  }

  // weightedPick respects weights statistically (~2:1 over the second item).
  {
    const r = createRng(31337);
    const items = [{ k: 'rare', w: 1 }, { k: 'common', w: 4 }];
    const counts = { rare: 0, common: 0 };
    const N = 40000;
    for (let i = 0; i < N; i++) counts[r.weightedPick(items, (it) => it.w).k]++;
    // expected ratio common:rare = 4:1 -> common frequency ~0.8
    assertClose(counts.common / N, 0.8, 0.02, 'weightedPick respects 4:1 weights');
    assertClose(counts.rare / N, 0.2, 0.02, 'weightedPick respects 1:4 weights');
  }

  // weightedPick: zero-weight items are never chosen.
  {
    const r = createRng(8);
    const items = ['no', 'yes'];
    for (let i = 0; i < 3000; i++) {
      const picked = r.weightedPick(items, (it) => (it === 'yes' ? 1 : 0));
      assertEqual(picked, 'yes', 'zero-weight item never picked');
    }
  }

  // gaussian: empirical mean/stdev near parameters.
  {
    const r = createRng(606);
    const N = 20000;
    let sum = 0;
    const vals = [];
    for (let i = 0; i < N; i++) {
      const g = r.gaussian(10, 2);
      vals.push(g);
      sum += g;
    }
    const mean = sum / N;
    assertClose(mean, 10, 0.1, 'gaussian mean ~10');
    let varSum = 0;
    for (const v of vals) varSum += (v - mean) ** 2;
    const stdev = Math.sqrt(varSum / N);
    assertClose(stdev, 2, 0.1, 'gaussian stdev ~2');
  }
}
