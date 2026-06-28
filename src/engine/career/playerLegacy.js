/**
 * engine/career/playerLegacy.js — persistent per-player CAREER MEMORY
 * (Wave 2, workstream E — "the Characters").
 *
 * A pure season-boundary ACCUMULATOR. As each season completes, the career layer
 * banks every player's totals from that year's box scores + the season's awards
 * and event winners into a growing legacy ledger. This is the only home for a
 * player's cross-season arc: championships, MVPs/awards, maps & series played,
 * aggregate career stats, milestones, and where their PEAK fell — all of which
 * outlive the live season (whose events are reset every new year) and even the
 * player's career (retired players stay in the ledger forever).
 *
 * DETERMINISM is sacred: this is a READ-AGGREGATE over the frozen history ledger
 * and completed-season box scores. No rng (zero stream draws), no `Date`, no DOM;
 * inputs are never mutated and every output is frozen. It lives in the EVOLVING
 * career layer (not the pure match/format/season engines), so match results stay
 * byte-identical — `accumulateSeason` only ever READS the season it is handed.
 *
 * Banked shape (additive on `state.career.playerLegacy`):
 *   { players: Record<playerId, PlayerLegacy>, seasonsBanked: number }
 *
 * @typedef {Object} LegacySeason   one completed season for one player
 * @property {number} seasonIndex
 * @property {number} maps
 * @property {number} series
 * @property {number} acs        // mean ACS that season (1dp)
 * @property {number} kd         // K-D ratio that season (2dp)
 * @property {number} kills
 * @property {number} deaths
 * @property {number} assists
 * @property {number} overall    // player overall at season end (1dp)
 * @property {number|null} age
 * @property {string|null} teamId
 * @property {boolean} worldTitle
 * @property {number} eventTitles
 * @property {boolean} mvp
 * @property {boolean} finalsMvp
 * @property {boolean} allProFirst
 * @property {boolean} allProSecond
 * @property {boolean} rookieOfYear
 * @property {boolean} regionMvp
 *
 * @typedef {Object} LegacyMilestone
 * @property {number} season
 * @property {string} kind
 * @property {string} label
 *
 * @typedef {Object} PlayerLegacy
 * @property {string} playerId
 * @property {string} handle
 * @property {string} name
 * @property {string|null} role
 * @property {string|null} nationality
 * @property {number} firstSeason
 * @property {number} lastSeason
 * @property {number} seasonsPlayed
 * @property {number} maps
 * @property {number} series
 * @property {number} kills
 * @property {number} deaths
 * @property {number} assists
 * @property {number} acsSum
 * @property {number} titles        // world championships
 * @property {number} eventTitles   // total events won (any tier)
 * @property {number} mvps
 * @property {number} finalsMvps
 * @property {number} allProFirst
 * @property {number} allProSecond
 * @property {number} rookieOfYear
 * @property {number} regionMvps
 * @property {number} mvpStreak     // current consecutive-MVP streak
 * @property {number} peakAcs
 * @property {number|null} peakAcsSeason
 * @property {number} peakOverall
 * @property {number|null} peakOverallSeason
 * @property {LegacySeason[]} seasons
 * @property {LegacyMilestone[]} milestones
 */

import { BALANCE } from '../../config/balance.js';
import { aggregatePlayerStats } from './awards.js';
import { overall } from './playerStats.js';

const L = BALANCE.CAREER.LEGACY;

/* ------------------------------- helpers --------------------------------- */

const round1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

/** A frozen, empty legacy ledger (the default for fresh / legacy saves). */
export function emptyLegacy() {
  return Object.freeze({ players: Object.freeze({}), seasonsBanked: 0 });
}

/** Normalize any (possibly legacy / null) banked value to a usable ledger. */
function asLedger(legacy) {
  if (!legacy || typeof legacy !== 'object' || !legacy.players) return { players: {}, seasonsBanked: 0 };
  return { players: legacy.players, seasonsBanked: legacy.seasonsBanked || 0 };
}

/** A fresh blank record for a player first seen this season. */
function newRecord(pid, p, seasonIndex) {
  return {
    playerId: pid,
    handle: p ? (p.handle || p.name || pid) : pid,
    name: p ? (p.name || '') : '',
    role: p ? (p.role || null) : null,
    nationality: p ? (p.nationality || null) : null,
    firstSeason: seasonIndex,
    lastSeason: seasonIndex,
    seasonsPlayed: 0,
    maps: 0,
    series: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    acsSum: 0,
    titles: 0,
    eventTitles: 0,
    mvps: 0,
    finalsMvps: 0,
    allProFirst: 0,
    allProSecond: 0,
    rookieOfYear: 0,
    regionMvps: 0,
    mvpStreak: 0,
    peakAcs: 0,
    peakAcsSeason: null,
    peakOverall: 0,
    peakOverallSeason: null,
    seasons: [],
    milestones: []
  };
}

/** The set of player ids who appeared in any box score of an event. */
function eventParticipants(ev) {
  const set = new Set();
  for (const s of (ev && ev.result && ev.result.series) || []) {
    for (const m of s.maps || []) {
      for (const pid of Object.keys((m && m.boxScore) || {})) set.add(pid);
    }
  }
  return set;
}

