/**
 * ui/legacyDerive.js — pure presentation maths over the player-legacy ledger
 * (Wave 2 E). Builds the view-models for the Life Story / Career screen and the
 * All-Time Players leaderboard from the banked `state.career.playerLegacy`.
 *
 * No DOM, no randomness, no `Date`. Every derivation is robust to empty / early
 * worlds: a player with no banked seasons yields a structured-empty story, and
 * the leaderboards return `[]` rather than crashing or emitting NaN.
 */

import { BALANCE } from '../config/balance.js';
import { careerAcs, careerKd } from '../engine/career/playerLegacy.js';

const L = BALANCE.CAREER.LEGACY;

const round0 = (x) => (Number.isFinite(x) ? Math.round(x) : 0);
const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);

/* ------------------------------ era / arc -------------------------------- */

/**
 * A coarse achievement tier ("era tag") for a player's whole career — the
 * headline badge on the Life Story screen.
 * @param {object} rec
 * @returns {{key:string, label:string}}
 */
export function eraTag(rec) {
  if (!rec) return { key: 'unknown', label: 'Unknown' };
  const decorated = rec.allProFirst + rec.mvps + rec.finalsMvps;
  if (rec.titles >= 3 || rec.mvps >= 3) return { key: 'legend', label: 'Legend' };
  if (rec.titles >= 1 || rec.mvps >= 1 || rec.allProFirst >= 1) return { key: 'star', label: 'Superstar' };
  if (decorated >= 1 || rec.eventTitles >= 1) return { key: 'pro', label: 'Decorated Pro' };
  if (rec.seasonsPlayed >= 8) return { key: 'veteran', label: 'Veteran' };
  if (rec.seasonsPlayed <= 1) return { key: 'prospect', label: 'Prospect' };
  return { key: 'journeyman', label: 'Journeyman' };
}

/**
 * Split a career into rise → peak → decline phases off the per-season overall
 * trajectory (anchored on the recorded peak-overall season). Returns one entry
 * per non-empty phase, each with the season span and a narrated line.
 * @param {object} rec
 * @returns {Array<{key:string, label:string, from:number, to:number, text:string}>}
 */
export function careerArc(rec) {
  const seasons = (rec && rec.seasons) || [];
  if (!seasons.length) return [];
  const peakIdx = peakSeasonPos(seasons);
  const phases = [];

  const rise = seasons.slice(0, peakIdx);
  const peak = seasons[peakIdx];
  const decline = seasons.slice(peakIdx + 1);

  if (rise.length) {
    phases.push({
      key: 'rise',
      label: 'The Rise',
      from: rise[0].seasonIndex,
      to: rise[rise.length - 1].seasonIndex,
      text: `Broke in at ${ageLabel(rise[0])} and climbed from ${round0(rise[0].overall)} to ${round0(rise[rise.length - 1].overall)} overall across ${rise.length} season${rise.length === 1 ? '' : 's'}.`
    });
  }
  if (peak) {
    phases.push({
      key: 'peak',
      label: 'Peak',
      from: peak.seasonIndex,
      to: peak.seasonIndex,
      text: `Hit their ceiling in Season ${peak.seasonIndex} — ${round0(peak.overall)} overall, ${round0(peak.acs)} ACS over ${peak.maps} maps${peak.mvp ? ', and took Season MVP' : ''}.`
    });
  }
  if (decline.length) {
    const last = decline[decline.length - 1];
    phases.push({
      key: 'decline',
      label: 'The Long Tail',
      from: decline[0].seasonIndex,
      to: last.seasonIndex,
      text: `Eased down to ${round0(last.overall)} overall by Season ${last.seasonIndex}, still logging ${decline.reduce((s, x) => s + x.maps, 0)} more maps.`
    });
  }
  return phases;
}

/** The array index of the season with the highest overall (ties → earliest). */
function peakSeasonPos(seasons) {
  let best = 0;
  for (let i = 1; i < seasons.length; i += 1) {
    if (seasons[i].overall > seasons[best].overall) best = i;
  }
  return best;
}

/** A small age phrase for a season row ("age 18" / "a rookie"). */
function ageLabel(s) {
  return s && typeof s.age === 'number' ? `age ${s.age}` : 'a newcomer';
}

/* --------------------------- player life story --------------------------- */

/**
 * The full Life Story view-model for one player's banked record. Returns a
 * structured-empty shape (with `hasHistory:false`) when the player has no banked
 * seasons yet, so the screen can show an empty state without crashing.
 * @param {object|null} rec  a PlayerLegacy record (or null)
 * @returns {object}
 */
