/**
 * config/formats/masters.js — declarative FormatDescriptor for an international
 * Masters (CONTRACTS-FORMAT §8, ARCHITECTURE §0 #8).
 *
 * 12 teams: the 4 league-1st-seeds go directly to the playoff; the other 8
 * (2nd/3rd seeds) play an 8-team Swiss (advance at 2 wins, out at 2 losses → 4
 * advance). The 4 Swiss advancers join the 4 direct seeds in an 8-team
 * double-elimination playoff.
 *
 * DOCUMENTED SEEDING: event seedOrder seeds 1..4 are the direct-qualified
 * league firsts; seeds 5..12 enter the Swiss. The playoff is seeded so the four
 * direct seeds take the odd playoff seeds and the four Swiss advancers the even
 * ones (direct1, swiss1, direct2, swiss2, ...), keeping group-fresh matchups in
 * round 1.
 *
 * Series length: Bo3 default, Bo5 for the playoff grand final ({default:3, final:5}).
 * Structurally valid; kickoff is the one verified end-to-end this phase.
 *
 * @typedef {object} FormatDescriptor
 */

/** The 8 second/third seeds that contest the Swiss (event seeds 5..12). */
const SWISS_ENTRANTS = Object.freeze(
  [5, 6, 7, 8, 9, 10, 11, 12].map((seed) => ({ from: 'seed', seed }))
);

/**
 * Playoff entrants (8): interleave the 4 direct seeds with the 4 Swiss advancers.
 *   seed1=direct1, seed2=swiss1, seed3=direct2, seed4=swiss2,
 *   seed5=direct3, seed6=swiss3, seed7=direct4, seed8=swiss4
 */
const PLAYOFF_ENTRANTS = Object.freeze([
  { from: 'seed', seed: 1 },
  { from: 'swiss', slot: 'advance:1' },
  { from: 'seed', seed: 2 },
  { from: 'swiss', slot: 'advance:2' },
  { from: 'seed', seed: 3 },
  { from: 'swiss', slot: 'advance:3' },
  { from: 'seed', seed: 4 },
  { from: 'swiss', slot: 'advance:4' }
]);

/** @type {FormatDescriptor} */
export const MASTERS_FORMAT = Object.freeze({
  id: 'masters',
  name: 'Masters',
  type: 'masters',
  stages: Object.freeze([
    Object.freeze({
      id: 'swiss',
      name: 'Swiss',
      kind: 'swiss',
      winsToAdvance: 2,
      lossesToEliminate: 2,
      seriesLen: Object.freeze({ default: 3 }),
      advancersOut: 4,
      entrants: SWISS_ENTRANTS
    }),
    Object.freeze({
      id: 'playoff',
      name: 'Playoff',
      kind: 'bracket',
      bracketType: 'double',
      size: 8,
      seriesLen: Object.freeze({ default: 3, final: 5 }),
      entrants: PLAYOFF_ENTRANTS
    })
  ])
});
