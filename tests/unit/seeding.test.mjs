/**
 * tests/unit/seeding.test.mjs — engine/format/seeding.js (CONTRACTS-FORMAT §2).
 * Verifies: resolveEntrants maps seeds/placements/advancers; crossSeed ordering;
 * bracketPairing8 / bracketPairing6 pairings; drawSeedOrder is a deterministic
 * permutation for a given seeded rng.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import {
  resolveEntrants,
  crossSeed,
  bracketPairing8,
  bracketPairing6,
  drawSeedOrder
} from '../../src/engine/format/seeding.js';
import { createRng } from '../../src/core/rng.js';

export default async function seedingTest() {
  section('engine/format/seeding');

  // --- resolveEntrants: { from:'seed' } maps via ctx.seedOrder ---
  {
    const ctx = { seedOrder: ['t1', 't2', 't3', 't4', 't5', 't6'] };
    const stage = {
      entrants: [
        { from: 'seed', seed: 1 },
        { from: 'seed', seed: 4 },
        { from: 'seed', seed: 5 },
        { from: 'seed', seed: 6 }
      ]
    };
    assertEqual(
      resolveEntrants(stage, ctx, {}),
      ['t1', 't4', 't5', 't6'],
      'resolveEntrants maps seeds to ctx.seedOrder (1-based)'
    );
  }

  // --- resolveEntrants: numeric placement slot from a prior stage's standings ---
  {
    const priorStages = {
      groupA: {
        stageId: 'groupA',
        kind: 'gsl',
        standings: [
          { teamId: 'tA1', rank: 1 },
          { teamId: 'tA2', rank: 2 },
          { teamId: 'tA3', rank: 3 },
          { teamId: 'tA4', rank: 4 }
        ],
        advancers: ['tA1', 'tA2', 'tA3', 'tA4']
      }
    };
    const stage = {
      entrants: [
        { from: 'groupA', slot: '1' },
        { from: 'groupA', slot: '3' }
      ]
    };
    assertEqual(
      resolveEntrants(stage, { seedOrder: [] }, priorStages),
      ['tA1', 'tA3'],
      'resolveEntrants maps numeric placement slot to standings rank'
    );
  }

  // --- resolveEntrants: 'advance:k' slot from a prior stage's advancers ---
  {
    const priorStages = {
      groupB: {
        stageId: 'groupB',
        kind: 'gsl',
        standings: [],
        advancers: ['tB1', 'tB2', 'tB3', 'tB4']
      }
    };
    const stage = {
      entrants: [
        { from: 'groupB', slot: 'advance:1' },
        { from: 'groupB', slot: 'advance:4' }
      ]
    };
    assertEqual(
      resolveEntrants(stage, { seedOrder: [] }, priorStages),
      ['tB1', 'tB4'],
      "resolveEntrants maps 'advance:k' to advancers[k-1]"
    );
  }

  // --- resolveEntrants: out-of-range / missing references throw ---
  {
    let threw = false;
    try {
      resolveEntrants({ entrants: [{ from: 'seed', seed: 9 }] }, { seedOrder: ['a', 'b'] }, {});
    } catch {
      threw = true;
    }
    assert(threw, 'resolveEntrants throws on out-of-range seed');

    threw = false;
    try {
      resolveEntrants({ entrants: [{ from: 'nope', slot: '1' }] }, { seedOrder: [] }, {});
    } catch {
      threw = true;
    }
    assert(threw, 'resolveEntrants throws on missing prior stage');
  }

  // --- crossSeed: [A1,B1,A2,B2,A3,B3,A4,B4] ---
  {
    const a = ['a1', 'a2', 'a3', 'a4'];
    const b = ['b1', 'b2', 'b3', 'b4'];
    assertEqual(
      crossSeed(a, b),
      ['a1', 'b1', 'a2', 'b2', 'a3', 'b3', 'a4', 'b4'],
      'crossSeed interleaves group A and B in placement order'
    );
    let threw = false;
    try {
      crossSeed(['x'], b);
    } catch {
      threw = true;
    }
    assert(threw, 'crossSeed requires 4-team groups');
  }

  // --- bracketPairing8: [[1,8],[4,5],[3,6],[2,7]] ---
  {
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    assertEqual(
      bracketPairing8(seeds),
      [
        ['s1', 's8'],
        ['s4', 's5'],
        ['s3', 's6'],
        ['s2', 's7']
      ],
      'bracketPairing8 produces the fixed first-round pairings'
    );
    // every team appears exactly once across pairings
    const flat = bracketPairing8(seeds).flat();
    assertEqual(new Set(flat).size, 8, 'bracketPairing8 uses each seed once');
  }

  // --- bracketPairing6: M1=s3 vs s6, M2=s4 vs s5 (seeds 1,2 bye) ---
  {
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6'];
    assertEqual(
      bracketPairing6(seeds),
      [
        ['s3', 's6'],
        ['s4', 's5']
      ],
      'bracketPairing6 produces gsl6 opening pairings (seeds 1,2 bye)'
    );
    const involved = bracketPairing6(seeds).flat();
    assert(!involved.includes('s1') && !involved.includes('s2'), 'seeds 1 & 2 have byes');
  }

  // --- drawSeedOrder: deterministic for a seed, is a permutation, no mutation ---
  {
    const teams = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12'];

    const d1 = drawSeedOrder(teams, createRng(424242));
    const d2 = drawSeedOrder(teams, createRng(424242));
    assertEqual(d1, d2, 'drawSeedOrder is deterministic for a given seed');

    const d3 = drawSeedOrder(teams, createRng(999999));
    assert(JSON.stringify(d1) !== JSON.stringify(d3), 'different seed -> different draw (overwhelmingly likely)');

    // permutation: same multiset
    assertEqual([...d1].sort(), [...teams].sort(), 'drawSeedOrder is a permutation of input');

    // no mutation of input
    assertEqual(
      teams,
      ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12'],
      'drawSeedOrder does not mutate its input'
    );
  }
}
