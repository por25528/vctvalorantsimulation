/**
 * engine/format/roundRobin.js — round-robin tournament kind (CONTRACTS-FORMAT §4).
 *
 * A round-robin stage has every team play every other team once (`rounds:1`,
 * single) or twice (`rounds:2`, double). Each meeting is a Bo3 (or the stage's
 * configured default series length) simulated by the Phase-1 match engine
 * (simSeries). Standings come from roundRobinStandings (standings.js); the top
 * `stage.advancersOut` of the ranked table advance.
 *
 * Hard rules (CONTRACTS §15 / CONTRACTS-FORMAT): pure function, named exports,
 * no Math.random / Date.now / window / document. All series randomness flows
 * through the injected match seed — simSeries is called with `makeSeed(matchId)`
 * (a deterministic hashSeed-derived integer), NOT the stage `rng`, so each
 * series is independently reproducible. The `rng` parameter is accepted for
 * signature parity with the other tournament kinds (round-robin needs no
 * in-stage non-series randomness). Outputs are fresh immutable objects; inputs
 * are never mutated. Runs unchanged in Node and the browser (plain ES modules).
 *
 * @typedef {import('../match/matchSim.js').Series} Series
 */

import { simSeries } from '../match/matchSim.js';
import { roundRobinStandings } from './standings.js';

/**
 * @typedef Standing
 * @property {string} teamId
 * @property {number} rank
 * @property {number} w
 * @property {number} l
 * @property {number} mapW
 * @property {number} mapL
 * @property {number} roundDiff
 */

/**
 * @typedef {Series & { stageId:string, matchId:string }} SeriesRef
 */

/**
 * @typedef StageResult
 * @property {string} stageId
 * @property {string} kind
 * @property {Standing[]} standings
 * @property {string[]} advancers
 * @property {SeriesRef[]} series
 */

/**
 * Generate the ordered round-robin pairing schedule for a set of seeded teams.
 *
 * `rounds:1` (single) yields every unordered pair exactly once. `rounds:2`
 * (double) yields each pair twice; the second leg swaps home/away (a/b) so the
 * deterministic attack-side schedule inside simSeries differs between legs.
 *
 * Pairings are emitted in a fixed nested order over the seed indices so match
 * ids (`RR-i-j` / `RR-i-j-r2`) are deterministic.
 *
 * @param {string[]} entrants  seeded teamIds (index 0 => seed 1)
 * @param {number} [rounds]    1 (single) or 2 (double); default 1
 * @returns {Array<{ matchId:string, ai:number, bi:number }>}
 */
export function scheduleRoundRobin(entrants, rounds = 1) {
  const teams = Array.isArray(entrants) ? entrants : [];
  const legs = rounds === 2 ? 2 : 1;
  /** @type {Array<{ matchId:string, ai:number, bi:number }>} */
  const schedule = [];
  for (let leg = 0; leg < legs; leg++) {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        // Second leg swaps which team is "a" so the home/away (attack) order flips.
        const ai = leg === 0 ? i : j;
        const bi = leg === 0 ? j : i;
        const matchId = leg === 0 ? `RR-${i}-${j}` : `RR-${i}-${j}-r2`;
        schedule.push({ matchId, ai, bi });
      }
    }
  }
  return schedule;
}

/**
 * Resolve the series length for a round-robin meeting from the stage descriptor.
 * Round-robin games use the default length (Bo3); there is no "final" here.
 * @param {object} stage
 * @returns {number}
 */
function defaultSeriesLen(stage) {
  const sl = stage && stage.seriesLen;
  if (sl && Number.isInteger(sl.default) && sl.default > 0) return sl.default;
  return 3;
}

/**
 * Run a round-robin stage: build the schedule, simulate every meeting via the
 * match engine, compute standings, and take the top `advancersOut` advancers.
 *
 * @param {object} stage   StageDescriptor (CONTRACTS-FORMAT §1); reads
 *                         `id`, `seriesLen.default`, `rounds`, `advancersOut`.
 * @param {string[]} entrants  seeded teamIds (index 0 => seed 1).
 * @param {object} ctx     { teamsById, playersById, ... } — team & player lookups.
 * @param {(matchId:string)=>number} makeSeed  deterministic per-series seed factory.
 * @param {object} [rng]   stage rng (unused by round-robin; kept for parity).
 * @returns {StageResult}
 */
export function run(stage, entrants, ctx, makeSeed, rng) {
  const stageId = stage && stage.id ? stage.id : 'roundRobin';
  const teamIds = Array.isArray(entrants) ? entrants.slice() : [];
  const teamsById = (ctx && ctx.teamsById) || {};
  const playersById = (ctx && ctx.playersById) || {};
  const bestOf = defaultSeriesLen(stage);
  const rounds = stage && stage.rounds === 2 ? 2 : 1;

  const schedule = scheduleRoundRobin(teamIds, rounds);

  /** @type {SeriesRef[]} */
  const series = [];
  for (const { matchId, ai, bi } of schedule) {
    const teamAId = teamIds[ai];
    const teamBId = teamIds[bi];
    const teamA = teamsById[teamAId];
    const teamB = teamsById[teamBId];
    const seed = makeSeed(matchId);

    const s = simSeries(teamA, teamB, playersById, bestOf, seed);

    // Tag the Series with its stage/match identity to form a SeriesRef. The
    // simSeries result already keys teamAId/teamBId off the team objects, which
    // match teamIds[ai]/[bi].
    series.push({ ...s, stageId, matchId });
  }

  // Standings are computed over the full seeded entrant list so seed tiebreaks
  // and ranks cover every team even if (degenerately) one played no series.
  const standings = roundRobinStandings(teamIds, series);

  const advancersOut =
    stage && Number.isInteger(stage.advancersOut) && stage.advancersOut > 0
      ? Math.min(stage.advancersOut, standings.length)
      : 0;
  const advancers = standings.slice(0, advancersOut).map((row) => row.teamId);

  return {
    stageId,
    kind: 'roundRobin',
    standings,
    advancers,
    series
  };
}
