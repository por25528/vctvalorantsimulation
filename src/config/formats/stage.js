/**
 * config/formats/stage.js — declarative FormatDescriptor for a regional Stage
 * (CONTRACTS-FORMAT §8, ARCHITECTURE §0 #7).
 *
 * 12 teams → two single round-robin groups of 6 → top 4 of each group → an
 * 8-team double-elimination playoff → top 3 advance to the next Masters.
 *
 * DOCUMENTED SPLIT (mirrors kickoff.js): the event seedOrder is split by halves
 *   Group A = seeds 1..6, Group B = seeds 7..12.
 * Playoff entrants are cross-seeded so every round-1 pairing is cross-group:
 *   seed1=A1, seed2=B1, seed3=A2, seed4=B2, seed5=A3, seed6=B3, seed7=A4, seed8=B4.
 *
 * Series length: Bo3 default, Bo5 for the playoff's grand final ({default:3, final:5}).
 * Structurally valid; kickoff is the one verified end-to-end this phase.
 *
 * @typedef {object} FormatDescriptor
 */

const GROUP_A_ENTRANTS = Object.freeze([1, 2, 3, 4, 5, 6].map((seed) => ({ from: 'seed', seed })));
const GROUP_B_ENTRANTS = Object.freeze([7, 8, 9, 10, 11, 12].map((seed) => ({ from: 'seed', seed })));

/** Playoff entrants = crossSeed(groupA top4, groupB top4). RR advancers are the top
 * `advancersOut` by standings rank, in advance order (advance:1 = group winner). */
const PLAYOFF_ENTRANTS = Object.freeze([
  { from: 'groupA', slot: 'advance:1' },
  { from: 'groupB', slot: 'advance:1' },
  { from: 'groupA', slot: 'advance:2' },
  { from: 'groupB', slot: 'advance:2' },
  { from: 'groupA', slot: 'advance:3' },
  { from: 'groupB', slot: 'advance:3' },
  { from: 'groupA', slot: 'advance:4' },
  { from: 'groupB', slot: 'advance:4' }
]);

/** @type {FormatDescriptor} */
export const STAGE_FORMAT = Object.freeze({
  id: 'stage',
  name: 'Stage',
  type: 'stage',
  stages: Object.freeze([
    Object.freeze({
      id: 'groupA',
      name: 'Group A',
      kind: 'roundRobin',
      rounds: 1,
      seriesLen: Object.freeze({ default: 3 }),
      advancersOut: 4,
      entrants: GROUP_A_ENTRANTS
    }),
    Object.freeze({
      id: 'groupB',
      name: 'Group B',
      kind: 'roundRobin',
      rounds: 1,
      seriesLen: Object.freeze({ default: 3 }),
      advancersOut: 4,
      entrants: GROUP_B_ENTRANTS
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
