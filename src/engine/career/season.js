/**
 * engine/career/season.js — the season runner (CONTRACTS-SEASON §6).
 *
 * simSeason(world, seed) walks the CALENDAR and plays the whole 2026 cycle by
 * delegating EVERY event to formatEngine.simEvent — the season layer only
 * schedules events and threads qualifiers + cumulative Championship Points
 * between them. Headless & deterministic: all per-event seeds derive from the
 * single season `seed` via hashSeed, so the entire season is reproducible.
 *
 * Walk:
 *  - regional slot (kickoff / stage1 / stage2 / stage3): for each of the 4
 *    leagues run one simEvent over that league's 12 teams with
 *    eventId `${slotId}-${region}` and seed hashSeed(seed, slotId, region);
 *    apply CP region-tagged; cache the per-region results.
 *  - masters slot (m0 / m1 / m2): seedOrder = mastersSeedOrder(<feedsFrom
 *    regional results by region>); simEvent(MASTERS_FORMAT, …,
 *    hashSeed(seed, slotId)); apply CP. If finalMasters, remember placement-1 as
 *    the Champions direct-slot team.
 *  - champions slot: seedOrder = championsField(ledger, m2Winner);
 *    simEvent(CHAMPIONS_FORMAT, …, hashSeed(seed, slotId)); champion = placement 1
 *    (champions awards no CP).
 *
 * Pure, named export only. No Math.random / Date.now / window / document. All
 * randomness flows from `seed` through hashSeed. Outputs are fresh, frozen
 * objects; `world` is never mutated. Runs unchanged in Node and the browser.
 *
 * @typedef {import('../format/formatEngine.js').EventResult} EventResult
 * @typedef {import('./championshipPoints.js').CPLedger} CPLedger
 *
 * @typedef {Object} SeasonEventEntry
 * @property {string} slotId
 * @property {'kickoff'|'stage'|'masters'|'champions'} type
 * @property {'regional'|'international'} scope
 * @property {string} [region]                    // present only for regional slots
 * @property {EventResult} result
 * @property {Record<string, number>} cpAwards
 *
 * @typedef {Object} SeasonResult
 * @property {string} seasonId
 * @property {number|string} seed
 * @property {SeasonEventEntry[]} events           // calendar order; regional slots expand to 4 region-tagged entries
 * @property {CPLedger} ledger
 * @property {Record<string, { seedOrder:string[] }>} masters  // how each Masters was seeded, by slotId
 * @property {string[]} championsField             // 16 teamIds (index 0 = m2 winner direct slot)
 * @property {string} champion                     // Champions placement 1
 * @property {string[]} finalStandings             // teamIds in final CP order (champion-aware)
 *
 * @typedef {Object} SeasonState
 * @property {number|string} seed
 * @property {ReadonlyArray<object>} calendar       // the CALENDAR slots
 * @property {number} slotIndex                     // next slot to play (0..calendar.length)
 * @property {SeasonEventEntry[]} events            // completed entries, in calendar order
 * @property {CPLedger} ledger
 * @property {Record<string, { seedOrder:string[] }>} masters
 * @property {Record<string, Record<string, EventResult>>} regionalResultsBySlot  // internal: feeds masters seeding
 * @property {string|null} m2Winner
 * @property {string[]|null} championsField
 * @property {string|null} champion
 * @property {boolean} complete
 */

import { hashSeed } from '../../core/hash.js';
import { simEvent } from '../format/formatEngine.js';
import { simSeries } from '../match/matchSim.js';
import {
  applyCP,
  awardCP,
  createLedger,
  cpStandings
} from './championshipPoints.js';
import {
  REGION_ORDER,
  mastersSeedOrder,
  championsField
} from './qualification.js';

import { KICKOFF_FORMAT } from '../../config/formats/kickoff.js';
import { STAGE_FORMAT } from '../../config/formats/stage.js';
import { MASTERS_FORMAT } from '../../config/formats/masters.js';
import { CHAMPIONS_FORMAT } from '../../config/formats/champions.js';
import { CP_TABLE } from '../../config/cpTable.js';

import { CALENDAR } from './calendar.js';

