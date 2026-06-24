/**
 * engine/career/economy.js — the sponsor economy (CONTRACTS-POLISH P7e).
 *
 * PURE & deterministic accounting. `team.budget` is a cash reserve; each season-end
 * adds PRIZE money (by event finish) + recurring SPONSOR income (reputation-scaled)
 * and pays the WAGE bill (sum of rostered salaries):
 *   `budget = max(BUDGET_FLOOR, budget + prize + sponsor - wages)`
 * Sponsor income keeps a mid-table club roughly solvent (prize alone is far below
 * the wage bill), and a floor keeps every club above $0 — so budget is a live,
 * stratifying number, never a near-universal zero.
 *
 * Budget feeds the AI transfer market (P13: affordability + fees; the war-chest
 * pass scales a club's aggression by its reserve), so the economy shapes WHO can
 * buy whom — but it stays fully deterministic (no rng/Date/DOM) and the match/season
 * engines never read it, so replays are byte-identical. Constants from
 * BALANCE.CAREER.ECONOMY.
 */

import { BALANCE } from '../../config/balance.js';

const E = BALANCE.CAREER.ECONOMY;

/** Winner's purse for an event entry, by its tier. */
function purseFor(entry) {
  switch (entry && entry.type) {
    case 'kickoff': return E.PRIZE_KICKOFF;
    case 'stage': return E.PRIZE_STAGE;
    case 'masters': return E.PRIZE_MASTERS;
    case 'champions': return E.PRIZE_CHAMPIONS;
    default: return 0;
  }
}

/**
 * Prize money a team earned in ONE event: the tier purse scaled by their finish
 * (rank 1 = full purse; each rank down decays by PRIZE_DECAY, floored at
 * PRIZE_MIN_FRACTION). Returns 0 if the team didn't place in this event.
 *
 * @param {object} entry  SeasonEventEntry
 * @param {string} teamId
 * @returns {number} rounded prize
 */
export function eventPrize(entry, teamId) {
  const placements = entry && entry.result && entry.result.placements;
  if (!Array.isArray(placements)) return 0;
  const row = placements.find((p) => p.teamId === teamId);
  if (!row) return 0;
  const purse = purseFor(entry);
  if (purse <= 0) return 0;
  const factor = Math.max(E.PRIZE_MIN_FRACTION, Math.pow(E.PRIZE_DECAY, Math.max(0, row.rank - 1)));
  return Math.round(purse * factor);
}

/**
 * Total prize money each team earned across a whole season.
 * @param {object} season  SeasonState | SeasonResult (with events[])
 * @returns {Map<string, number>} teamId -> total prize
 */
export function seasonPrizeMoney(season) {
  /** @type {Map<string, number>} */
  const out = new Map();
  const events = (season && season.events) || [];
  for (const entry of events) {
    const placements = entry && entry.result && entry.result.placements;
    if (!Array.isArray(placements)) continue;
    for (const p of placements) {
      const prize = eventPrize(entry, p.teamId);
      if (prize > 0) out.set(p.teamId, (out.get(p.teamId) || 0) + prize);
    }
  }
  return out;
}

/**
 * A team's recurring seasonal sponsor income: a baseline every club attracts plus
 * a reputation premium. Keeps a typical roster roughly solvent against its wages
 * (prize money alone is far below the wage bill). Reputation drives no
 * budget-dependent decision, so this stays outcome-neutral.
 * @param {object} team
 * @returns {number}
 */
export function sponsorIncome(team) {
  const rep = Number(team && team.reputation);
  const reputation = Number.isFinite(rep) ? rep : 50;
  return Math.round(E.SPONSOR_BASE + E.SPONSOR_REP_K * reputation);
}

/**
 * A team's seasonal wage bill: the sum of its rostered players' salaries.
 * @param {object} team
 * @param {Record<string, object>} playersById
 * @returns {number}
 */
export function wageBill(team, playersById) {
  let sum = 0;
  for (const pid of (team && team.roster) || []) {
    const p = playersById[pid];
    const salary = p && p.contract && p.contract.salary;
    if (typeof salary === 'number' && Number.isFinite(salary)) sum += salary;
  }
  return sum;
}

/**
 * Apply one season's P&L to every team's budget: `raw = budget + prize + sponsor −
 * wages`, then reinvest the slice above the soft cap (`budget = max(BUDGET_FLOOR,
 * raw − RESERVE_DRAG·max(0, raw − RESERVE_SOFT_CAP))`). Sponsors keep clubs solvent
 * (never below the floor) and the drag keeps reserves from ballooning. Pure: the
 * input world is never mutated; only `budget` changes (rosters / players reused).
 *
 * @param {{leagues:object, teamsById:object, playersById:object}} world  end-of-season world
 * @param {object} season  the completed SeasonState (for prize money)
 * @returns {object} a new frozen World with updated budgets
 */
export function applySeasonEconomy(world, season) {
  if (!world || !world.teamsById) return world;
  const prize = seasonPrizeMoney(season);
  /** @type {Record<string, object>} */
  const teamsById = {};
  for (const id of Object.keys(world.teamsById)) {
    const t = world.teamsById[id];
    const income = (prize.get(id) || 0) + sponsorIncome(t);
    const wages = wageBill(t, world.playersById);
    const raw = (Number(t.budget) || 0) + income - wages;
    // Reinvest a fraction of any reserve above the soft cap (a sink that keeps
    // budgets from ballooning — see RESERVE_DRAG). Applied before the floor clamp.
    const excess = Math.max(0, raw - E.RESERVE_SOFT_CAP);
    const budget = Math.max(E.BUDGET_FLOOR, Math.round(raw - E.RESERVE_DRAG * excess));
    teamsById[id] = Object.freeze({ ...t, budget });
  }
  return Object.freeze({
    leagues: world.leagues,
    teamsById: Object.freeze(teamsById),
    playersById: world.playersById
  });
}
