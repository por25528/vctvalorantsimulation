/**
 * engine/career/ranking.js — a global team WORLD RANKING (Elo rating across all
 * 48 teams and all 4 regions). PURE + deterministic (no rng / Date / DOM).
 *
 * Each team starts from a roster-strength-seeded Elo, then every played series
 * updates the two teams' ratings the standard Elo way — the winner takes points
 * from the loser, scaled by the expected result (a favourite beating a minnow
 * gains little; an upset swings a lot) and by the map margin. International events
 * (Masters/Champions) let regions trade points directly, so the ranking is a true
 * cross-region table — exactly like an HLTV/VLR world ranking.
 */

import { overall } from './playerStats.js';
import { ratePlayersOverSeries } from './rating.js';

/** Tuning. */
const BASE = 1500; // starting Elo
const SEED_SCALE = 22; // rating points per (team overall − league mean)
const K_BASE = 30; // Elo K-factor (points at stake per series)
const MARGIN_K = 0.18; // extra K per map of winning margin beyond 1

/** Mean overall of a team's first five (the lineup the match engine fields). */
function teamStrength(world, teamId) {
  const team = world.teamsById[teamId];
  if (!team) return 0;
  const ovr = (team.roster || [])
    .slice(0, 5)
    .map((pid) => overall(world.playersById[pid]))
    .filter((n) => Number.isFinite(n));
  return ovr.length ? ovr.reduce((a, b) => a + b, 0) / ovr.length : 0;
}

/**
 * Compute the world ranking from a world + a chronological series list.
 *
 * @param {object} world  World { leagues, teamsById, playersById }
 * @param {Array<object>} series  SeriesRef[] in play order (teamAId/teamBId/winnerId/score)
 * @returns {Array<{teamId:string, rating:number, rank:number, region:string|null, regionRank:number, w:number, l:number}>}
 */
export function computeRankings(world, series) {
  const teamIds = Object.keys((world && world.teamsById) || {});
  const leagues = (world && world.leagues) || {};

  const regionByTeam = {};
  for (const region of Object.keys(leagues)) {
    for (const id of (leagues[region] && leagues[region].teamIds) || []) regionByTeam[id] = region;
  }

  // Seed each team's Elo from its roster strength relative to the league mean.
  const strength = {};
  let sum = 0;
  for (const id of teamIds) {
    strength[id] = teamStrength(world, id);
    sum += strength[id];
  }
  const mean = teamIds.length ? sum / teamIds.length : 0;

  const rating = {};
  const w = {};
  const l = {};
  for (const id of teamIds) {
    rating[id] = BASE + (strength[id] - mean) * SEED_SCALE;
    w[id] = 0;
    l[id] = 0;
  }

  // Replay every series as an Elo update.
  for (const s of series || []) {
    const a = s && s.teamAId;
    const b = s && s.teamBId;
    if (rating[a] === undefined || rating[b] === undefined) continue;
    const expA = 1 / (1 + Math.pow(10, (rating[b] - rating[a]) / 400));
    const aWon = s.winnerId === a;
    const scoreA = aWon ? 1 : 0;
    const margin = Math.abs(((s.score && s.score.A) || 0) - ((s.score && s.score.B) || 0));
    const k = K_BASE * (1 + MARGIN_K * Math.max(0, margin - 1));
    rating[a] += k * (scoreA - expA);
    rating[b] += k * ((1 - scoreA) - (1 - expA));
    if (aWon) {
      w[a] += 1;
      l[b] += 1;
    } else {
      w[b] += 1;
      l[a] += 1;
    }
  }

  const rows = teamIds
    .map((id) => ({
      teamId: id,
      rating: Math.round(rating[id]),
      region: regionByTeam[id] || null,
      w: w[id],
      l: l[id]
    }))
    .sort((x, y) => y.rating - x.rating || String(x.teamId).localeCompare(String(y.teamId)));

  const regionCount = {};
  rows.forEach((r, i) => {
    r.rank = i + 1;
    if (r.region) {
      regionCount[r.region] = (regionCount[r.region] || 0) + 1;
      r.regionRank = regionCount[r.region];
    } else {
      r.regionRank = 0;
    }
  });

  return rows;
}

/* ----------------------- global PLAYER ranking ----------------------- */

/** Player global-rating tuning. */
const PLAYER = Object.freeze({
  RATING2_SCALE: 40, // rating points per (Rating 2.0 − 1.0): a 1.20 season adds +8
  APPEARANCE_K: 0.3, // points per map played — deep title runs & longevity (capped)
  APPEARANCE_CAP: 30 // map-count contribution caps here (a long run, not infinite farm)
});

/**
 * A per-season-evolving GLOBAL PLAYER RANKING over the rostered pro pool. Pure +
 * deterministic. It is RESULTS-BASED: a player's base ability (overall) is lifted
 * by their actual Rating 2.0 across the season's series (so stars on deep-running,
 * better-built teams — who play more high-rated maps — climb) plus a longevity
 * term for surviving to the late rounds. Naturally rewards the better-built team,
 * consistent with the match engine (the same box scores feed it).
 *
 * @param {object} world  World { leagues, teamsById, playersById }
 * @param {Array<object>} series  SeriesRef[] played so far (maps[].boxScore + score)
 * @returns {Array<{rank:number, playerId:string, rating:number, region:string|null, teamId:string|null}>}
 */
export function computePlayerGlobalRanking(world, series) {
  const players = (world && world.playersById) || {};
  const teams = (world && world.teamsById) || {};
  const leagues = (world && world.leagues) || {};

  const regionByTeam = {};
  for (const region of Object.keys(leagues)) {
    for (const id of (leagues[region] && leagues[region].teamIds) || []) regionByTeam[id] = region;
  }

  const ratings = ratePlayersOverSeries(series || []);
  const rows = [];
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (!p) continue;
    const c = p.contract || {};
    // The pro field = rostered players (active + on a team). FAs/retired sit out.
    if (c.status !== 'active' || !c.teamId) continue;
    const ovr = overall(p);
    if (!Number.isFinite(ovr) || ovr <= 0) continue;
    const rb = ratings.get(id);
    const r2 = rb ? rb.rating : 0;
    const maps = rb ? rb.maps : 0;
    const perf = r2 > 0 ? (r2 - 1.0) * PLAYER.RATING2_SCALE : 0;
    const longevity = Math.min(maps, PLAYER.APPEARANCE_CAP) * PLAYER.APPEARANCE_K;
    const teamId = c.teamId;
    rows.push({
      playerId: id,
      rating: Math.round((ovr + perf + longevity) * 10) / 10,
      region: regionByTeam[teamId] || (teams[teamId] && teams[teamId].region) || null,
      teamId
    });
  }
  rows.sort((a, b) => b.rating - a.rating || (a.playerId < b.playerId ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
