/**
 * tests/unit/championshipPoints.test.mjs — career glue (CONTRACTS-FORMAT §7).
 *
 * Asserts against a small synthetic Kickoff EventResult:
 *  - awardCP: placements 1-4 -> 4/3/2/1; placements 5-12 -> 0; ranks beyond the
 *    table award 0; result keyed by teamId, immutable.
 *  - kickoffQualifiers: exactly 3, placement 1 -> masters-playoff, 2 & 3 ->
 *    masters-swiss.
 *
 * Deterministic, no randomness. Default export is an async fn that throws on
 * failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { CP_TABLE } from '../../src/config/cpTable.js';
import { awardCP } from '../../src/engine/career/championshipPoints.js';
import { kickoffQualifiers } from '../../src/engine/career/qualification.js';

/**
 * Synthetic 12-team Kickoff EventResult. Team ids are `T01`..`T12`, placed at
 * ranks 1..12 in order.
 * @returns {{type:string, placements:Array<{rank:number, teamId:string}>}}
 */
function kickoffResult() {
  const placements = [];
  for (let rank = 1; rank <= 12; rank++) {
    placements.push({ rank, teamId: `T${String(rank).padStart(2, '0')}` });
  }
  return { type: 'kickoff', placements };
}

export default async function championshipPointsTest() {
  section('engine/career championshipPoints + qualification');

  // --- awardCP: Kickoff 4/3/2/1 to top 4, 0 below ---------------------------
  {
    const result = kickoffResult();
    const cp = awardCP(result, CP_TABLE);

    assertEqual(cp.T01, 4, 'placement 1 -> 4 CP');
    assertEqual(cp.T02, 3, 'placement 2 -> 3 CP');
    assertEqual(cp.T03, 2, 'placement 3 -> 2 CP');
    assertEqual(cp.T04, 1, 'placement 4 -> 1 CP');

    for (let rank = 5; rank <= 12; rank++) {
      const id = `T${String(rank).padStart(2, '0')}`;
      assertEqual(cp[id], 0, `placement ${rank} -> 0 CP`);
    }

    // Every placed team appears exactly once.
    assertEqual(Object.keys(cp).length, 12, 'one CP entry per placed team');

    // Immutable output.
    assert(Object.isFrozen(cp), 'awardCP output is frozen');
  }

  // --- awardCP: ranks beyond the table award 0 ------------------------------
  {
    const cp = awardCP(
      { type: 'kickoff', placements: [{ rank: 99, teamId: 'GHOST' }] },
      CP_TABLE
    );
    assertEqual(cp.GHOST, 0, 'rank beyond table -> 0 CP');
  }

  // --- awardCP: input not mutated -------------------------------------------
  {
    const result = kickoffResult();
    const snapshot = JSON.stringify(result);
    awardCP(result, CP_TABLE);
    assertEqual(JSON.stringify(result), snapshot, 'eventResult not mutated');
  }

  // --- kickoffQualifiers: exactly 3, correct seedInto -----------------------
  {
    const result = kickoffResult();
    const quals = kickoffQualifiers(result);

    assertEqual(quals.length, 3, 'exactly 3 kickoff qualifiers');
    assertEqual(
      quals,
      [
        { teamId: 'T01', seedInto: 'masters-playoff' },
        { teamId: 'T02', seedInto: 'masters-swiss' },
        { teamId: 'T03', seedInto: 'masters-swiss' }
      ],
      'placement 1 -> masters-playoff; 2 & 3 -> masters-swiss'
    );

    assert(Object.isFrozen(quals), 'qualifiers output is frozen');
  }
}
