/**
 * engine/format/formatEngine.js — interprets a FormatDescriptor and drives an
 * event through its declarative stages (gsl / roundRobin / swiss / bracket),
 * producing a full EventResult (CONTRACTS-FORMAT §6).
 *
 * One engine plays every event:
 *   1. determine the event-level seedOrder (provided by the caller, else a
 *      deterministic draw via createRng(eventSeed) — the Kickoff draw);
 *   2. for each stage in order: resolveEntrants -> dispatch to the kind's run()
 *      with a per-stage makeSeed factory -> cache the StageResult by id;
 *   3. assemble placements across all stages (the final bracket gives ranks 1..K;
 *      earlier-stage non-advancers are ranked below, best group standing first);
 *   4. return an immutable EventResult (cp/qualifiers are left for the career
 *      layer to fill — see championshipPoints.js / qualification.js).
 *
 * Hard rules (CONTRACTS §0, §15 / CONTRACTS-FORMAT §6): pure functions, named
 * exports only, no Math.random / Date.now / window / document. The ONLY in-engine
 * randomness is the seed draw, which flows through an injected Rng built from
 * `eventSeed`. Every series is decided by simSeries seeded via
 * makeSeedFactory(eventSeed, stageId)(matchId) == hashSeed(eventSeed, stageId,
 * matchId) — never by a stage's own rng — so each series is independently
 * reproducible. Outputs are fresh, frozen objects; inputs are never mutated.
 * Runs unchanged in Node and the browser.
 *
 * @typedef {import('./bracket.js').Placement} Placement
 *
 * @typedef {Object} StageResult
 * @property {string} stageId
 * @property {string} kind
 * @property {Array<{teamId:string,rank:number,w:number,l:number,mapW:number,mapL:number,roundDiff:number}>} standings
 * @property {string[]} advancers
 * @property {object[]} series   // SeriesRef[] (Series + { stageId, matchId })
 *
 * @typedef {Object} EventResult
 * @property {string} eventId
 * @property {string} formatId
 * @property {'kickoff'|'stage'|'masters'|'champions'} type
 * @property {Placement[]} placements         // ranks 1..N over ALL participants
 * @property {Array<{teamId:string,seedInto:string}>} qualifiers  // filled later
 * @property {Record<string,number>} cp        // filled later
 * @property {StageResult[]} stages
 * @property {object[]} series                 // every SeriesRef across all stages
 */

import { createRng } from '../../core/rng.js';
import { hashSeed } from '../../core/hash.js';
import { resolveEntrants, drawSeedOrder } from './seeding.js';
import * as roundRobin from './roundRobin.js';
import * as gsl from './gsl.js';
import * as swiss from './swiss.js';
import * as bracket from './bracket.js';

/** Map a StageDescriptor.kind to its run(stage, entrants, ctx, makeSeed, rng). */
const KIND_RUNNERS = Object.freeze({
  roundRobin: roundRobin.run,
  gsl: gsl.run,
  swiss: swiss.run,
  bracket: bracket.run
});

/**
 * Build the per-stage deterministic series-seed factory:
 *   makeSeedFactory(eventSeed, stageId)(matchId) === hashSeed(eventSeed, stageId, matchId)
 *
 * @param {number|string} eventSeed
 * @param {string} stageId
 * @returns {(matchId:string)=>number}
 */
export function makeSeedFactory(eventSeed, stageId) {
  return (matchId) => hashSeed(eventSeed, stageId, matchId);
}

/**
 * Run an event format to completion and return its EventResult.
 *
 * @param {object} descriptor FormatDescriptor { id, name, type, stages:StageDescriptor[] }
 * @param {object} ctx        { eventId, teamsById, playersById, seedOrder?:string[] }
 * @param {number|string} eventSeed  master seed for this event (drives the draw + every series)
 * @returns {EventResult}
 */
export function simEvent(descriptor, ctx, eventSeed) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('simEvent: descriptor (FormatDescriptor) is required');
  }
  if (!Array.isArray(descriptor.stages) || descriptor.stages.length === 0) {
    throw new Error('simEvent: descriptor.stages must be a non-empty array');
  }
  const context = ctx || {};
  const teamsById = context.teamsById || {};
  const playersById = context.playersById || {};
  const eventId = context.eventId || descriptor.id || 'event';

  // 1) Determine event-level seedOrder: provided, else a deterministic draw.
  const participants = collectParticipants(descriptor, teamsById);
  let seedOrder;
  if (Array.isArray(context.seedOrder) && context.seedOrder.length > 0) {
    seedOrder = context.seedOrder.slice();
  } else {
    const drawRng = createRng(normalizeSeed(eventSeed));
    seedOrder = drawSeedOrder(participants, drawRng);
  }

  const seedingCtx = { seedOrder, teamsById, playersById };

  // 2) Run each stage in order, caching StageResults by id.
  /** @type {Record<string, StageResult>} */
  const priorStages = {};
  /** @type {StageResult[]} */
  const stages = [];
  /** @type {object[]} */
  const allSeries = [];

  for (const stage of descriptor.stages) {
    if (!stage || typeof stage !== 'object' || !stage.id) {
      throw new Error('simEvent: every stage needs an id');
    }
    const runner = KIND_RUNNERS[stage.kind];
    if (typeof runner !== 'function') {
      throw new Error(`simEvent: unknown stage kind '${stage.kind}' for stage '${stage.id}'`);
    }

    const entrants = resolveEntrants(stage, seedingCtx, priorStages);
    const makeSeed = makeSeedFactory(eventSeed, stage.id);
    // Per-stage rng for in-stage non-series randomness (e.g. Swiss tie-breaks).
    const stageRng = createRng(hashSeed(eventSeed, stage.id, '#stage-rng'));

    const result = runner(stage, entrants, { teamsById, playersById }, makeSeed, stageRng);
    priorStages[stage.id] = result;
    stages.push(result);
    for (const s of result.series || []) allSeries.push(s);
  }

  // 3) Assemble placements across all stages.
  const placements = assemblePlacements(descriptor, stages, seedOrder);

  // 4) Return the EventResult (cp/qualifiers deferred to the career layer).
  return Object.freeze({
    eventId,
    formatId: descriptor.id,
    type: descriptor.type,
    placements,
    qualifiers: Object.freeze([]),
    cp: Object.freeze({}),
    stages: Object.freeze(stages),
    series: Object.freeze(allSeries)
  });
}

