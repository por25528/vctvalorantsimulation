/**
 * tests/unit/produce.test.mjs — core/produce.js (CONTRACTS §4, §14).
 * Verifies: input is never mutated; produce applies recipe / replacement;
 * set deep-updates immutably and shares untouched branches.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { produce, set } from '../../src/core/produce.js';

export default async function produceTest() {
  section('core/produce');

  // produce: recipe mutates draft; original untouched.
  {
    const input = { a: 1, b: { c: 2 } };
    const snapshot = JSON.stringify(input);
    const out = produce(input, (d) => { d.a = 99; });
    assertEqual(out.a, 99, 'produce applied change');
    assertEqual(input.a, 1, 'produce did not mutate input.a');
    assertEqual(JSON.stringify(input), snapshot, 'input never mutated');
    assert(out !== input, 'produce returns a new object');
  }

  // produce: recipe returning a replacement object wins.
  {
    const input = { x: 1 };
    const out = produce(input, () => ({ y: 2 }));
    assertEqual(out, { y: 2 }, 'produce honors returned replacement');
    assertEqual(input, { x: 1 }, 'input untouched on replacement');
  }

  // produce: arrays clone as arrays.
  {
    const input = [1, 2, 3];
    const out = produce(input, (d) => { d.push(4); });
    assert(Array.isArray(out), 'array stays array');
    assertEqual(out, [1, 2, 3, 4], 'array recipe applied');
    assertEqual(input, [1, 2, 3], 'array input untouched');
  }

  // set: immutable deep update; untouched branches shared by reference.
  {
    const input = { a: { b: { c: 1 } }, d: { e: 5 } };
    const out = set(input, ['a', 'b', 'c'], 42);
    assertEqual(out.a.b.c, 42, 'set updated nested value');
    assertEqual(input.a.b.c, 1, 'set did not mutate input');
    assert(out !== input, 'set returns new root');
    assert(out.a !== input.a, 'changed branch cloned');
    assert(out.d === input.d, 'untouched branch shared');
  }

  // set: array path index update.
  {
    const input = { list: [{ v: 1 }, { v: 2 }] };
    const out = set(input, ['list', 1, 'v'], 9);
    assertEqual(out.list[1].v, 9, 'set updated array element');
    assertEqual(input.list[1].v, 2, 'input array untouched');
    assert(out.list[0] === input.list[0], 'sibling element shared');
  }

  // set: empty path replaces whole value.
  {
    assertEqual(set({ a: 1 }, [], { b: 2 }), { b: 2 }, 'empty path replaces root');
  }

  // set: builds missing intermediate objects without mutating input.
  {
    const input = { a: 1 };
    const out = set(input, ['nested', 'deep'], 7);
    assertEqual(out.nested.deep, 7, 'set creates missing path');
    assertEqual(input, { a: 1 }, 'input untouched when creating path');
  }
}