/** The rank-1 teamId of an event entry, or null. */
function eventWinner(ev) {
  const placements = ev && ev.result && ev.result.placements;
  const top = Array.isArray(placements) ? placements.find((p) => p && p.rank === 1) : null;
  return top ? top.teamId : null;
}

/**
 * Per-player titles earned THIS season: total events won (rostered on the winner
 * AND appeared in its box scores) and whether they won the world title (the
 * `champions` event).
 * @returns {Map<string,{events:number, world:number}>}
 */
function titlesThisSeason(season, world) {
  /** @type {Map<string,{events:number, world:number}>} */
  const out = new Map();
  const teamsById = (world && world.teamsById) || {};
  for (const ev of (season && season.events) || []) {
    const winner = eventWinner(ev);
    if (!winner) continue;
    const roster = new Set((teamsById[winner] && teamsById[winner].roster) || []);
    const isWorld = ev.type === 'champions';
    for (const pid of eventParticipants(ev)) {
      if (!roster.has(pid)) continue;
      const t = out.get(pid) || { events: 0, world: 0 };
      t.events += 1;
      if (isWorld) t.world += 1;
      out.set(pid, t);
    }
  }
  return out;
}

/** Per-player count of series they appeared in this season. */
function seriesThisSeason(season) {
  /** @type {Map<string,number>} */
  const out = new Map();
  for (const ev of (season && season.events) || []) {
    for (const s of (ev.result && ev.result.series) || []) {
      const set = new Set();
      for (const m of s.maps || []) {
        for (const pid of Object.keys((m && m.boxScore) || {})) set.add(pid);
      }
      for (const pid of set) out.set(pid, (out.get(pid) || 0) + 1);
    }
  }
  return out;
}

/** Per-player award credits this season, keyed by playerId. */
function awardsThisSeason(awards) {
  /** @type {Map<string,{mvp:number, finalsMvp:number, roy:number, allPro1:number, allPro2:number, regionMvp:number}>} */
  const out = new Map();
  const bump = (pid, key) => {
    if (!pid) return;
    const e = out.get(pid) || { mvp: 0, finalsMvp: 0, roy: 0, allPro1: 0, allPro2: 0, regionMvp: 0 };
    e[key] += 1;
    out.set(pid, e);
  };
  const aw = awards || {};
  if (aw.mvp) bump(aw.mvp.playerId, 'mvp');
  if (aw.finalsMvp) bump(aw.finalsMvp.playerId, 'finalsMvp');
  if (aw.rookieOfYear) bump(aw.rookieOfYear.playerId, 'roy');
  for (const w of aw.allProFirst || []) bump(w.playerId, 'allPro1');
  for (const w of aw.allProSecond || []) bump(w.playerId, 'allPro2');
  for (const r of Object.keys(aw.regionMvps || {})) {
    const w = aw.regionMvps[r];
    if (w) bump(w.playerId, 'regionMvp');
  }
  return out;
}

/** Milestones minted by crossing a threshold between the before/after record. */
function newMilestones(before, after, seasonIndex) {
  const ms = [];
  const push = (kind, label) => ms.push(Object.freeze({ season: seasonIndex, kind, label }));
  const crossed = (thr, b, a) => b < thr && a >= thr;
  for (const n of L.TITLE_MILESTONES) {
    if (crossed(n, before.titles, after.titles)) push('title', n === 1 ? 'World Champion' : `${n}× World Champion`);
  }
  for (const n of L.EVENT_TITLE_MILESTONES) {
    if (crossed(n, before.eventTitles, after.eventTitles)) push('eventTitle', `${n} events won`);
  }
  for (const n of L.MVP_MILESTONES) {
    if (crossed(n, before.mvps, after.mvps)) push('mvp', n === 1 ? 'First Season MVP' : `${n}× Season MVP`);
  }
  if (after.mvpStreak >= L.MVP_STREAK && before.mvpStreak < L.MVP_STREAK) {
    push('streak', `MVP ${L.MVP_STREAK} years running`);
  }
  for (const n of L.MAP_MILESTONES) {
    if (crossed(n, before.maps, after.maps)) push('maps', `${n} maps played`);
  }
  for (const n of L.SEASON_MILESTONES) {
    if (crossed(n, before.seasonsPlayed, after.seasonsPlayed)) push('longevity', `${n} seasons played`);
  }
  return ms;
}

/* ----------------------------- accumulation ------------------------------ */

/**
 * Bank one completed season into the legacy ledger. PURE: returns a new frozen
 * ledger; `legacy`, `season`, and `world` are never mutated. Consumes NO rng.
 *
 * @param {object|null} legacy   the prior banked ledger (null / legacy-save safe)
 * @param {object} season        the completed SeasonState (box scores live here)
 * @param {object} summary       the SeasonSummary { seasonIndex, awards, ... }
 * @param {object} world         end-of-season World { teamsById, playersById }
 * @returns {{players:Record<string,object>, seasonsBanked:number}} frozen
 */
