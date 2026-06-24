/**
 * engine/career/attractiveness.js — team pull on talent & player signing
 * preference (P13). This is the "what makes a club attractive to good players"
 * layer the user asked for.
 *
 * `teamAttractiveness(team, ctx)` → 0..100: how appealing a club is, blending
 * prestige (reputation), recent on-stage success, and money. `signingDesirability`
 * is how much a SPECIFIC player wants a SPECIFIC suitor — the team's pull plus the
 * wage on offer, whether they'd start, and home comfort, tilted by the player's
 * ambition (better players chase prestige & winning harder than a fat paycheck).
 *
 * The transfer market (transfers.js) uses these to resolve bidding wars: when
 * several clubs chase one player, the player signs where desirability is highest —
 * so a winning, rich, prestigious org out-recruits a small club for the same star.
 *
 * PURE & deterministic (no rng, no Date/DOM). Constants from BALANCE.CAREER.ATTRACT.
 */

import { BALANCE } from '../../config/balance.js';
import { overall, clamp, num } from './playerStats.js';

const A = BALANCE.CAREER.ATTRACT;

/**
 * A 0..1 "recent success" score for a team from a completed season: rewards
 * titles and high cumulative-CP finishes. Used as the SUCCESS input to
 * attractiveness so a winning club is more appealing the year after.
 *
 * @param {object} season  completed SeasonState (events[], finalStandings?)
 * @param {string} teamId
 * @returns {number} 0..1
 */
export function seasonSuccessScore(season, teamId) {
  if (!season || !teamId) return 0;
  let score = 0;
  const events = Array.isArray(season.events) ? season.events : [];
  for (const ev of events) {
    const ps = ev && ev.result && Array.isArray(ev.result.placements) ? ev.result.placements : null;
    if (!ps) continue;
    const row = ps.find((p) => p.teamId === teamId);
    if (!row) continue;
    const tierW = ev.type === 'champions' ? 1.0 : ev.type === 'masters' ? 0.7 : ev.type === 'stage' ? 0.4 : 0.35;
    if (row.rank === 1) score += tierW;
    else if (row.rank <= 3) score += tierW * 0.4;
    else if (row.rank <= 8) score += tierW * 0.15;
  }
  // Cap & normalize: a dominant season (a couple of titles + deep runs) ≈ 1.0.
  return clamp(score / 3, 0, 1);
}

/**
 * How attractive a club is to talent, on a 0..100 scale.
 *
 * @param {object} team   Team (reputation, budget)
 * @param {{ success?:number }} [ctx]  success: 0..1 recent-success score (default 0)
 * @returns {number} 0..100
 */
export function teamAttractiveness(team, ctx = {}) {
  const rep = num(team && team.reputation, 50);
  const budget = num(team && team.budget, 0);
  const success = clamp(num(ctx.success, 0), 0, 1);
  const money = clamp(budget / A.MONEY_REF, 0, 1) * 100;
  const pull = A.REP_W * rep + A.SUCCESS_W * (success * 100) + A.MONEY_W * money;
  return clamp(pull, 0, 100);
}

/**
 * How much a player WANTS to sign for a suitor (higher = keener). Combines the
 * club's pull with the concrete offer: the wage relative to the player's market
 * value, whether they'd start, and home comfort. Better players weight prestige &
 * winning more (ambition), so a rich-but-mediocre club can't simply buy a star
 * who could start for a contender.
 *
 * @param {object} player
 * @param {object} team
 * @param {{ success?:number, wageOffer?:number, marketWage?:number, willStart?:boolean, home?:boolean }} [ctx]
 * @returns {number} desirability score (≥ 0)
 */
export function signingDesirability(player, team, ctx = {}) {
  const pull = teamAttractiveness(team, ctx);

  const marketWage = Math.max(1, num(ctx.marketWage, 1));
  const wageOffer = Math.max(0, num(ctx.wageOffer, marketWage));
  const wageRatio = clamp(wageOffer / marketWage, 0, A.WAGE_RATIO_CAP);
  const wageNorm = (wageRatio / A.WAGE_RATIO_CAP) * 100;

  const willStart = !!ctx.willStart;
  const playtime = willStart ? 100 : 45;

  // Ambition: a 90-overall player tilts harder toward pull (prestige/winning);
  // a journeyman cares relatively more about the wage. AMBITION_K scales the tilt.
  const ovr = overall(player);
  const ambition = clamp((ovr - 70) / 30, -1, 1) * A.AMBITION_K; // -0.x..+0.x
  const pullW = A.PULL_W * (1 + ambition);
  const wageW = A.WAGE_W * (1 - ambition);

  let desire = pullW * pull + wageW * wageNorm + A.PLAYTIME_W * playtime;
  if (willStart) desire += A.STARTER_BONUS;
  if (ctx.home) desire += A.HOME_BONUS;
  return Math.max(0, desire);
}