export function derivePlayerStory(rec) {
  if (!rec) {
    return {
      hasHistory: false,
      totals: emptyTotals(),
      trophies: emptyTrophies(),
      milestones: [],
      arc: [],
      era: { key: 'unknown', label: 'No history yet' },
      seasons: []
    };
  }
  return {
    hasHistory: (rec.seasons || []).length > 0,
    handle: rec.handle,
    name: rec.name,
    role: rec.role,
    nationality: rec.nationality,
    firstSeason: rec.firstSeason,
    lastSeason: rec.lastSeason,
    totals: {
      seasonsPlayed: rec.seasonsPlayed,
      maps: rec.maps,
      series: rec.series,
      kills: rec.kills,
      deaths: rec.deaths,
      assists: rec.assists,
      acs: round2(careerAcs(rec)),
      kd: round2(careerKd(rec)),
      peakAcs: round2(rec.peakAcs),
      peakAcsSeason: rec.peakAcsSeason,
      peakOverall: round0(rec.peakOverall),
      peakOverallSeason: rec.peakOverallSeason
    },
    trophies: {
      titles: rec.titles,
      eventTitles: rec.eventTitles,
      mvps: rec.mvps,
      finalsMvps: rec.finalsMvps,
      allProFirst: rec.allProFirst,
      allProSecond: rec.allProSecond,
      rookieOfYear: rec.rookieOfYear,
      regionMvps: rec.regionMvps
    },
    // Milestones newest-first for the timeline.
    milestones: [...(rec.milestones || [])].reverse(),
    arc: careerArc(rec),
    era: eraTag(rec),
    seasons: rec.seasons || []
  };
}

function emptyTotals() {
  return { seasonsPlayed: 0, maps: 0, series: 0, kills: 0, deaths: 0, assists: 0, acs: 0, kd: 0, peakAcs: 0, peakAcsSeason: null, peakOverall: 0, peakOverallSeason: null };
}
function emptyTrophies() {
  return { titles: 0, eventTitles: 0, mvps: 0, finalsMvps: 0, allProFirst: 0, allProSecond: 0, rookieOfYear: 0, regionMvps: 0 };
}

/* --------------------------- all-time leaders ---------------------------- */

/** The available leaderboard boards (id + label + the stat they rank on). */
export const ALLTIME_BOARDS = Object.freeze([
  { id: 'titles', label: 'Most Titles' },
  { id: 'mvps', label: 'Most MVPs' },
  { id: 'acs', label: 'Career ACS' },
  { id: 'kd', label: 'Career K-D' },
  { id: 'maps', label: 'Most Maps' },
  { id: 'events', label: 'Events Won' }
]);

/** Total order helpers: rank by `value` desc, then tiebreakers, then id asc. */
function byValue(a, b) {
  return b.value - a.value || (b.tie || 0) - (a.tie || 0) || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);
}

/**
 * Build one All-Time Players leaderboard. Stat boards (ACS / K-D) gate on a
 * minimum career maps sample so a two-map cameo can't top the table.
 * @param {{players:Record<string,object>}} legacy
 * @param {string} boardId  one of ALLTIME_BOARDS ids
 * @param {{limit?:number, minMaps?:number}} [opts]
 * @returns {Array<{playerId:string, handle:string, role:string|null, value:number, sub:string}>}
 */
export function deriveAllTime(legacy, boardId, opts = {}) {
  const players = (legacy && legacy.players) || {};
  const limit = opts.limit || L.LEADERBOARD_SIZE;
  const minMaps = opts.minMaps != null ? opts.minMaps : L.MIN_LEADERBOARD_MAPS;
  const recs = Object.values(players);
  const rows = [];

  for (const r of recs) {
    let value;
    let tie = 0;
    let sub = '';
    switch (boardId) {
      case 'mvps':
        value = r.mvps;
        tie = r.finalsMvps;
        sub = `${r.finalsMvps} Finals MVP · ${r.allProFirst} All-Pro 1st`;
        break;
      case 'acs':
        if (r.maps < minMaps) continue;
        value = round2(careerAcs(r));
        tie = r.maps;
        sub = `${r.maps} maps`;
        break;
      case 'kd':
        if (r.maps < minMaps) continue;
        value = round2(careerKd(r));
        tie = r.maps;
        sub = `${r.kills}/${r.deaths} over ${r.maps} maps`;
        break;
      case 'maps':
        value = r.maps;
        tie = r.seasonsPlayed;
        sub = `${r.seasonsPlayed} seasons · ${r.series} series`;
        break;
      case 'events':
        value = r.eventTitles;
        tie = r.titles;
        sub = `${r.titles} World${r.titles === 1 ? '' : 's'}`;
        break;
      case 'titles':
      default:
        value = r.titles;
        tie = r.mvps;
        sub = `${r.mvps} MVP · ${r.eventTitles} events`;
        break;
    }
    if (!value) continue; // drop empty rows (0 titles, 0 mvps, …)
    rows.push({ playerId: r.playerId, handle: r.handle, role: r.role, value, tie, sub });
  }
  rows.sort(byValue);
  return rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }));
}

/**
 * A compact headline summary of the whole ledger for the screen's hero strip:
 * how many players are tracked, the most-decorated player, and the seasons banked.
 * @param {{players:Record<string,object>, seasonsBanked:number}} legacy
 * @returns {{tracked:number, seasonsBanked:number, mostTitles:object|null, mostMaps:object|null}}
 */
export function deriveLegacySummary(legacy) {
  const titles = deriveAllTime(legacy, 'titles', { limit: 1 });
  const maps = deriveAllTime(legacy, 'maps', { limit: 1 });
  return {
    tracked: Object.keys((legacy && legacy.players) || {}).length,
    seasonsBanked: (legacy && legacy.seasonsBanked) || 0,
    mostTitles: titles[0] || null,
    mostMaps: maps[0] || null
  };
}
