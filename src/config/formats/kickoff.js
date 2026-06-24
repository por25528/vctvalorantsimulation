/**
 * config/formats/kickoff.js — declarative FormatDescriptor for the Kickoff event
 * (CONTRACTS-FORMAT §8, ARCHITECTURE §0 #5).
 *
 * 12 teams → two seeded GSL double-elim groups of 6 → top 4 each → an 8-team
 * triple-elimination playoff (Upper/Middle/Lower, 3 losses = out). CP 4/3/2/1 to
 * the top 4; placements 1 → Masters playoff, 2 & 3 → Masters Swiss.
 *
 * DOCUMENTED DRAW SPLIT (the one this descriptor encodes):
 *   The event-level seedOrder is the Kickoff draw (a deterministic shuffle of the
 *   12 teams, positions 1..12). We split it into two groups by HALVES:
 *     Group A = draw positions 1, 2, 3, 4, 5, 6   (seeds 1..6)
 *     Group B = draw positions 7, 8, 9, 10, 11, 12 (seeds 7..12)
 *   Each group is a gsl6 (seeds 1 & 2 of the group bye into the winners' round).
 *   Group A's local seeds 1..6 map to draw seeds 1..6; Group B's local seeds 1..6
 *   map to draw seeds 7..12.
 *
 * The playoff entrants are crossSeed(groupA.advancers, groupB.advancers) =
 *   [A1, B1, A2, B2, A3, B3, A4, B4]
 * so every triple-elim round-1 pairing ([1,8],[4,5],[3,6],[2,7]) is cross-group.
 * crossSeed is applied here declaratively: the playoff's entrants interleave the
 * two groups' advancer slots in that exact order.
 *
 * Series length: Bo3 default, Bo5 for the playoff's series final (the Lower Final
 * that decides 3rd/4th) — { default:3, final:5 }.
 *
 * @typedef {import('../../engine/format/formatEngine.js').EventResult} EventResult
 * @typedef {object} StageDescriptor
 * @typedef {object} FormatDescriptor
 */

/** Group A entrant refs: draw seeds 1..6 (group-local seeds 1..6). */
const GROUP_A_ENTRANTS = Object.freeze([
  { from: 'seed', seed: 1 },
  { from: 'seed', seed: 2 },
  { from: 'seed', seed: 3 },
  { from: 'seed', seed: 4 },
  { from: 'seed', seed: 5 },
  { from: 'seed', seed: 6 }
]);

/** Group B entrant refs: draw seeds 7..12 (group-local seeds 1..6). */
const GROUP_B_ENTRANTS = Object.freeze([
  { from: 'seed', seed: 7 },
  { from: 'seed', seed: 8 },
  { from: 'seed', seed: 9 },
  { from: 'seed', seed: 10 },
  { from: 'seed', seed: 11 },
  { from: 'seed', seed: 12 }
]);

/**
 * Playoff entrants = crossSeed(groupA advancers, groupB advancers):
 *   seed1=A1, seed2=B1, seed3=A2, seed4=B2, seed5=A3, seed6=B3, seed7=A4, seed8=B4
 * Each advancer slot is pulled by advance order from the respective group stage.
 */
const PLAYOFF_ENTRANTS = Object.freeze([
  { from: 'groupA', slot: 'advance:1' }, // seed 1 = A1
  { from: 'groupB', slot: 'advance:1' }, // seed 2 = B1
  { from: 'groupA', slot: 'advance:2' }, // seed 3 = A2
  { from: 'groupB', slot: 'advance:2' }, // seed 4 = B2
  { from: 'groupA', slot: 'advance:3' }, // seed 5 = A3
  { from: 'groupB', slot: 'advance:3' }, // seed 6 = B3
  { from: 'groupA', slot: 'advance:4' }, // seed 7 = A4
  { from: 'groupB', slot: 'advance:4' }  // seed 8 = B4
]);

/** @type {FormatDescriptor} */
export const KICKOFF_FORMAT = Object.freeze({
  id: 'kickoff',
  name: 'Kickoff',
  type: 'kickoff',
  stages: Object.freeze([
    Object.freeze({
      id: 'groupA',
      name: 'Group A',
      kind: 'gsl',
      bracketType: 'gsl6',
      seriesLen: Object.freeze({ default: 3 }),
      advancersOut: 4,
      entrants: GROUP_A_ENTRANTS
    }),
    Object.freeze({
      id: 'groupB',
      name: 'Group B',
      kind: 'gsl',
      bracketType: 'gsl6',
      seriesLen: Object.freeze({ default: 3 }),
      advancersOut: 4,
      entrants: GROUP_B_ENTRANTS
    }),
    Object.freeze({
      id: 'playoff',
      name: 'Playoff',
      kind: 'bracket',
      bracketType: 'triple',
      size: 8,
      seriesLen: Object.freeze({ default: 3, final: 5 }),
      entrants: PLAYOFF_ENTRANTS
    })
  ])
});
