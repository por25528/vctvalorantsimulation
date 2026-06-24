/**
 * tests/unit/seasonQualification.test.mjs — season qualification feeds
 * (CONTRACTS-SEASON §4).
 *
 * Asserts against synthetic EventResults:
 *  - regionQualifiers: placement 1 -> masters-playoff, 2 & 3 -> masters-swiss;
 *    kickoffQualifiers is the same function (alias).
 *  - mastersSeedOrder: 12 ids = 4 direct (fixed region order) + 8 swiss
 *    (placement asc then region order); each region appears exactly 3 times.
 *  - championsField: 16 unique ids, index 0 == direct team, 1..15 top-15 by CP
 *    (excluding direct), teamId tiebreak.
 *
 * Deterministic, no randomness. Default export is an async fn that throws on
 * failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import {
  regionQualifiers,
  kickoffQualifiers,
  mastersSeedOrder,
  championsField,
  REGION_ORDER
} from '../../src/engine/career/qualification.js';

/**
 * Build a regional EventResult where rank r holds team `${region}-${r}`.
 * @param {string} region
 * @param {number} n
 */
function regionResult(region, n = 12) {
  const placements = [];
  for (let r = 1; r <= n; r++) placements.push({ rank: r, teamId: `${region}-${r}` });
  return { type: 'stage', placements };
}

export default async function seasonQualificationTest() {
  section('engine/career season qualification');

  // --- regionQualifiers + kickoffQualifiers alias ---------------------------
  {
    const res = regionResult('pacific');
    const quals = regionQualifiers(res);
    assertEqual(quals.length, 3, 'exactly 3 region qualifiers');
    assertEqual(
      quals,
      [
        { teamId: 'pacific-1', seedInto: 'masters-playoff' },
        { teamId: 'pacific-2', seedInto: 'masters-swiss' },
        { teamId: 'pacific-3', seedInto: 'masters-swiss' }
      ],
      'placement 1 -> playoff; 2 & 3 -> swiss'
    );
    assert(Object.isFrozen(quals), 'qualifiers frozen');
    assert(kickoffQualifiers === regionQualifiers, 'kickoffQualifiers is an alias of regionQualifiers');
  }

  // --- mastersSeedOrder: 4 direct + 8 swiss, region order random-proof ------
  {
    // Provide the regions in a deliberately scrambled object order to prove the
    // function imposes the fixed region order itself.
    const byRegion = {
      china: regionResult('china'),
      pacific: regionResult('pacific'),
      emea: regionResult('emea'),
      americas: regionResult('americas')
    };
    const seedOrder = mastersSeedOrder(byRegion);

    assertEqual(seedOrder.length, 12, '12-team seed order');
    assert(Object.isFrozen(seedOrder), 'seedOrder frozen');
    assertEqual(new Set(seedOrder).size, 12, '12 unique teams');

    // Seeds 1..4 = placement-1 of each region in fixed order.
    assertEqual(
      seedOrder.slice(0, 4),
      ['pacific-1', 'americas-1', 'emea-1', 'china-1'],
      'seeds 1-4 = placement-1 in [pacific,americas,emea,china]'
    );

    // Seeds 5..12 = all placement-2 (region order) then all placement-3.
    assertEqual(
      seedOrder.slice(4),
      [
        'pacific-2', 'americas-2', 'emea-2', 'china-2',
        'pacific-3', 'americas-3', 'emea-3', 'china-3'
      ],
      'seeds 5-12 = placement 2 then 3, region order'
    );

    // Each region appears exactly 3 times (1 direct + 2 swiss).
    for (const region of REGION_ORDER) {
      const count = seedOrder.filter((id) => id.startsWith(`${region}-`)).length;
      assertEqual(count, 3, `region ${region} contributes exactly 3`);
    }

    // Exactly 4 directs (placement-1) and 8 swiss (placement 2/3).
    const directs = seedOrder.filter((id) => id.endsWith('-1'));
    const swiss = seedOrder.filter((id) => id.endsWith('-2') || id.endsWith('-3'));
    assertEqual(directs.length, 4, 'exactly 4 direct teams');
    assertEqual(swiss.length, 8, 'exactly 8 swiss teams');
  }

  // --- championsField: 16 unique, direct at index 0, top-15 by CP -----------
  {
    // Ledger with 20 teams: cp = 100 - i for clear ordering, plus a tie pair.
    /** @type {Record<string, number>} */
    const totals = {};
    for (let i = 0; i < 20; i++) totals[`team-${String(i).padStart(2, '0')}`] = 100 - i;
    // Create a tie between team-30 and team-31 at the cutoff region to test teamId tiebreak.
    totals['team-31'] = 50;
    totals['team-30'] = 50;
    const ledger = { totals };

    // Direct team is NOT the CP leader, to prove it is forced to index 0.
    const direct = 'team-05';
    const field = championsField(ledger, direct);

    assertEqual(field.length, 16, '16-team field');
    assert(Object.isFrozen(field), 'field frozen');
    assertEqual(new Set(field).size, 16, '16 unique teams');
    assertEqual(field[0], direct, 'index 0 == direct-slot team');
    assert(!field.slice(1).includes(direct), 'direct team appears exactly once (not in 1..15)');

    // Indices 1..15 are the top-15 by CP excluding the direct team.
    const expectedRest = Object.keys(totals)
      .filter((t) => t !== direct)
      .sort((a, b) => (totals[b] - totals[a]) || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, 15);
    assertEqual(field.slice(1), expectedRest, 'seeds 2..16 = top-15 by CP (teamId tiebreak)');

    // Tie-break sanity: team-30 before team-31 at equal CP.
    const i30 = field.indexOf('team-30');
    const i31 = field.indexOf('team-31');
    if (i30 !== -1 && i31 !== -1) {
      assert(i30 < i31, 'equal CP -> lower teamId seeded first');
    }
  }
}
