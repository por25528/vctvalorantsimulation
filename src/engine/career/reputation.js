/**
 * engine/career/reputation.js — LIVING team reputation (P13).
 *
 * Reputation used to be a static seed number. Now it MOVES with results: a club
 * earns prestige by winning titles and going deep, and mean-reverts toward a
 * league baseline when it stops winning. The effect is the esports arc the user
 * asked for — Astralis/Sentinels-style dynasties that climb into the 90s, then
 * slide back toward the middle once the trophies dry up.
 *
 * PURE & deterministic (no rng, no Date/DOM). Reputation feeds three things that
 * already existed — sponsor income (economy.js), the transfer market's pecking
 * order (transfers.js), and contract pull (contracts.js) — plus the new team
 * attractiveness (attractiveness.js). The match/season engines never read it, so
 * this stays in the career layer and same-seed careers remain reproducible.
 *
 * Constants from BALANCE.CAREER.REPUTATION.
 */

import { BALANCE } from '../../config/balance.js';
import { overall, clamp, num } from './playerStats.js';

const R = BALANCE.CAREER.REPUTATION;

/** Mean overall of a team's strongest five (its competitive ceiling). */
function topFiveMean(team, playersById) {
  const roster = (team && team.roster) || [];
  const ovrs = roster.map((id) => overall(playersById[id])).filter((v) => v > 0).sort((a, b) => b - a).slice(0, 5);
  if (ovrs.length === 0) return 0;
  return ovrs.reduce((s, v) => s + v, 0) / ovrs.length;
}

/**
 * Seed each club's INITIAL reputation from its roster strength, mapped across the
 * league to [SEED_MIN, SEED_MAX] so day-one prestige already varies (a stacked
 * super-team starts appealing, a weak side humble). Deterministic, seed-independent
 * (derived only from rosters), input not mutated. Called once at career init.
 *
 * @param {{leagues:object, teamsById:object, playersById:object}} world
 * @returns {object} new frozen World with seeded reputations
 */
export function seedInitialReputation(world) {
  if (!world || !world.teamsById) return world;
  const ids = Object.keys(world.teamsById);
  const means = ids.map((id) => topFiveMean(world.teamsById[id], world.playersById));
  const lo = Math.min(...means);
  const hi = Math.max(...means);
  const span = hi - lo;
  /** @type {Record<string, object>} */
  const teamsById = {};
  ids.forEach((id, i) => {
    const t = world.teamsById[id];
    const frac = span > 0 ? (means[i] - lo) / span : 0.5;
    const rep = Math.round(clamp(R.SEED_MIN + frac * (R.SEED_MAX - R.SEED_MIN), R.MIN, R.MAX));
    teamsById[id] = Object.freeze({ ...t, reputation: rep });
  });
  return Object.freeze({
    leagues: world.leagues,
    teamsById: Object.freeze(teamsById),
    playersById: world.playersById
  });
}

/** Reputation a single event TITLE is worth, by event tier. */
function titleWorth(type) {
  switch (type) {
    case 'champions': return R.TITLE_CHAMPIONS;
    case 'masters': return R.TITLE_MASTERS;
    case 'stage': return R.TITLE_STAGE;
    case 'kickoff': return R.TITLE_KICKOFF;
    default: return 0;
  }
}

/** The rank-1 teamId of an EventResult, or null. */
function rank1Of(result) {
  const ps = result && Array.isArray(result.placements) ? result.placements : null;
  if (!ps) return null;
  const top = ps.find((p) => p.rank === 1);
  return top ? top.teamId : null;
}

/**
 * The reputation a team EARNED across one completed season (before mean-reversion):
 * full title worth for events won, plus a decaying "deep run" credit for every
 * event placement, plus a bonus for finishing high in the season's cumulative CP
 * standings (cross-region prestige).
 *
 * @param {object} season   completed SeasonState (events[] with result.placements; finalStandings?)
 * @param {string} teamId
 * @returns {number} earned reputation (>= 0)
 */
export function seasonReputationEarned(season, teamId) {
  if (!season || !teamId) return 0;
  const events = Array.isArray(season.events) ? season.events : [];
  let earned = 0;

  for (const ev of events) {
    const result = ev && ev.result;
    if (!result) continue;
    const tier = titleWorth(ev.type);
    if (tier <= 0) continue;
    // Title.
    if (rank1Of(result) === teamId) earned += tier;
    // Deep-run credit: a decaying fraction of the tier weight by finish.
    const placements = Array.isArray(result.placements) ? result.placements : [];
    const row = placements.find((p) => p.teamId === teamId);
    if (row && row.rank >= 1) {
      const factor = Math.pow(R.PLACEMENT_DECAY, row.rank - 1);
      earned += R.PLACEMENT_K * (tier / R.TITLE_CHAMPIONS) * factor;
    }
  }

  // Cumulative-CP prestige: topping the season's standings is itself reputation.
  const standings = Array.isArray(season.finalStandings) ? season.finalStandings : null;
  if (standings && standings.length > 1) {
    const idx = standings.indexOf(teamId);
    if (idx >= 0) {
      const frac = 1 - idx / (standings.length - 1); // 1 at the top, 0 at the bottom
      earned += R.CP_RANK_K * frac;
    }
  }

  return earned;
}

/**
 * Next-season reputation for a team: current rep, plus what it earned, then
 * mean-reverted toward BASE, clamped to the dynamic [MIN, MAX] band.
 *
 * @param {object} team    Team (reputation)
 * @param {object} season  completed SeasonState
 * @returns {number} new reputation (integer)
 */
export function nextReputation(team, season) {
  const rep = num(team && team.reputation, R.BASE);
  const earned = seasonReputationEarned(season, team && team.id);
  const reverted = rep + R.REVERT * (R.BASE - rep);
  return Math.round(clamp(reverted + earned, R.MIN, R.MAX));
}

/**
 * Apply one season's reputation update to every team. Returns a NEW frozen World
 * with updated `reputation`; nothing else changes (rosters/players reused), so it
 * never affects any simulated MATCH outcome. The input world is not mutated.
 *
 * @param {{leagues:object, teamsById:object, playersById:object}} world  end-of-season world
 * @param {object} season  the completed SeasonState
 * @returns {{ world:object, changes:Array<{teamId:string, before:number, after:number}> }}
 */
export function applySeasonReputation(world, season) {
  if (!world || !world.teamsById) return { world, changes: [] };
  /** @type {Record<string, object>} */
  const teamsById = {};
  const changes = [];
  for (const id of Object.keys(world.teamsById)) {
    const t = world.teamsById[id];
    const before = num(t.reputation, R.BASE);
    const after = nextReputation(t, season);
    teamsById[id] = after === before ? t : Object.freeze({ ...t, reputation: after });
    if (after !== before) changes.push({ teamId: id, before, after });
  }
  const next = Object.freeze({
    leagues: world.leagues,
    teamsById: Object.freeze(teamsById),
    playersById: world.playersById
  });
  return { world: next, changes };
}
