/**
 * tests/unit/cpLedger.test.mjs — cumulative CP ledger (CONTRACTS-SEASON §5).
 *
 * Asserts against synthetic EventResults:
 *  - createLedger: empty, frozen.
 *  - applyCP: adds awards to totals, pushes history, immutable (input untouched);
 *    totals == sum of per-event awardCP across applied events.
 *  - cpStandings: sorted by CP desc, teamId tiebreak; frozen.
 *
 * Deterministic, no randomness. Default export is an async fn that throws on
 * failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { CP_TABLE } from '../../src/config/cpTable.js';
import {
  awardCP,
  createLedger,
  applyCP,
  cpStandings
} from '../../src/engine/career/championshipPoints.js';

/**
 * Synthetic EventResult of `n` teams placed at ranks 1..n.
 * @param {string} type
 * @param {string[]} teamIds  index 0 == rank 1
 * @returns {{type:string, placements:Array<{rank:number, teamId:string}>}}
 */
function result(type, teamIds) {
  return {
    type,
    placements: teamIds.map((teamId, i) => ({ rank: i + 1, teamId }))
  };
}

export default async function cpLedgerTest() {
  section('engine/career CP ledger');

  // --- createLedger: empty + frozen -----------------------------------------
  {
    const l = createLedger();
    assertEqual(l.totals, {}, 'empty totals');
    assertEqual(l.history, [], 'empty history');
    assert(Object.isFrozen(l), 'ledger frozen');
    assert(Object.isFrozen(l.totals), 'totals frozen');
    assert(Object.isFrozen(l.history), 'history frozen');
  }

  // --- applyCP: immutable, adds awards, pushes history ----------------------
  {
    const l0 = createLedger();
    // Kickoff: A=4, B=3, C=2, D=1, rest 0.
    const kickoff = result('kickoff', ['A', 'B', 'C', 'D', 'E']);
    const snapshot = JSON.stringify({ totals: l0.totals, history: l0.history });

    const l1 = applyCP(l0, 'kickoff-pacific', 'pacific', kickoff, CP_TABLE);

    // input ledger untouched
    assertEqual(
      JSON.stringify({ totals: l0.totals, history: l0.history }),
      snapshot,
      'applyCP does not mutate input ledger'
    );
    assert(l1 !== l0, 'applyCP returns a new ledger');
    assert(Object.isFrozen(l1) && Object.isFrozen(l1.totals), 'new ledger frozen');

    assertEqual(l1.totals.A, 4, 'A totals 4');
    assertEqual(l1.totals.D, 1, 'D totals 1');
    assertEqual(l1.totals.E, 0, 'E totals 0');
    assertEqual(l1.history.length, 1, 'one history entry');
    assertEqual(l1.history[0].eventId, 'kickoff-pacific', 'history eventId');
    assertEqual(l1.history[0].region, 'pacific', 'history region tag');
    assertEqual(l1.history[0].awards, awardCP(kickoff, CP_TABLE), 'history awards match awardCP');
  }

  // --- applyCP accumulates across events; totals == sum of awardCP ----------
  {
    const events = [
      { id: 'kickoff-pacific', region: 'pacific', res: result('kickoff', ['A', 'B', 'C', 'D']) },
      // Stage: 5/4/3/2/1
      { id: 'stage1-pacific', region: 'pacific', res: result('stage', ['B', 'A', 'C', 'E', 'D']) },
      // Masters: 8..1; international (region null)
      { id: 'm0', region: null, res: result('masters', ['A', 'C', 'F', 'B', 'G', 'H', 'D', 'E']) },
      // Champions awards none
      { id: 'champions', region: null, res: result('champions', ['A', 'B', 'C', 'D']) }
    ];

    let ledger = createLedger();
    /** @type {Record<string, number>} */
    const expected = {};
    for (const ev of events) {
      const awards = awardCP(ev.res, CP_TABLE);
      for (const t of Object.keys(awards)) expected[t] = (expected[t] || 0) + awards[t];
      ledger = applyCP(ledger, ev.id, ev.region, ev.res, CP_TABLE);
    }

    // totals exactly equal independently summed awardCP
    for (const t of Object.keys(expected)) {
      assertEqual(ledger.totals[t], expected[t], `totals[${t}] == sum of awardCP`);
    }
    assertEqual(
      Object.keys(ledger.totals).sort(),
      Object.keys(expected).sort(),
      'totals key set == awarded teams'
    );

    // Champions contributed nothing: A's total is kickoff(4)+stage(4)+masters(8)=16
    assertEqual(ledger.totals.A, 16, 'A cumulative across kickoff+stage+masters, champions 0');
    assertEqual(ledger.history.length, 4, 'four history entries in apply order');

    // No NaN / negatives.
    for (const t of Object.keys(ledger.totals)) {
      assert(Number.isFinite(ledger.totals[t]) && ledger.totals[t] >= 0, `totals[${t}] finite >= 0`);
    }

    // --- cpStandings: sorted desc, teamId tiebreak --------------------------
    const standings = cpStandings(ledger);
    assert(Object.isFrozen(standings), 'standings frozen');
    // Descending by cp
    for (let i = 1; i < standings.length; i++) {
      assert(standings[i - 1].cp >= standings[i].cp, 'standings cp descending');
      if (standings[i - 1].cp === standings[i].cp) {
        assert(standings[i - 1].teamId < standings[i].teamId, 'equal cp -> teamId ascending');
      }
    }
    assertEqual(standings[0].teamId, 'A', 'A leads standings');
    assertEqual(standings[0].cp, 16, 'A standings cp 16');
    assertEqual(standings.length, Object.keys(ledger.totals).length, 'standings covers all teams');
  }
}
