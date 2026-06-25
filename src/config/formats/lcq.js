/**
 * config/formats/lcq.js — declarative FormatDescriptor for the international
 * Last-Chance Qualifier (LCQ) (CONTRACTS-FORMAT §8).
 *
 * 8 teams: the 8 teams just below the Champions direct-qualification cut-off
 * (by cumulative CP, seeded by qualification.lcqSeedOrder). They compete in an
 * 8-team double-elimination bracket; the winner earns the final slot (seed 16)
 * in the Champions event.
 *
 * Format: Bo3 default, Bo5 for the grand final — mirrors Masters playoff.
 * CP: 3/2/1 to 1st/2nd/3rd (via cpTable lcq entry) — small award to acknowledge
 *     achievement without distorting the main CP standings.
 *
 * @typedef {import('../../engine/format/formatEngine.js').EventResult} EventResult
 * @typedef {object} FormatDescriptor
 */

/** All 8 event seeds enter the bracket. */
const BRACKET_ENTRANTS = Object.freeze(
  [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => Object.freeze({ from: 'seed', seed }))
);

/** @type {FormatDescriptor} */
export const LCQ_FORMAT = Object.freeze({
  id: 'lcq',
  name: 'Last Chance Qualifier',
  type: 'lcq',
  stages: Object.freeze([
    Object.freeze({
      id: 'bracket',
      name: 'Bracket',
      kind: 'bracket',
      bracketType: 'double',
      size: 8,
      seriesLen: Object.freeze({ default: 3, final: 5 }),
      entrants: BRACKET_ENTRANTS
    })
  ])
});
