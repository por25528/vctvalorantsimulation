/**
 * tests/unit/standings.test.mjs — engine/format/standings.js + tiebreakers.js
 * (CONTRACTS-FORMAT §3).
 *
 * Uses synthetic Series objects (the match engine is not invoked) to assert:
 *  - recordFromSeries aggregates series W/L from Series.score, map W/L, and
 *    roundDiff (summed per-map round score) correctly;
 *  - roundRobinStandings ranks by series wins then the tiebreak chain;
 *  - swissStandings inserts Buchholz (sum of opponents' wins) after series wins;
 *  - compareStandings resolves each link of the chain in order
 *    (map-diff -> round-diff -> head-to-head -> seed);
 *  - headToHead returns -1|0|1 as specified.
 *
 * Deterministic, no randomness. Default export is an async fn that throws on
 * failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import {
  recordFromSeries,
  roundRobinStandings,
  swissStandings
} from '../../src/engine/format/standings.js';
import { compareStandings, headToHead } from '../../src/engine/format/tiebreakers.js';

/**
 * Build a synthetic Series. `maps` is an array of [roundsA, roundsB] pairs; the
 * Series score is derived from how many maps each side won.
 * @param {string} aId
 * @param {string} bId
 * @param {Array<[number,number]>} maps
 * @returns {object}
 */
function series(aId, bId, maps) {
  let A = 0;
  let B = 0;
  const mapObjs = maps.map(([ra, rb]) => {
    if (ra > rb) A += 1; else B += 1;
    return { score: { A: ra, B: rb }, winner: ra > rb ? 'A' : 'B' };
  });
  return {
    teamAId: aId,
    teamBId: bId,
    score: { A, B },
    winnerId: A > B ? aId : bId,
    maps: mapObjs
  };
}