/** Map a CalendarSlot.formatId to its FormatDescriptor. */
const FORMAT_BY_ID = Object.freeze({
  kickoff: KICKOFF_FORMAT,
  stage: STAGE_FORMAT,
  masters: MASTERS_FORMAT,
  champions: CHAMPIONS_FORMAT
});

/**
 * Find a placement's teamId by rank in an EventResult.
 * @param {EventResult} result
 * @param {number} rank
 * @returns {string|undefined}
 */
function teamAtRank(result, rank) {
  const p = result.placements.find((x) => x.rank === rank);
  return p ? p.teamId : undefined;
}

/**
 * Build the teamsById subset for a single league (its 12 teams).
 * @param {{ teamIds:string[] }} league
 * @param {Record<string, object>} teamsById
 * @returns {Record<string, object>}
 */
function leagueTeamsById(league, teamsById) {
  /** @type {Record<string, object>} */
  const subset = {};
  for (const id of league.teamIds) {
    if (teamsById[id]) subset[id] = teamsById[id];
  }
  return subset;
}

/**
 * Run one regional slot: one simEvent per league. Applies CP region-tagged.
 * Returns the per-region EventResults plus the freshly-threaded ledger and the
 * season-event entries (one per region, in REGION_ORDER).
 *
 * @param {object} slot       CalendarSlot
 * @param {object} format     FormatDescriptor
 * @param {object} world      World
 * @param {number|string} seed
 * @param {CPLedger} ledgerIn
 * @returns {{ resultsByRegion:Record<string,EventResult>, ledger:CPLedger, entries:SeasonEventEntry[] }}
 */
function runRegionalSlot(slot, format, world, seed, ledgerIn) {
  /** @type {Record<string, EventResult>} */
  const resultsByRegion = {};
  /** @type {SeasonEventEntry[]} */
  const entries = [];
  let ledger = ledgerIn;

  for (const region of REGION_ORDER) {
    const league = world.leagues[region];
    const teamsById = leagueTeamsById(league, world.teamsById);
    const eventId = `${slot.id}-${region}`;
    const result = simEvent(
      format,
      { eventId, teamsById, playersById: world.playersById },
      hashSeed(seed, slot.id, region)
    );
    const cpAwards = awardCP(result, CP_TABLE);
    ledger = applyCP(ledger, eventId, region, result, CP_TABLE);
    resultsByRegion[region] = result;
    entries.push(Object.freeze({
      slotId: slot.id,
      type: slot.type,
      scope: slot.scope,
      region,
      result,
      cpAwards
    }));
  }

  return { resultsByRegion, ledger, entries };
}

/**
 * Initialise a fresh, unplayed SeasonState at slotIndex 0.
 *
 * Nothing is simulated; this is the starting point the UI advances one slot at a
 * time via {@link advanceSeason}. The state's internal `regionalResultsBySlot`
 * cache threads regional results forward so Masters slots can be seeded as they
 * are reached, exactly as `simSeason` did when it ran straight through.
 *
 * @param {object} world  World { leagues, teamsById, playersById } (from buildWorld)
 * @param {number|string} seed  master season seed
 * @returns {SeasonState} frozen, empty
 */
export function initSeason(world, seed) {
  if (!world || typeof world !== 'object' || !world.leagues || !world.teamsById) {
    throw new Error('initSeason: a World { leagues, teamsById, playersById } is required');
  }
  return Object.freeze({
    seed,
    calendar: CALENDAR,
    slotIndex: 0,
    events: Object.freeze([]),
    ledger: createLedger(),
    masters: Object.freeze({}),
    regionalResultsBySlot: Object.freeze({}),
    m2Winner: null,
    championsField: null,
    champion: null,
    complete: false
  });
}

/**
 * Has every calendar slot been played?
 * @param {SeasonState} state
 * @returns {boolean}
 */
export function isSeasonComplete(state) {
  return !!(state && state.complete);
}

