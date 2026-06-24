/**
 * engine/format/standings.js — aggregate Series into per-team records and
 * produce ranked standings tables (round-robin / Swiss). Phase 2.
 *
 * Pure functions, named exports, immutable outputs. No Math.random / Date.now /
 * DOM. Series shapes per CONTRACTS §9: each Series has { teamAId, teamBId,
 * score:{A,B}, winnerId, maps:[{ score:{A,B} }] }. Series W/L are taken from
 * Series.score (map wins); roundDiff sums each map's round score.
 *
 * Ranking uses tiebreakers.compareStandings: map-diff DESC -> round-diff DESC
 * -> head-to-head -> seed ASC.
 */

import { compareStandings } from './tiebreakers.js';

/** @typedef Record { w, l, mapW, mapL, roundDiff } */
/** @typedef Standing { teamId, rank, w, l, mapW, mapL, roundDiff } */

/**
 * Zeroed per-team record.
 * @returns {{ w:number, l:number, mapW:number, mapL:number, roundDiff:number }}
 */
function zeroRecord() {
  return { w: 0, l: 0, mapW: 0, mapL: 0, roundDiff: 0 };
}

/**
 * Aggregate a list of Series into per-team records keyed by teamId.
 *
 * For each Series: the winner gets a series win (w), loser a loss (l); map wins
 * come from Series.score; roundDiff accumulates (own map round score - opponent
 * map round score) summed across every played map. Series whose teams are not
 * both present are still aggregated (records are created on demand).
 *
 * @param {object[]} series  list of Series (CONTRACTS §9)
 * @returns {Record<string, {w:number,l:number,mapW:number,mapL:number,roundDiff:number}>}
 */
export function recordFromSeries(series) {
  /** @type {Record<string, {w:number,l:number,mapW:number,mapL:number,roundDiff:number}>} */
  const records = {};
  const get = (id) => (records[id] || (records[id] = zeroRecord()));

  for (const s of series || []) {
    if (!s || !s.teamAId || !s.teamBId) continue;
    const a = get(s.teamAId);
    const b = get(s.teamBId);

    const aMaps = (s.score && typeof s.score.A === 'number') ? s.score.A : 0;
    const bMaps = (s.score && typeof s.score.B === 'number') ? s.score.B : 0;

    a.mapW += aMaps;
    a.mapL += bMaps;
    b.mapW += bMaps;
    b.mapL += aMaps;

    // Series win/loss from the declared winner (falls back to map score).
    let aWon;
    if (s.winnerId === s.teamAId) aWon = true;
    else if (s.winnerId === s.teamBId) aWon = false;
    else aWon = aMaps > bMaps;
    if (aWon) { a.w += 1; b.l += 1; } else { b.w += 1; a.l += 1; }

    // Round differential: sum each map's round score for each side.
    for (const m of (s.maps || [])) {
      const ra = (m && m.score && typeof m.score.A === 'number') ? m.score.A : 0;
      const rb = (m && m.score && typeof m.score.B === 'number') ? m.score.B : 0;
      a.roundDiff += ra - rb;
      b.roundDiff += rb - ra;
    }
  }
  return records;
}

/**
 * Build the internal sortable rows from records, attaching the 1-based seed
 * (position in teamIds) and a shared series reference for head-to-head.
 * @param {string[]} teamIds  seeded entrants (index 0 => seed 1)
 * @param {Record<string, object>} records
 * @param {object[]} series
 * @returns {object[]}
 */
function buildRows(teamIds, records, series) {
  return teamIds.map((teamId, i) => {
    const r = records[teamId] || zeroRecord();
    return {
      teamId,
      seed: i + 1,
      w: r.w,
      l: r.l,
      mapW: r.mapW,
      mapL: r.mapL,
      roundDiff: r.roundDiff,
      // attached for the comparator only; stripped before returning.
      series
    };
  });
}

/**
 * Strip internal fields and assign final ranks (1-based) over already-sorted
 * rows, producing the clean StageResult.standings shape.
 * @param {object[]} sorted
 * @returns {object[]}
 */
function finalize(sorted) {
  return sorted.map((row, i) => ({
    teamId: row.teamId,
    rank: i + 1,
    w: row.w,
    l: row.l,
    mapW: row.mapW,
    mapL: row.mapL,
    roundDiff: row.roundDiff
  }));
}

/**
 * Round-robin standings: aggregate the series, rank by the tiebreak chain
 * (map-diff -> round-diff -> head-to-head -> seed). Series W/L is the primary
 * ordering signal — more wins ranks higher — with the tiebreak chain resolving
 * equal records.
 *
 * @param {string[]} teamIds  seeded entrants (index 0 => seed 1)
 * @param {object[]} series
 * @returns {object[]} ranked standings (StageResult.standings shape)
 */
export function roundRobinStandings(teamIds, series) {
  const records = recordFromSeries(series);
  const rows = buildRows(teamIds, records, series);
  rows.sort((a, b) => {
    if (b.w !== a.w) return b.w - a.w; // more series wins first
    return compareStandings(a, b);
  });
  return finalize(rows);
}

/**
 * Swiss standings: like round-robin but with a Buchholz tiebreak inserted after
 * series wins — Buchholz = sum of each team's opponents' series wins (strength
 * of schedule). Higher Buchholz ranks higher; remaining ties fall through to
 * the standard chain.
 *
 * @param {string[]} teamIds  seeded entrants (index 0 => seed 1)
 * @param {object[]} series
 * @param {Record<string, object>} [records]  optional precomputed records
 * @returns {object[]} ranked standings incl. Buchholz-aware ordering
 */
export function swissStandings(teamIds, series, records) {
  const recs = records || recordFromSeries(series);
  const buchholz = computeBuchholz(teamIds, series, recs);
  const rows = buildRows(teamIds, recs, series).map((row) => ({
    ...row,
    buchholz: buchholz[row.teamId] || 0
  }));
  rows.sort((a, b) => {
    if (b.w !== a.w) return b.w - a.w; // more series wins first
    if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz; // stronger SoS
    return compareStandings(a, b);
  });
  return finalize(rows);
}

/**
 * Buchholz score per team = sum of the series-win counts of every opponent it
 * faced (counted once per series played against that opponent).
 *
 * @param {string[]} teamIds
 * @param {object[]} series
 * @param {Record<string, object>} records
 * @returns {Record<string, number>}
 */
export function computeBuchholz(teamIds, series, records) {
  const wins = (id) => (records[id] ? records[id].w : 0);
  /** @type {Record<string, number>} */
  const out = {};
  for (const id of teamIds) out[id] = 0;
  for (const s of series || []) {
    if (!s || !s.teamAId || !s.teamBId) continue;
    if (s.teamAId in out) out[s.teamAId] += wins(s.teamBId);
    if (s.teamBId in out) out[s.teamBId] += wins(s.teamAId);
  }
  return out;
}
