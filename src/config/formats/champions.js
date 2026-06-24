/**
 * config/formats/champions.js — declarative FormatDescriptor for Champions
 * (CONTRACTS-FORMAT §8, ARCHITECTURE §0 #9).
 *
 * 16 teams (1 direct slot for the final Masters winner + 15 by cumulative CP):
 * a 16-team Swiss (classic 3-win / 3-loss → 8 advance) feeds an 8-team
 * double-elimination playoff. The season finale awards no CP.
 *
 * DOCUMENTED SEEDING: event seedOrder seeds 1..16 enter the Swiss (seed 1 is the
 * direct Masters-winner slot). The 8 Swiss advancers are cross/standard-seeded
 * into the double-elim by advance order: advance:1 = playoff seed 1, etc.
 *
 * Series length: Bo3 default, Bo5 for the playoff grand final ({default:3, final:5}).
 * Structurally valid; kickoff is the one verified end-to-end this phase.
 *
 * @typedef {object} FormatDescriptor
 */

/** All 16 teams enter the Swiss (event seeds 1..16). */
const SWISS_ENTRANTS = Object.freeze(
  Array.from({ length: 16 }, (_, i) => ({ from: 'seed', seed: i + 1 }))
);

/** Playoff entrants (8): the Swiss advancers in advance order. */
const PLAYOFF_ENTRANTS = Object.freeze(
  Array.from({ length: 8 }, (_, i) => ({ from: 'swiss', slot: `advance:${i + 1}` }))
);

/** @type {FormatDescriptor} */
export const CHAMPIONS_FORMAT = Object.freeze({
  id: 'champions',
  name: 'Champions',
  type: 'champions',
  stages: Object.freeze([
    Object.freeze({
      id: 'swiss',
      name: 'Swiss',
      kind: 'swiss',
      winsToAdvance: 3,
      lossesToEliminate: 3,
      seriesLen: Object.freeze({ default: 3 }),
      advancersOut: 8,
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
