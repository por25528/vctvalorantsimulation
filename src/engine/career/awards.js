/**
 * engine/career/awards.js — end-of-season awards (CONTRACTS-POLISH §1). Phase 7a.
 *
 * PURE & deterministic: same (season, world) → identical awards. No rng, no Date,
 * no DOM, inputs never mutated, outputs frozen. Awards are read off the season's
 * box scores (which survive log-stripping — only `rounds[]` are stripped, the
 * per-map `boxScore` totals remain), so they recompute identically after a
 * save/load and never touch the pure season engine.
 *
 * A player's RATING is their mean ACS across the maps they played, gated by a
 * minimum sample (BALANCE.CAREER.AWARDS.MIN_MAPS) so a two-map cameo can't outrank
 * a full deep run. Ranking tiebreak is fully ordered: rating desc, maps desc,
 * kills desc, playerId asc.
 *
 * @typedef {Object} AwardWinner
 * @property {string} playerId
 * @property {string|null} teamId
 * @property {string} handle
 * @property {string|null} role
 * @property {number|null} age
 * @property {number} maps
 * @property {number} kills
 * @property {number} acs        // mean ACS (rounded, display)
 * @property {number} rating     // mean ACS (full precision, ranking)
 *
 * @typedef {Object} SeasonAwards
 * @property {AwardWinner|null} mvp
 * @property {AwardWinner|null} finalsMvp
 * @property {AwardWinner|null} rookieOfYear
 * @property {AwardWinner[]} allProFirst
 * @property {AwardWinner[]} allProSecond
 * @property {Record<string, AwardWinner|null>} regionMvps
 */

import { BALANCE } from '../../config/balance.js';
import { REGION_ORDER } from './qualification.js';

const A = BALANCE.CAREER.AWARDS;

/** Round to two decimals for stable display. */
function round2(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}

/**
 * Aggregate per-player box-score totals across a list of SeasonEventEntry.
 * @param {Array<object>} events  SeasonEventEntry[] (each with .result.series[].maps[].boxScore)
 * @returns {Map<string, {playerId:string, maps:number, kills:number, deaths:number, assists:number, acsSum:number}>}
 */
export function aggregatePlayerStats(events) {
  /** @type {Map<string, {playerId:string, maps:number, kills:number, deaths:number, assists:number, acsSum:number}>} */
  const agg = new Map();
  for (const entry of events || []) {
    const result = entry && entry.result;
    for (const series of (result && result.series) || []) {
      for (const map of series.maps || []) {
        const box = (map && map.boxScore) || {};
        for (const pid of Object.keys(box)) {
          const s = box[pid] || {};
          let a = agg.get(pid);
          if (!a) {
            a = { playerId: pid, maps: 0, kills: 0, deaths: 0, assists: 0, acsSum: 0 };
            agg.set(pid, a);
          }
          a.maps += 1;
          a.kills += s.kills || 0;
          a.deaths += s.deaths || 0;
          a.assists += s.assists || 0;
          a.acsSum += s.acs || 0;
        }
      }
    }
  }
  return agg;
}

/** Build a frozen AwardWinner from an aggregate row + the world (for identity). */
function toWinner(a, world) {
  const rating = a.maps > 0 ? a.acsSum / a.maps : 0;
  const p = world.playersById[a.playerId];
  return Object.freeze({
    playerId: a.playerId,
    teamId: (p && p.contract && p.contract.teamId) || null,
    handle: p ? (p.handle || p.name) : a.playerId,
    role: p ? p.role : null,
    age: p && typeof p.age === 'number' ? p.age : null,
    maps: a.maps,
    kills: a.kills,
    acs: round2(rating),
    rating
  });
}

/** Total order over winners: rating desc, maps desc, kills desc, playerId asc. */
function cmpWinner(x, y) {
  return (
    y.rating - x.rating ||
    y.maps - x.maps ||
    y.kills - x.kills ||
    (x.playerId < y.playerId ? -1 : x.playerId > y.playerId ? 1 : 0)
  );
}

/**
 * Aggregate + rank the QUALIFIED winners (maps >= MIN_MAPS) over a set of events.
 * @param {Array<object>} events
 * @param {object} world  { playersById }
 * @returns {AwardWinner[]} rating-ordered, qualified only
 */
function rankWinners(events, world) {
  const agg = aggregatePlayerStats(events);
  const rows = [];
  for (const a of agg.values()) {
    if (a.maps < A.MIN_MAPS) continue;
    rows.push(toWinner(a, world));
  }
  rows.sort(cmpWinner);
  return rows;
}

/** An all-null awards object (no qualified players / empty season). */
function emptyAwards() {
  const regionMvps = {};
  for (const r of REGION_ORDER) regionMvps[r] = null;
  return Object.freeze({
    mvp: null,
    finalsMvp: null,
    rookieOfYear: null,
    allProFirst: Object.freeze([]),
    allProSecond: Object.freeze([]),
    regionMvps: Object.freeze(regionMvps)
  });
}

/**
 * Compute the awards for a season from its box scores. Pure & deterministic.
 *
 * @param {object} season  SeasonState | SeasonResult (anything with `events[]`)
 * @param {object} world   World { playersById, teamsById, leagues }
 * @returns {SeasonAwards} frozen
 */
export function computeSeasonAwards(season, world) {
  if (!season || !world || !world.playersById) return emptyAwards();
  const events = Array.isArray(season.events) ? season.events : [];

  const ranked = rankWinners(events, world);
  const finals = rankWinners(events.filter((e) => e && e.type === 'champions'), world);

  const regionMvps = {};
  for (const r of REGION_ORDER) {
    const regionRanked = rankWinners(
      events.filter((e) => e && e.scope === 'regional' && e.region === r),
      world
    );
    regionMvps[r] = regionRanked[0] || null;
  }

  const size = A.ALL_PRO_SIZE;
  return Object.freeze({
    mvp: ranked[0] || null,
    finalsMvp: finals[0] || null,
    rookieOfYear: ranked.find((w) => w.age != null && w.age <= A.ROOKIE_MAX_AGE) || null,
    allProFirst: Object.freeze(ranked.slice(0, size)),
    allProSecond: Object.freeze(ranked.slice(size, size * 2)),
    regionMvps: Object.freeze(regionMvps)
  });
}
