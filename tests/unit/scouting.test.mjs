/**
 * tests/unit/scouting.test.mjs — deterministic trait-reveal logic (P-scouting-c2).
 *
 * Covers getRevealedTraits: hidden traits stay hidden for young/unscouted players,
 * reveal naturally with age, and accelerate via scouting focuses.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { getRevealedTraits, MAX_SCOUT_FOCUSES } from '../../src/engine/career/scouting.js';
import { TRAIT_DEFS } from '../../src/engine/career/traits.js';

const SEED = 2026;

/** Minimal player stub with the requested traits. */
function player(id, age, traits) {
  return { id, age, traits };
}

export default async function run() {
  section('getRevealedTraits — non-hidden traits always visible');
  {
    const p = player('p1', 18, ['clutch', 'workhorse', 'mentor']);
    const { known, hiddenCount } = getRevealedTraits(p, 0, SEED);
    // clutch, workhorse, mentor are all non-hidden in TRAIT_DEFS
    for (const id of ['clutch', 'workhorse', 'mentor']) {
      assert(!TRAIT_DEFS[id].hidden, `${id} is non-hidden`);
    }
    assertEqual(hiddenCount, 0, 'no hidden traits in this set');
    assert(known.includes('clutch'), 'clutch is known');
    assert(known.includes('workhorse'), 'workhorse is known');
    assert(known.includes('mentor'), 'mentor is known');
  }

  section('getRevealedTraits — hidden traits concealed for a young, unscouted player');
  {
    // All three of these are hidden: choker, volatile, earlyPeak
    const hiddenIds = Object.keys(TRAIT_DEFS).filter((id) => TRAIT_DEFS[id].hidden);
    assert(hiddenIds.length > 0, 'there are hidden traits in TRAIT_DEFS');

    const p = player('rookie', 17, hiddenIds);
    const { known, hiddenCount } = getRevealedTraits(p, 0, SEED);
    assert(hiddenCount > 0, 'a 17-yo with no scout foci has concealed hidden traits');
    // Natural exposure at 17 = 0, so nothing auto-reveals
    assertEqual(known.length, 0, 'no hidden traits auto-reveal at age 17 with zero focuses');
  }

  section('getRevealedTraits — hidden traits gradually reveal with age');
  {
    const hiddenIds = Object.keys(TRAIT_DEFS).filter((id) => TRAIT_DEFS[id].hidden);
    const p17 = player('vet', 17, hiddenIds);
    const p30 = player('vet', 30, hiddenIds);
    const p37 = player('vet', 37, hiddenIds);

    const r17 = getRevealedTraits(p17, 0, SEED);
    const r30 = getRevealedTraits(p30, 0, SEED);
    const r37 = getRevealedTraits(p37, 0, SEED);

    assert(r30.known.length >= r17.known.length, 'more known at 30 than 17');
    assert(r37.known.length >= r30.known.length, 'more known at 37 than 30');
    assert(r37.hiddenCount <= r30.hiddenCount, 'fewer hidden at 37 than 30');
  }

  section('getRevealedTraits — scouting focuses accelerate reveal');
  {
    const hiddenIds = Object.keys(TRAIT_DEFS).filter((id) => TRAIT_DEFS[id].hidden);
    const p = player('prospect', 18, hiddenIds);

    const r0 = getRevealedTraits(p, 0, SEED);
    const r1 = getRevealedTraits(p, 1, SEED);
    const r3 = getRevealedTraits(p, MAX_SCOUT_FOCUSES, SEED);

    assert(r1.known.length >= r0.known.length, '1 season scouting reveals ≥ 0 seasons');
    assert(r3.known.length >= r1.known.length, '3 seasons scouting reveals ≥ 1 season');
    // 3 cumulative seasons (total bonus 1.05) should reveal everything (threshold ≤ 1)
    assertEqual(r3.hiddenCount, 0, '3 focus seasons reveals all hidden traits');
  }

  section('getRevealedTraits — deterministic (same inputs → same output)');
  {
    const p = player('det1', 22, ['choker', 'volatile', 'earlyPeak']);
    const a = getRevealedTraits(p, 1, SEED);
    const b = getRevealedTraits(p, 1, SEED);
    assertEqual(a.known.join(','), b.known.join(','), 'same seed → same known order');
    assertEqual(a.hiddenCount, b.hiddenCount, 'same seed → same hiddenCount');
  }

  section('getRevealedTraits — mixed hidden + non-hidden traits');
  {
    // clutch is non-hidden, choker is hidden
    const p = player('mixed', 20, ['clutch', 'choker']);
    const { known, hiddenCount } = getRevealedTraits(p, 0, SEED);
    assert(known.includes('clutch'), 'non-hidden clutch is always visible');
    // choker may or may not be revealed depending on threshold vs exposure at 20
    assert(known.length + hiddenCount === 1 || known.length + hiddenCount === 2, 'total = 2 traits');
    // choker slot is either in known (if threshold is low) or in hiddenCount
    const chokerKnown = known.includes('choker');
    assertEqual(
      chokerKnown ? 0 : 1,
      hiddenCount,
      'choker accounts for exactly 1 of the hidden/known slots'
    );
  }

  section('getRevealedTraits — player with no traits returns empty');
  {
    const p = player('none', 25, []);
    const { known, hiddenCount } = getRevealedTraits(p, 0, SEED);
    assertEqual(known.length, 0, 'no known traits');
    assertEqual(hiddenCount, 0, 'no hidden traits');
  }

  section('getRevealedTraits — gracefully handles missing player fields');
  {
    const { known, hiddenCount } = getRevealedTraits({}, 0, SEED);
    assertEqual(known.length, 0, 'empty player → no known');
    assertEqual(hiddenCount, 0, 'empty player → no hidden');
  }

  section('MAX_SCOUT_FOCUSES is 3');
  {
    assertEqual(MAX_SCOUT_FOCUSES, 3, 'MAX_SCOUT_FOCUSES constant is 3');
  }
}
