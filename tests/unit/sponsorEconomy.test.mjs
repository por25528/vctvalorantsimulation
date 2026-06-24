/**
 * tests/unit/sponsorEconomy.test.mjs — P7e sponsor economy (CONTRACTS-POLISH P7e).
 *
 * Pure accounting: eventPrize (purse * placement decay), seasonPrizeMoney,
 * wageBill, and applySeasonEconomy (budget = max(0, budget + prize - wages)) —
 * deterministic, input-immutable, and provably outcome-neutral (only budgets
 * change). Plus a career integration: budgets evolve and the champion earns most.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { buildWorld } from '../../src/data/seed/index.js';
import { simSeason } from '../../src/engine/career/season.js';
import { initCareer, advanceCareer } from '../../src/engine/career/career.js';
import { eventPrize, seasonPrizeMoney, wageBill, sponsorIncome, applySeasonEconomy } from '../../src/engine/career/economy.js';
import { BALANCE } from '../../src/config/balance.js';

const E = BALANCE.CAREER.ECONOMY;

export default async function run() {
  const world = buildWorld();
  const season = simSeason(world, 11);

  section('eventPrize — purse scaled by placement, floored, 0 when absent');
  const champEntry = season.events.find((e) => e.type === 'champions');
  const winner = champEntry.result.placements.find((p) => p.rank === 1).teamId;
  const second = champEntry.result.placements.find((p) => p.rank === 2).teamId;
  assertEqual(eventPrize(champEntry, winner), E.PRIZE_CHAMPIONS, 'champion earns the full Champions purse');
  assertEqual(eventPrize(champEntry, second), Math.round(E.PRIZE_CHAMPIONS * E.PRIZE_DECAY), 'runner-up earns purse * decay');
  assertEqual(eventPrize(champEntry, 'no-such-team'), 0, 'a team that did not place earns 0');
  // a deep finish is floored
  const last = champEntry.result.placements[champEntry.result.placements.length - 1];
  assert(eventPrize(champEntry, last.teamId) >= Math.round(E.PRIZE_CHAMPIONS * E.PRIZE_MIN_FRACTION), 'last place is floored, not zero');

  section('seasonPrizeMoney — sums across the season; the champion earns well');
  const prize = seasonPrizeMoney(season);
  // The champion won the single biggest purse, so they earn at least that much,
  // and comfortably above the league-average haul (though a dominant regional team
  // can out-earn them across all events, so it is not a strict maximum).
  assert(prize.get(season.champion) >= E.PRIZE_CHAMPIONS, 'champion earned at least the full Champions purse');
  let total = 0;
  for (const v of prize.values()) total += v;
  const avg = total / prize.size;
  assert(prize.get(season.champion) > avg, 'champion is an above-average earner');
  let maxTeam = null;
  let maxVal = -1;
  for (const [tid, v] of prize) if (v > maxVal) { maxVal = v; maxTeam = tid; }
  assert(maxVal > 0 && maxTeam, 'some team is the top earner');

  section('wageBill — sum of rostered salaries');
  const t0 = Object.values(world.teamsById)[0];
  let manual = 0;
  for (const pid of t0.roster) manual += world.playersById[pid].contract.salary;
  assertEqual(wageBill(t0, world.playersById), manual, 'wage bill equals the sum of roster salaries');

  section('sponsorIncome — baseline + reputation premium, keeps clubs solvent');
  assertEqual(sponsorIncome({ reputation: 50 }), Math.round(E.SPONSOR_BASE + E.SPONSOR_REP_K * 50), 'rep-50 sponsor income');
  assert(sponsorIncome({ reputation: 90 }) > sponsorIncome({ reputation: 30 }), 'higher reputation earns more sponsorship');
  assertEqual(sponsorIncome({}), Math.round(E.SPONSOR_BASE + E.SPONSOR_REP_K * 50), 'missing reputation defaults to 50');

  section('applySeasonEconomy — budget = max(FLOOR, raw - drag(excess over soft cap)); pure');
  const next = applySeasonEconomy(world, season);
  for (const id of Object.keys(world.teamsById)) {
    const before = world.teamsById[id];
    const after = next.teamsById[id];
    const raw = (before.budget || 0) + (prize.get(id) || 0) + sponsorIncome(before) - wageBill(before, world.playersById);
    const excess = Math.max(0, raw - E.RESERVE_SOFT_CAP);
    const expected = Math.max(E.BUDGET_FLOOR, Math.round(raw - E.RESERVE_DRAG * excess));
    assertEqual(after.budget, expected, `team ${id} budget updated by its P&L (incl. reserve drag)`);
    assert(after.budget >= E.BUDGET_FLOOR, `team ${id} stays solvent at/above the floor`);
    // only budget changed — roster + identity preserved
    assertEqual(after.roster, before.roster, 'roster preserved');
    assertEqual(after.name, before.name, 'identity preserved');
  }
  // input world not mutated; players reused
  assert(next.playersById === world.playersById, 'players are reused (no copy)');
  assert(world.teamsById[Object.keys(world.teamsById)[0]].budget === t0.budget, 'input world not mutated');
  // determinism
  assertEqual(applySeasonEconomy(world, season).teamsById[maxTeam].budget, next.teamsById[maxTeam].budget, 'deterministic');

  section('career integration — budgets evolve season to season');
  let a = initCareer('econ-2026');
  const startBudgets = {};
  for (const id of Object.keys(a.world.teamsById)) startBudgets[id] = a.world.teamsById[id].budget;
  // play through one full season + its off-season (budgets are applied at season end)
  let guard = 0;
  while (a.seasonIndex < 1 && guard++ < 30) a = advanceCareer(a);
  let changed = 0;
  for (const id of Object.keys(a.world.teamsById)) {
    if (a.world.teamsById[id] && a.world.teamsById[id].budget !== startBudgets[id]) changed += 1;
  }
  assert(changed > 0, 'budgets moved after a season of prize money + wages');
  // determinism across two identical careers
  let b = initCareer('econ-2026');
  guard = 0;
  while (b.seasonIndex < 1 && guard++ < 30) b = advanceCareer(b);
  for (const id of Object.keys(a.world.teamsById)) {
    assertEqual(a.world.teamsById[id].budget, b.world.teamsById[id].budget, `team ${id} budget is reproducible`);
  }
}
