/**
 * ui/rankDerive.js — pure fallback derivations for the competitive-core UI.
 *
 * The engine half (r9) owns the real `selectGlobalRankings` / `selectLadder`
 * data + selectors. Until they merge, the Global Rankings and Ladder screens
 * still need to BUILD and RENDER against the contract shapes — so this module
 * reconstructs those shapes purely from data that already exists in `state`
 * (team Elo ratings, the player tables, T2). `ui/rankSelectors.js` prefers r9's
 * selectors and only calls these when they are absent.
 *
 * Everything here is pure: no DOM, no rng, no Date — derived from `state`.
 */

import { selectTeamRatings, selectTeam } from '../state/selectors.js';
import { overall } from '../engine/career/playerStats.js';
import { playerRankTier } from './rankTier.js';

/** Display rating from a 0–100 overall (integer, stable). */
function ratingOf(player) {
  return Math.round(overall(player));
}

/** Map every team id → its region, from the world team table. */
function teamRegionMap(state) {
  const teams = (state.world && state.world.teams) || {};
  const out = {};
  for (const id of Object.keys(teams)) out[id] = teams[id].region || null;
  return out;
}

/**
 * Fallback for `selectGlobalRankings(state, { scope })`.
 * Teams come straight from the Elo world ranking; players are built by sorting
 * the world player table on overall. `deltaRank` is 0 in the fallback (no cheap
 * history source) — r9 supplies the real climb/fall once merged.
 * @param {object} state
 * @param {{scope?:'teams'|'players'}} [opts]
 * @returns {Array<{rank:number,id:string,name:string,region:(string|null),rating:number,deltaRank:number}>}
 */
export function fallbackGlobalRankings(state, opts = {}) {
  const scope = opts && opts.scope === 'players' ? 'players' : 'teams';

  if (scope === 'teams') {
    return selectTeamRatings(state).map((r) => {
      const team = selectTeam(state, r.teamId);
      return {
        rank: r.rank,
        id: r.teamId,
        name: team ? team.name : r.teamId,
        region: r.region || null,
        rating: r.rating,
        deltaRank: 0
      };
    });
  }

  const players = Object.values((state.world && state.world.players) || {});
  const regionOf = teamRegionMap(state);
  return players
    .map((p) => ({
      id: p.id,
      name: p.handle || p.name || p.id,
      region: (p.contract && regionOf[p.contract.teamId]) || null,
      rating: ratingOf(p)
    }))
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
    .map((row, i) => ({ ...row, rank: i + 1, deltaRank: 0 }));
}

/**
 * Collect every ranked player (T1 + T2) into a single sorted ladder, tagged
 * with region + rank-tier + rating + ladder rank. Built once per call; the
 * screen pages a WINDOW of it via {@link fallbackLadder}.
 * @param {object} state
 * @returns {Array<{rank:number,id:string,handle:string,region:(string|null),tier:string,rating:number}>}
 */
function buildLadder(state) {
  const regionOf = teamRegionMap(state);
  const t2 = state.world && state.world.tier2;
  const t2Region = {};
  if (t2 && t2.teamsById) {
    for (const id of Object.keys(t2.teamsById)) t2Region[id] = t2.teamsById[id].region || null;
  }

  const rows = [];
  const push = (p, regionLookup) => {
    rows.push({
      id: p.id,
      handle: p.handle || p.name || p.id,
      region: (p.contract && regionLookup[p.contract.teamId]) || null,
      tier: playerRankTier(p).tier,
      rating: ratingOf(p)
    });
  };

  for (const p of Object.values((state.world && state.world.players) || {})) push(p, regionOf);
  if (t2 && t2.playersById) {
    for (const p of Object.values(t2.playersById)) push(p, t2Region);
  }

  rows.sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  return rows.map((row, i) => ({ rank: i + 1, ...row }));
}

/**
 * Fallback for `selectLadder(state, { tier?, region?, offset, limit })`.
 * Filters the full ladder by rank-tier + region, then returns ONLY the
 * requested page — the screen never holds more than `limit` rows. `rank` is the
 * row's true position in the full (unfiltered) ladder, so it stays meaningful
 * inside a filtered view.
 * @param {object} state
 * @param {{tier?:string,region?:string,offset?:number,limit?:number}} [opts]
 * @returns {{total:number, rows:Array<object>}}
 */
export function fallbackLadder(state, opts = {}) {
  const { tier = null, region = null, offset = 0, limit = 50 } = opts || {};
  const filtered = buildLadder(state).filter(
    (r) => (!tier || r.tier === tier) && (!region || r.region === region)
  );
  const start = Math.max(0, offset | 0);
  const end = start + Math.max(0, limit | 0);
  return { total: filtered.length, rows: filtered.slice(start, end) };
}