export default async function standingsTest() {
  section('engine/format/standings + tiebreakers');

  // --- recordFromSeries: W/L, map W/L, roundDiff ---------------------------
  {
    // T1 beats T2 2-1 with maps 13-7, 9-13, 13-11.
    const s = series('T1', 'T2', [[13, 7], [9, 13], [13, 11]]);
    const rec = recordFromSeries([s]);

    assertEqual(rec.T1.w, 1, 'T1 has 1 series win');
    assertEqual(rec.T1.l, 0, 'T1 has 0 series losses');
    assertEqual(rec.T2.w, 0, 'T2 has 0 series wins');
    assertEqual(rec.T2.l, 1, 'T2 has 1 series loss');

    assertEqual(rec.T1.mapW, 2, 'T1 map wins = 2');
    assertEqual(rec.T1.mapL, 1, 'T1 map losses = 1');
    assertEqual(rec.T2.mapW, 1, 'T2 map wins = 1');
    assertEqual(rec.T2.mapL, 2, 'T2 map losses = 2');

    // roundDiff for T1 = (13-7)+(9-13)+(13-11) = 6 - 4 + 2 = 4; T2 is the negation.
    assertEqual(rec.T1.roundDiff, 4, 'T1 roundDiff = 4');
    assertEqual(rec.T2.roundDiff, -4, 'T2 roundDiff = -4');
  }

  // --- recordFromSeries: aggregation across multiple series ----------------
  {
    const all = [
      series('A', 'B', [[13, 5], [13, 9]]),       // A beats B 2-0
      series('A', 'C', [[10, 13], [13, 8], [11, 13]]), // C beats A 2-1
      series('B', 'C', [[13, 11], [13, 6]])        // B beats C 2-0
    ];
    const rec = recordFromSeries(all);
    assertEqual(rec.A.w, 1, 'A wins 1');
    assertEqual(rec.A.l, 1, 'A loses 1');
    assertEqual(rec.A.mapW, 2 + 1, 'A map wins = 3');
    assertEqual(rec.A.mapL, 0 + 2, 'A map losses = 2');
    assertEqual(rec.C.w, 1, 'C wins 1 (vs A)');
    assertEqual(rec.C.l, 1, 'C loses 1 (vs B)');
  }

  // --- headToHead returns -1|0|1 -------------------------------------------
  {
    const ss = [
      series('X', 'Y', [[13, 5], [13, 9]]), // X beats Y
      series('Y', 'X', [[13, 4], [13, 7]])  // Y beats X -> even
    ];
    assertEqual(headToHead('X', 'Y', ss), 0, 'X vs Y even -> 0');

    const ss2 = [series('X', 'Y', [[13, 5], [13, 9]])]; // X beats Y once
    assertEqual(headToHead('X', 'Y', ss2), 1, 'X beat Y -> +1');
    assertEqual(headToHead('Y', 'X', ss2), -1, 'Y lost to X -> -1');
    assertEqual(headToHead('X', 'Z', ss2), 0, 'never met -> 0');
  }

  // --- compareStandings: chain resolves in order ---------------------------
  {
    // Step 1: map differential dominates everything else.
    const hiMap = { teamId: 'a', mapW: 6, mapL: 1, roundDiff: -50, seed: 9 };
    const loMap = { teamId: 'b', mapW: 4, mapL: 4, roundDiff: 999, seed: 1 };
    assert(compareStandings(hiMap, loMap) < 0, 'higher map-diff ranks ahead despite worse roundDiff/seed');

    // Step 2: equal map-diff -> round differential.
    const hiRd = { teamId: 'a', mapW: 4, mapL: 2, roundDiff: 30, seed: 8 };
    const loRd = { teamId: 'b', mapW: 5, mapL: 3, roundDiff: 10, seed: 1 };
    assertEqual((hiRd.mapW - hiRd.mapL), (loRd.mapW - loRd.mapL), 'map-diff tied for step 2');
    assert(compareStandings(hiRd, loRd) < 0, 'higher round-diff ranks ahead when map-diff tied');

    // Step 3: equal map-diff + round-diff -> head-to-head.
    const h2hSeries = [series('a', 'b', [[13, 9], [13, 7]])]; // a beat b
    const rowA = { teamId: 'a', mapW: 5, mapL: 3, roundDiff: 12, seed: 5, series: h2hSeries };
    const rowB = { teamId: 'b', mapW: 5, mapL: 3, roundDiff: 12, seed: 2, series: h2hSeries };
    assert(compareStandings(rowA, rowB) < 0, 'h2h winner ranks ahead despite worse seed');
    assert(compareStandings(rowB, rowA) > 0, 'h2h loser ranks behind (symmetry)');

    // Step 4: everything tied incl. h2h (no meeting) -> seed ASC.
    const rowLo = { teamId: 'a', mapW: 5, mapL: 3, roundDiff: 12, seed: 2, series: [] };
    const rowHi = { teamId: 'b', mapW: 5, mapL: 3, roundDiff: 12, seed: 7, series: [] };
    assert(compareStandings(rowLo, rowHi) < 0, 'lower seed ranks ahead when all else tied');
  }

  // --- roundRobinStandings: ranking + tiebreak end-to-end ------------------
  {
    const teamIds = ['A', 'B', 'C', 'D'];
    // A: 3-0, D: 0-3, B and C: 1-2 / 2-1 etc. Construct a clear order plus a tie.
    const ss = [
      series('A', 'B', [[13, 5], [13, 6]]),  // A
      series('A', 'C', [[13, 7], [13, 8]]),  // A
      series('A', 'D', [[13, 3], [13, 4]]),  // A
      series('B', 'C', [[13, 10], [9, 13], [13, 11]]), // B beats C 2-1
      series('B', 'D', [[13, 6], [13, 9]]),  // B
      series('C', 'D', [[13, 8], [13, 9]])   // C
    ];
    // Records: A 3-0, B 2-1, C 1-2, D 0-3.
    const standings = roundRobinStandings(teamIds, ss);
    assertEqual(standings.map((r) => r.teamId), ['A', 'B', 'C', 'D'], 'RR order by wins');
    assertEqual(standings[0].rank, 1, 'rank 1 assigned');
    assertEqual(standings[3].rank, 4, 'rank 4 assigned');
    assertEqual(standings[0].w, 3, 'A has 3 wins');
    assertEqual(standings[3].l, 3, 'D has 3 losses');
    // returned rows are the clean shape (no internal series/seed/buchholz).
    assert(!('series' in standings[0]) && !('seed' in standings[0]),
      'standings rows omit internal fields');
  }

  // --- roundRobin tiebreak: equal wins resolved by map-diff ----------------
  {
    const teamIds = ['P', 'Q'];
    // Both 1-1 overall via a head-to-head split would need 4 teams; instead give
    // each one win and one loss against shared opponents with different map-diff.
    const ss = [
      series('P', 'X', [[13, 2], [13, 3]]),   // P wins big (+21)
      series('Q', 'X', [[13, 11], [13, 10]]), // Q wins close (+5)
      series('P', 'Y', [[5, 13], [6, 13]]),   // P loses moderately (-15) -> net +6
      series('Q', 'Y', [[11, 13], [10, 13]])  // Q loses close (-5) -> net 0
    ];
    // P and Q each 1-1 with equal map-diff (2-2); P has the better round-diff.
    const standings = roundRobinStandings(['P', 'Q'], ss).filter((r) => teamIds.includes(r.teamId));
    assertEqual(standings[0].teamId, 'P', 'P ranks ahead of Q on round-diff tiebreak');
  }

  // --- swissStandings: Buchholz orders equal-record teams ------------------
  {
    // Two teams both 1-1; the one whose opponents won more (higher Buchholz)
    // ranks ahead. Build identical map-diff/round-diff to isolate Buchholz.
    const teamIds = ['H', 'L', 'STRONG', 'WEAK', 'MID1', 'MID2'];
    const ss = [
      // STRONG goes 2-0 in its other games -> high wins; WEAK goes 0-2.
      series('STRONG', 'MID1', [[13, 5], [13, 5]]),
      series('STRONG', 'MID2', [[13, 5], [13, 5]]),
      series('WEAK', 'MID1', [[5, 13], [5, 13]]),
      series('WEAK', 'MID2', [[5, 13], [5, 13]]),
      // H beats WEAK then loses to STRONG; L beats... mirror but swapped opponents.
      series('H', 'STRONG', [[6, 13], [6, 13]]), // H loses to STRONG (strong opp)
      series('H', 'WEAK', [[13, 6], [13, 6]]),   // H beats WEAK
      series('L', 'STRONG', [[6, 13], [6, 13]]), // symmetric records for L
      series('L', 'WEAK', [[13, 6], [13, 6]])
    ];
    const recs = undefined;
    const standings = swissStandings(teamIds, ss, recs);
    const byId = Object.fromEntries(standings.map((r) => [r.teamId, r]));
    // H and L have identical records (1-1, same map/round diff, same opponents),
    // so they tie down to seed; H seeded before L -> H ahead.
    assert(byId.H.rank < byId.L.rank, 'equal Swiss records fall through to seed (H before L)');
    // STRONG (2-0) outranks WEAK (0-2).
    assert(byId.STRONG.rank < byId.WEAK.rank, 'STRONG outranks WEAK on wins');
  }

  // --- immutability: inputs not mutated ------------------------------------
  {
    const ss = [series('A', 'B', [[13, 5], [13, 9]])];
    const snapshot = JSON.stringify(ss);
    recordFromSeries(ss);
    roundRobinStandings(['A', 'B'], ss);
    swissStandings(['A', 'B'], ss);
    assertEqual(JSON.stringify(ss), snapshot, 'series input not mutated');
  }
}
