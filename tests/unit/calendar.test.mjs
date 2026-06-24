/**
 * tests/unit/calendar.test.mjs — CALENDAR shape (CONTRACTS-SEASON §2).
 *
 * Asserts the 8-slot calendar matches the binding spec exactly: order, types,
 * scopes, formatIds, the masters feeds (m0<-kickoff, m1<-stage1, m2<-stage2),
 * m2 as the final Masters, stage3 as a CP-only regional stage, champions last,
 * contiguous 0-based indices, and immutability.
 *
 * Deterministic, no randomness. Default export is an async fn that throws on
 * failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { CALENDAR } from '../../src/engine/career/calendar.js';

export default async function run() {
  section('calendar / shape');

  assert(Array.isArray(CALENDAR), 'CALENDAR is an array');
  assertEqual(CALENDAR.length, 8, 'CALENDAR has exactly 8 slots');

  /** Expected slots, in order (CONTRACTS-SEASON §2). */
  const expected = [
    { id: 'kickoff', type: 'kickoff', scope: 'regional', formatId: 'kickoff' },
    { id: 'm0', type: 'masters', scope: 'international', formatId: 'masters', feedsFrom: 'kickoff' },
    { id: 'stage1', type: 'stage', scope: 'regional', formatId: 'stage' },
    { id: 'm1', type: 'masters', scope: 'international', formatId: 'masters', feedsFrom: 'stage1' },
    { id: 'stage2', type: 'stage', scope: 'regional', formatId: 'stage' },
    { id: 'm2', type: 'masters', scope: 'international', formatId: 'masters', feedsFrom: 'stage2', finalMasters: true },
    { id: 'stage3', type: 'stage', scope: 'regional', formatId: 'stage' },
    { id: 'champions', type: 'champions', scope: 'international', formatId: 'champions' }
  ];

  CALENDAR.forEach((slot, i) => {
    const e = expected[i];
    assertEqual(slot.id, e.id, `slot ${i} id`);
    assertEqual(slot.type, e.type, `slot ${slot.id} type`);
    assertEqual(slot.scope, e.scope, `slot ${slot.id} scope`);
    assertEqual(slot.formatId, e.formatId, `slot ${slot.id} formatId`);
    assertEqual(slot.index, i, `slot ${slot.id} index is its position`);
    if (e.feedsFrom) {
      assertEqual(slot.feedsFrom, e.feedsFrom, `slot ${slot.id} feedsFrom`);
    } else {
      assert(slot.feedsFrom === undefined, `slot ${slot.id} has no feedsFrom`);
    }
    if (e.finalMasters) {
      assertEqual(slot.finalMasters, true, `slot ${slot.id} is finalMasters`);
    } else {
      assert(slot.finalMasters === undefined, `slot ${slot.id} is not finalMasters`);
    }
  });

  section('calendar / composition counts');

  const regional = CALENDAR.filter((s) => s.scope === 'regional');
  const international = CALENDAR.filter((s) => s.scope === 'international');
  assertEqual(regional.length, 4, '4 regional slots (kickoff, stage1, stage2, stage3)');
  assertEqual(international.length, 4, '4 international slots (m0, m1, m2, champions)');

  const masters = CALENDAR.filter((s) => s.type === 'masters');
  assertEqual(masters.length, 3, 'exactly 3 Masters');
  assertEqual(masters.filter((s) => s.finalMasters).length, 1, 'exactly one final Masters');
  assertEqual(
    CALENDAR.filter((s) => s.type === 'champions').length,
    1,
    'exactly one Champions'
  );

  // Champions is last; every masters feedsFrom an earlier regional slot.
  assertEqual(CALENDAR[CALENDAR.length - 1].type, 'champions', 'Champions is the last slot');
  for (const m of masters) {
    const feeder = CALENDAR.find((s) => s.id === m.feedsFrom);
    assert(feeder && feeder.scope === 'regional', `${m.id} feedsFrom a regional slot`);
    assert(feeder.index < m.index, `${m.id} feeder runs before it`);
  }

  section('calendar / immutability');

  assert(Object.isFrozen(CALENDAR), 'CALENDAR is frozen');
  for (const slot of CALENDAR) assert(Object.isFrozen(slot), `slot ${slot.id} is frozen`);
}