/**
 * Advance the season by exactly one calendar slot, returning a NEW immutable
 * SeasonState. Simulating the slot at `state.slotIndex`:
 *   - regional slot => one simEvent per league (4 region-tagged entries), CP
 *     applied region-tagged, the per-region results cached for later Masters
 *     seeding;
 *   - masters slot  => one simEvent seeded by mastersSeedOrder(<feeder results>),
 *     CP applied; the final Masters (m2) winner is remembered;
 *   - champions slot => one simEvent seeded by championsField(ledger, m2Winner),
 *     champion = placement 1; marks the season complete.
 *
 * Per-slot seeds derive identically to `simSeason` (hashSeed off the season seed),
 * so a stepped season is byte-identical to a straight-through one. Calling this on
 * a complete state is a no-op (returns the same state).
 *
 * @param {SeasonState} state
 * @param {object} world  World { leagues, teamsById, playersById }
 * @returns {SeasonState} frozen
 */
export function advanceSeason(state, world) {
  if (!state || typeof state !== 'object') {
    throw new Error('advanceSeason: a SeasonState is required');
  }
  if (!world || typeof world !== 'object' || !world.leagues || !world.teamsById) {
    throw new Error('advanceSeason: a World { leagues, teamsById, playersById } is required');
  }
  if (state.complete || state.slotIndex >= state.calendar.length) {
    return state;
  }

  const seed = state.seed;
  const slot = state.calendar[state.slotIndex];
  const format = FORMAT_BY_ID[slot.formatId];
  if (!format) {
    throw new Error(`advanceSeason: no format descriptor for formatId '${slot.formatId}' (slot '${slot.id}')`);
  }

  // Carry-forward accumulators (copy-on-write).
  let ledger = state.ledger;
  const events = state.events.slice();
  const masters = { ...state.masters };
  const regionalResultsBySlot = { ...state.regionalResultsBySlot };
  let m2Winner = state.m2Winner;
  let champion = state.champion;
  let championsFieldOrder = state.championsField;

  if (slot.scope === 'regional') {
    const ran = runRegionalSlot(slot, format, world, seed, ledger);
    ledger = ran.ledger;
    regionalResultsBySlot[slot.id] = ran.resultsByRegion;
    for (const entry of ran.entries) events.push(entry);
  } else if (slot.type === 'masters') {
    const feeding = regionalResultsBySlot[slot.feedsFrom];
    if (!feeding) {
      throw new Error(`advanceSeason: masters slot '${slot.id}' feedsFrom '${slot.feedsFrom}' which has not run`);
    }
    const seedOrder = mastersSeedOrder(feeding);
    const result = simEvent(
      format,
      {
        eventId: slot.id,
        teamsById: world.teamsById,
        playersById: world.playersById,
        seedOrder
      },
      hashSeed(seed, slot.id)
    );
    const cpAwards = awardCP(result, CP_TABLE);
    ledger = applyCP(ledger, slot.id, null, result, CP_TABLE);
    masters[slot.id] = Object.freeze({ seedOrder });
    events.push(Object.freeze({
      slotId: slot.id,
      type: slot.type,
      scope: slot.scope,
      result,
      cpAwards
    }));
    if (slot.finalMasters) m2Winner = teamAtRank(result, 1);
  } else if (slot.type === 'champions') {
    if (m2Winner == null) {
      throw new Error('advanceSeason: reached Champions before a final Masters (m2) winner was set');
    }
    const seedOrder = championsField(ledger, m2Winner);
    championsFieldOrder = seedOrder;
    const result = simEvent(
      format,
      {
        eventId: slot.id,
        teamsById: world.teamsById,
        playersById: world.playersById,
        seedOrder
      },
      hashSeed(seed, slot.id)
    );
    // Champions awards no CP (CP_TABLE.champions is empty) — apply for history symmetry.
    const cpAwards = awardCP(result, CP_TABLE);
    ledger = applyCP(ledger, slot.id, null, result, CP_TABLE);
    events.push(Object.freeze({
      slotId: slot.id,
      type: slot.type,
      scope: slot.scope,
      result,
      cpAwards
    }));
    champion = teamAtRank(result, 1);
  } else {
    throw new Error(`advanceSeason: unhandled slot type '${slot.type}' (slot '${slot.id}')`);
  }

  const slotIndex = state.slotIndex + 1;
  const complete = slotIndex >= state.calendar.length;

  return Object.freeze({
    seed,
    calendar: state.calendar,
    slotIndex,
    events: Object.freeze(events),
    ledger,
    masters: Object.freeze(masters),
    regionalResultsBySlot: Object.freeze(regionalResultsBySlot),
    m2Winner,
    championsField: championsFieldOrder,
    champion,
    complete
  });
}

