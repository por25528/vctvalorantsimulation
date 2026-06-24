/**
 * engine/format/gsl.js — 6-team GSL double-elim group (CONTRACTS-FORMAT §4, §5c).
 *
 * Thin wrapper over the generic bracket engine: a GSL group is just a bracket of
 * type 'gsl6' that advances exactly 4 of its 6 teams (and eliminates 2). All the
 * graph + execution logic lives in `bracket.js`; this module only fixes the
 * bracketType and the default advancersOut so callers can treat 'gsl' as its own
 * stage kind.
 *
 * Pure, named exports only, no Math.random / Date.now / DOM. Every series is
 * decided by `simSeries` seeded via `makeSeed(matchId)`. Runs unchanged in Node
 * and the browser.
 */

import { run as bracketRun } from './bracket.js';

/**
 * Run a 6-team GSL group and return a StageResult with exactly 4 advancers
 * (in rank order: the two upper-final teams first, then the two lower survivors).
 *
 * @param {Object} stage   StageDescriptor (kind 'gsl'); bracketType/advancersOut
 *                         are forced to 'gsl6' / 4 here.
 * @param {string[]} entrants  6 teamIds seeded (index 0 = seed 1).
 * @param {Object} ctx     { teamsById, playersById, ... }
 * @param {(matchId:string)=>number} makeSeed
 * @param {import('../../core/rng.js').Rng} [rng]
 * @returns {Object} StageResult
 */
export function run(stage, entrants, ctx, makeSeed, rng) {
  const gslStage = Object.assign({}, stage, { bracketType: 'gsl6', advancersOut: 4 });
  return bracketRun(gslStage, entrants, ctx, makeSeed, rng);
}
