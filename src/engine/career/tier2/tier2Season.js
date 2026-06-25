/**
 * engine/career/tier2/tier2Season.js — in-season simulation of the Tier-2 leagues.
 *
 * Runs ALONGSIDE the Tier-1 season: for every REGIONAL calendar slot (kickoff,
 * stage1-3) each region's Challengers league plays the SAME regional format
 * (Kickoff/Stage) through the very same `simEvent` / standings engine as T1, and a
 * region-tagged Championship-Points ledger accumulates a season-long standing.
 *
 * The T2 sim consumes its own seed namespace (`hashSeed(seed, slotId, region,
 * 't2')`) so it can NEVER perturb the T1 draws — the franchised season stays
 * byte-identical whether or not T2 is attached. T2 plays only the regional slots;
 * it has no international Masters/Champions. Pure & deterministic; inputs frozen.
 *
 * @typedef {import('../../format/formatEngine.js').EventResult} EventResult
 * @typedef {import('../championshipPoints.js').CPLedger} CPLedger
 *
 * @typedef {Object} Tier2SeasonState
 * @property {CPLedger} ledger                       region-tagged cumulative CP
 * @property {Array<{slotId:string, region:string, result:EventResult, cpAwards:Record<string,number>}>} events
 */

import { hashSeed } from '../../../core/hash.js';
import { simEvent } from '../../format/formatEngine.js';
import { applyCP, awardCP, createLedger, cpStandings } from '../championshipPoints.js';
import { REGION_ORDER } from '../qualification.js';
import { CP_TABLE } from '../../../config/cpTable.js';

/** A fresh, empty Tier-2 season accumulator. */
export function initTier2Season() {
  return Object.freeze({ ledger: createLedger(), events: Object.freeze([]) });
}

/** Build the teamsById subset for one T2 league (its TEAMS_PER_REGION clubs). */
function leagueTeamsById(league, teamsById) {
  /** @type {Record<string, object>} */
  const subset = {};
  for (const id of (league && league.teamIds) || []) {
    if (teamsById[id]) subset[id] = teamsById[id];
  }
  return subset;
}

/**
 * Play ONE regional calendar slot across all four Tier-2 leagues, returning a NEW
 * Tier2SeasonState with the region-tagged results appended and CP applied. Each
 * region runs one `simEvent` over its T2 league, seeded independently of T1.
 *
 * @param {Tier2SeasonState} t2State
 * @param {object} slot          the regional CalendarSlot (scope 'regional')
 * @param {object} format        the slot's FormatDescriptor (Kickoff/Stage)
 * @param {object} tier2World    world.tier2 { leagues, teamsById, playersById }
 * @param {number|string} seed   the season seed
 * @returns {Tier2SeasonState} frozen
 */
export function advanceTier2RegionalSlot(t2State, slot, format, tier2World, seed) {
  if (!tier2World || !tier2World.leagues) return t2State;
  let ledger = t2State.ledger;
  const events = t2State.events.slice();

  for (const region of REGION_ORDER) {
    const league = tier2World.leagues[region];
    if (!league) continue;
    const teamsById = leagueTeamsById(league, tier2World.teamsById);
    const eventId = `${slot.id}-${region}-t2`;
    const result = simEvent(
      format,
      { eventId, teamsById, playersById: tier2World.playersById },
      hashSeed(seed, slot.id, region, 't2')
    );
    const cpAwards = awardCP(result, CP_TABLE);
    ledger = applyCP(ledger, eventId, region, result, CP_TABLE);
    events.push(Object.freeze({ slotId: slot.id, region, result, cpAwards }));
  }

  return Object.freeze({ ledger, events: Object.freeze(events) });
}

/**
 * Final Tier-2 standings, grouped by region: each region's clubs ordered by
 * cumulative CP (teamId tiebreak), derived from the season ledger.
 *
 * @param {Tier2SeasonState} t2State
 * @param {object} tier2World  world.tier2 (for region membership)
 * @returns {Record<string, Array<{teamId:string, cp:number}>>}
 */
export function tier2StandingsByRegion(t2State, tier2World) {
  const all = cpStandings(t2State.ledger);
  /** @type {Record<string, Array<{teamId:string, cp:number}>>} */
  const byRegion = {};
  for (const region of REGION_ORDER) {
    const league = (tier2World.leagues && tier2World.leagues[region]) || { teamIds: [] };
    const ids = new Set(league.teamIds || []);
    byRegion[region] = all.filter((row) => ids.has(row.teamId));
  }
  return byRegion;
}