/**
 * Build the legacy {@link SeasonResult} shape from a (final) SeasonState. The
 * output is byte-identical to what `simSeason` historically returned for the same
 * seed/world. Safe to call on any state, but only meaningful once complete.
 *
 * @param {SeasonState} state
 * @returns {SeasonResult} frozen
 */
export function seasonToResult(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('seasonToResult: a SeasonState is required');
  }
  const { seed, ledger, masters, championsField: field, champion, events } = state;

  // Final standings: cumulative CP order (teamId tiebreak), champion-aware so the
  // crowned champion is surfaced first regardless of CP.
  const standings = cpStandings(ledger).map((row) => row.teamId);
  const finalStandings = champion
    ? [champion, ...standings.filter((id) => id !== champion)]
    : standings;

  return Object.freeze({
    seasonId: `season-${String(seed)}`,
    seed,
    events: Object.freeze(events.slice()),
    ledger,
    masters: Object.freeze({ ...masters }),
    championsField: Object.freeze(field || []),
    champion,
    finalStandings: Object.freeze(finalStandings)
  });
}

/**
 * Run the whole season straight through and return its {@link SeasonResult}.
 *
 * Defined in terms of the step API — `initSeason` then `advanceSeason` until
 * complete then `seasonToResult` — so the stepped and straight-through paths are
 * provably the same code, and this function's output stays byte-identical to its
 * historical behaviour (tests/season.test.mjs).
 *
 * @param {object} world  World { leagues, teamsById, playersById } (from buildWorld)
 * @param {number|string} seed  master season seed
 * @returns {SeasonResult} frozen
 */
export function simSeason(world, seed) {
  if (!world || typeof world !== 'object' || !world.leagues || !world.teamsById) {
    throw new Error('simSeason: a World { leagues, teamsById, playersById } is required');
  }
  let state = initSeason(world, seed);
  while (!isSeasonComplete(state)) {
    state = advanceSeason(state, world);
  }
  return seasonToResult(state);
}

/**
 * Restore a series' bulky round logs after a log-stripped load. A persisted /
 * exported save may drop `maps[].rounds` (they regenerate from the seed); this
 * re-runs `simSeries` with the series' own seed to rebuild byte-identical maps.
 *
 * If every map already carries `rounds`, the series is returned unchanged. The
 * re-simulated series is deterministic: the same teams + players + bestOf + seed
 * always reproduce the original maps (and box scores, veto, score, winner).
 *
 * @param {object} series  a Series (or SeriesRef with stageId/matchId) from an EventResult
 * @param {object} world   World { teamsById, playersById }
 * @returns {object} the series with `maps[].rounds` present (same reference if already hydrated)
 */
export function hydrateSeries(series, world) {
  if (!series || typeof series !== 'object') {
    throw new Error('hydrateSeries: a Series is required');
  }
  if (!world || typeof world !== 'object' || !world.teamsById) {
    throw new Error('hydrateSeries: a World { teamsById, playersById } is required');
  }

  const maps = Array.isArray(series.maps) ? series.maps : [];
  const needsHydrate =
    maps.length > 0 &&
    maps.some((m) => !m || !Array.isArray(m.rounds) || m.rounds.length === 0);
  if (!needsHydrate) {
    return series;
  }

  const teamA = world.teamsById[series.teamAId];
  const teamB = world.teamsById[series.teamBId];
  if (!teamA || !teamB) {
    throw new Error(
      `hydrateSeries: missing Team object for '${!teamA ? series.teamAId : series.teamBId}'`
    );
  }

  const fresh = simSeries(teamA, teamB, world.playersById, series.bestOf, series.seed);

  // Preserve any SeriesRef tagging (stageId/matchId) the format layer attached,
  // and keep the persisted series' own id/identity; only the maps are restored.
  return Object.freeze({
    ...series,
    maps: fresh.maps
  });
}
