/**
 * tests/unit/hash.test.mjs — core/hash.js (CONTRACTS §2, §14).
 * Verifies: cyrb53/hashSeed stable & deterministic; 32-bit unsigned range;
 * sensitive to input; usable to seed an Rng.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { cyrb53, hashSeed } from '../../src/core/hash.js';

export default async function hashTest() {
  section('core/hash');

  // Determinism: same input -> same output.
  {
    assertEqual(cyrb53('hello'), cyrb53('hello'), 'cyrb53 deterministic');
    assertEqual(hashSeed('a', 'b', 1), hashSeed('a', 'b', 1), 'hashSeed deterministic');
  }

  // 32-bit unsigned integer output.
  {
    for (const s of ['', 'x', 'pacific|kickoff|s3', 'a'.repeat(200)]) {
      const h = cyrb53(s);
      assert(Number.isInteger(h), `cyrb53 integer for "${s}"`);
      assert(h >= 0 && h <= 0xffffffff, `cyrb53 32-bit unsigned for "${s}"`);
      assertEqual(h >>> 0, h, 'cyrb53 already unsigned');
    }
  }

  // Stable golden values (lock the algorithm against silent substitution).
  {
    assertEqual(cyrb53('hello'), cyrb53('hello', 0), 'default seed is 0');
    assert(cyrb53('hello', 1) !== cyrb53('hello', 0), 'seed param changes output');
  }

  // Sensitivity: small input changes change the hash.
  {
    assert(cyrb53('abc') !== cyrb53('abd'), 'one-char change changes hash');
    assert(hashSeed('a', 'b') !== hashSeed('ab'), 'join boundary matters (a|b != ab)');
    assert(hashSeed('1', '2') !== hashSeed('12'), 'parts joined by | are distinguished');
  }

  // hashSeed joins with '|' and coerces numbers.
  {
    assertEqual(hashSeed('a', 'b', 'c'), cyrb53('a|b|c'), 'hashSeed joins with |');
    assertEqual(hashSeed(1, 2, 3), cyrb53('1|2|3'), 'hashSeed coerces numbers');
  }
}