/**
 * Collect the distinct participant teamIds the descriptor seeds from. Used to
 * size the Kickoff draw. We read every `{ from:'seed', seed:n }` entrant across
 * stages, take the maximum seed N, and return teamsById's first N ids in a
 * stable order — but if the caller supplies seedOrder we never use this.
 *
 * @param {object} descriptor
 * @param {Record<string,object>} teamsById
 * @returns {string[]}
 */
function collectParticipants(descriptor, teamsById) {
  let maxSeed = 0;
  for (const stage of descriptor.stages) {
    for (const ref of stage.entrants || []) {
      if (ref && ref.from === 'seed' && Number.isInteger(ref.seed)) {
        if (ref.seed > maxSeed) maxSeed = ref.seed;
      }
    }
  }
  const ids = Object.keys(teamsById);
  if (maxSeed > 0 && ids.length >= maxSeed) return ids.slice(0, maxSeed);
  return ids;
}

/**
 * Assemble the full ranked placement list (rank 1..N, unique, no gaps) across
 * all stages.
 *
 * The LAST stage is the deciding bracket: its placements seed the top ranks
 * (1..K). Every participant that did not reach that final stage is ranked below,
 * grouped by the earlier stage they exited, best standing first; within an
 * earlier stage, by ascending standings rank (and the standings already encode
 * the seed tiebreak). This yields, for Kickoff: playoff ranks 1..8, then the 4
 * group non-advancers at 9..12 (each group's 5th above its 6th, then seed).
 *
 * @param {object} descriptor
 * @param {StageResult[]} stages
 * @param {string[]} seedOrder  event-level seed order (for final tie-break)
 * @returns {Placement[]}
 */
function assemblePlacements(descriptor, stages, seedOrder) {
  const finalStage = stages[stages.length - 1];
  const seedIndex = new Map(seedOrder.map((tid, i) => [tid, i]));

  /** @type {Placement[]} */
  const out = [];
  const placed = new Set();
  let rank = 1;

  // 1) Final-stage placements occupy the top ranks, in their existing rank order.
  const finalPlacements = (finalStage.placements || finalStageFromStandings(finalStage));
  for (const p of finalPlacements) {
    out.push(freezePlacement(rank++, p.teamId, p.losses, p.eliminatedIn));
    placed.add(p.teamId);
  }

  // 2) Earlier stages, in REVERSE order (teams that survived longer rank higher):
  //    every team not yet placed is ranked by its standing in the latest stage it
  //    appeared in. Within a stage, lower standings rank first; ties (across
  //    parallel groups) broken by group standing rank then event seed.
  for (let i = stages.length - 2; i >= 0; i--) {
    const stage = stages[i];
    const survivors = (stage.standings || [])
      .filter((s) => !placed.has(s.teamId))
      .slice()
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank; // 5th of a group above 6th
        // same in-group rank across parallel groups -> event seed ASC
        const sa = seedIndex.has(a.teamId) ? seedIndex.get(a.teamId) : Infinity;
        const sb = seedIndex.has(b.teamId) ? seedIndex.get(b.teamId) : Infinity;
        return sa - sb;
      });
    for (const s of survivors) {
      out.push(freezePlacement(rank++, s.teamId, s.l, undefined));
      placed.add(s.teamId);
    }
  }

  return Object.freeze(out);
}

/**
 * Fallback: derive ordered "placements" from a non-bracket final stage's
 * standings (so simEvent still works if the last stage isn't a bracket).
 * @param {StageResult} stage
 * @returns {Array<{teamId:string,losses:number,eliminatedIn?:string}>}
 */
function finalStageFromStandings(stage) {
  return (stage.standings || [])
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((s) => ({ teamId: s.teamId, losses: s.l }));
}

/**
 * Build a frozen Placement. `eliminatedIn` is included only when present.
 * @param {number} rank
 * @param {string} teamId
 * @param {number} losses
 * @param {string|undefined} eliminatedIn
 * @returns {Placement}
 */
function freezePlacement(rank, teamId, losses, eliminatedIn) {
  const p = { rank, teamId, losses: losses || 0 };
  if (eliminatedIn) p.eliminatedIn = eliminatedIn;
  return Object.freeze(p);
}

/**
 * Coerce an event seed to a 32-bit integer for createRng (the draw). Numbers
 * pass through; strings are hashed so any stable label seeds deterministically.
 * @param {number|string} eventSeed
 * @returns {number}
 */
function normalizeSeed(eventSeed) {
  if (Number.isInteger(eventSeed)) return eventSeed >>> 0;
  return hashSeed(String(eventSeed));
}