export function accumulateSeason(legacy, season, summary, world) {
  const base = asLedger(legacy);
  if (!season || !summary || !world) return Object.freeze({ players: Object.freeze({ ...base.players }), seasonsBanked: base.seasonsBanked });

  const seasonIndex = typeof summary.seasonIndex === 'number' ? summary.seasonIndex : base.seasonsBanked;
  const agg = aggregatePlayerStats(season.events || []);
  const titles = titlesThisSeason(season, world);
  const series = seriesThisSeason(season);
  const awards = awardsThisSeason(summary.awards);
  const playersById = (world && world.playersById) || {};

  // Everyone who touched the season: played a map, won a title, or won an award.
  const pids = new Set();
  for (const pid of agg.keys()) pids.add(pid);
  for (const pid of titles.keys()) pids.add(pid);
  for (const pid of awards.keys()) pids.add(pid);

  const players = { ...base.players };
  for (const pid of pids) {
    const a = agg.get(pid) || { maps: 0, kills: 0, deaths: 0, assists: 0, acsSum: 0 };
    const tt = titles.get(pid) || { events: 0, world: 0 };
    const cr = awards.get(pid) || { mvp: 0, finalsMvp: 0, roy: 0, allPro1: 0, allPro2: 0, regionMvp: 0 };
    const seriesCount = series.get(pid) || 0;
    const p = playersById[pid] || null;

    const before = players[pid] || newRecord(pid, p, seasonIndex);
    const rec = { ...before, seasons: before.seasons, milestones: before.milestones };

    // Refresh identity from the live world (handles a re-handle / role change).
    if (p) {
      rec.handle = p.handle || p.name || pid;
      rec.name = p.name || rec.name;
      rec.role = p.role || rec.role;
      rec.nationality = p.nationality || rec.nationality;
    }
    rec.lastSeason = seasonIndex;

    const seasonAcs = a.maps > 0 ? a.acsSum / a.maps : 0;
    const seasonKd = a.deaths > 0 ? a.kills / a.deaths : a.kills;
    const ovr = p ? overall(p) : 0;
    const age = p && typeof p.age === 'number' ? p.age : null;
    const teamId = p && p.contract ? p.contract.teamId || null : null;

    if (a.maps > 0) rec.seasonsPlayed = before.seasonsPlayed + 1;
    rec.maps = before.maps + a.maps;
    rec.series = before.series + seriesCount;
    rec.kills = before.kills + a.kills;
    rec.deaths = before.deaths + a.deaths;
    rec.assists = before.assists + a.assists;
    rec.acsSum = before.acsSum + a.acsSum;
    rec.titles = before.titles + tt.world;
    rec.eventTitles = before.eventTitles + tt.events;
    rec.mvps = before.mvps + cr.mvp;
    rec.finalsMvps = before.finalsMvps + cr.finalsMvp;
    rec.rookieOfYear = before.rookieOfYear + cr.roy;
    rec.allProFirst = before.allProFirst + cr.allPro1;
    rec.allProSecond = before.allProSecond + cr.allPro2;
    rec.regionMvps = before.regionMvps + cr.regionMvp;
    rec.mvpStreak = cr.mvp > 0 ? before.mvpStreak + 1 : 0;

    if (a.maps >= L.MIN_PEAK_MAPS && seasonAcs > before.peakAcs) {
      rec.peakAcs = round1(seasonAcs);
      rec.peakAcsSeason = seasonIndex;
    }
    if (ovr > before.peakOverall) {
      rec.peakOverall = round1(ovr);
      rec.peakOverallSeason = seasonIndex;
    }

    rec.seasons = [
      ...before.seasons,
      Object.freeze({
        seasonIndex,
        maps: a.maps,
        series: seriesCount,
        acs: round1(seasonAcs),
        kd: round2(seasonKd),
        kills: a.kills,
        deaths: a.deaths,
        assists: a.assists,
        overall: round1(ovr),
        age,
        teamId,
        worldTitle: tt.world > 0,
        eventTitles: tt.events,
        mvp: cr.mvp > 0,
        finalsMvp: cr.finalsMvp > 0,
        allProFirst: cr.allPro1 > 0,
        allProSecond: cr.allPro2 > 0,
        rookieOfYear: cr.roy > 0,
        regionMvp: cr.regionMvp > 0
      })
    ];
    rec.milestones = [...before.milestones, ...newMilestones(before, rec, seasonIndex)];

    players[pid] = Object.freeze({ ...rec, seasons: Object.freeze(rec.seasons), milestones: Object.freeze(rec.milestones) });
  }

  return Object.freeze({ players: Object.freeze(players), seasonsBanked: base.seasonsBanked + 1 });
}

/* ----------------------------- derived stats ----------------------------- */

/** Career mean ACS (acsSum / maps), 0 for a player with no maps. */
export function careerAcs(rec) {
  return rec && rec.maps > 0 ? rec.acsSum / rec.maps : 0;
}

/** Career K-D ratio (kills / deaths), falling back to kills when deaths === 0. */
export function careerKd(rec) {
  if (!rec) return 0;
  return rec.deaths > 0 ? rec.kills / rec.deaths : rec.kills;
}
