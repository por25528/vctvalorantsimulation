/**
 * engine/career/championshipPoints.js — Championship Points award glue.
 * Phase 2 career slice. Binding contract: CONTRACTS-FORMAT §7.
 *
 * Pure, deterministic, named export only. No randomness, no I/O. All point
 * values come from config/cpTable.js (passed in); nothing is hardcoded here.
 */

/**
 * Compute championship-point awards for a completed event.
 *
 * Reads `cpTable[eventResult.type][rank]` for each placement; ranks beyond the
 * table (or whose lookup yields a non-finite value) award 0. Every placed team
 * appears in the result exactly once.
 *
 * @param {{ type:string, placements:Array<{rank:number, teamId:string}> }} eventResult
 * @param {Record<string, Record<number, number>>} cpTable  award table by type then rank
 * @returns {Record<string, number>} teamId -> CP awarded (frozen, immutable)
 */
export function awardCP(eventResult, cpTable) {
  const typeTable = (cpTable && cpTable[eventResult.type]) || {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const { rank, teamId } of eventResult.placements) {
    const pts = typeTable[rank];
    out[teamId] = Number.isFinite(pts) ? pts : 0;
  }
  return Object.freeze(out);
}

/**
 * @typedef {Object} CPLedger
 * @property {Record<string, number>} totals  cumulative CP by teamId
 * @property {Array<{eventId:string, region:(string|null), awards:Record<string, number>}>} history
 *   per-event award records, in apply order
 */

/**
 * Create an empty, immutable CP ledger.
 * @returns {CPLedger}
 */
export function createLedger() {
  return Object.freeze({ totals: Object.freeze({}), history: Object.freeze([]) });
}

/**
 * Apply one event's CP awards to a ledger, returning a NEW ledger (immutable):
 * the event's awards are added to running totals and a history entry is pushed.
 * The input ledger is never mutated.
 *
 * @param {CPLedger} ledger
 * @param {string} eventId
 * @param {(string|null|undefined)} region  region tag (international events pass null/undefined)
 * @param {{ type:string, placements:Array<{rank:number, teamId:string}> }} eventResult
 * @param {Record<string, Record<number, number>>} cpTable
 * @returns {CPLedger} new frozen ledger
 */
export function applyCP(ledger, eventId, region, eventResult, cpTable) {
  const awards = awardCP(eventResult, cpTable);

  /** @type {Record<string, number>} */
  const totals = { ...ledger.totals };
  for (const teamId of Object.keys(awards)) {
    totals[teamId] = (totals[teamId] || 0) + awards[teamId];
  }

  const entry = Object.freeze({
    eventId,
    region: region == null ? null : region,
    awards // already frozen by awardCP
  });

  return Object.freeze({
    totals: Object.freeze(totals),
    history: Object.freeze([...ledger.history, entry])
  });
}

/**
 * Standings from a ledger: every team with a totals entry, sorted by CP
 * descending, ties broken by teamId ascending (lexicographic).
 *
 * @param {CPLedger} ledger
 * @returns {Array<{teamId:string, cp:number}>} frozen array of frozen rows
 */
export function cpStandings(ledger) {
  const rows = Object.keys(ledger.totals).map((teamId) =>
    Object.freeze({ teamId, cp: ledger.totals[teamId] })
  );
  rows.sort((a, b) => (b.cp - a.cp) || (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));
  return Object.freeze(rows);
}
