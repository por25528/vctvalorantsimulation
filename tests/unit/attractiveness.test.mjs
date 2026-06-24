/**
 * tests/unit/attractiveness.test.mjs — team pull & player signing preference (P13).
 * Pure & deterministic.
 */

import { assert, section } from '../_assert.mjs';
import {
  teamAttractiveness,
  signingDesirability,
  seasonSuccessScore
} from '../../src/engine/career/attractiveness.js';
import { createTeam } from '../../src/domain/team.js';
import { createPlayer } from '../../src/domain/player.js';

/** A player at a uniform attribute level. */
function mk(id, ovr) {
  const attributes = {};
  for (const k of ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl']) attributes[k] = ovr;
  return createPlayer({ id, name: id, role: 'Duelist', attributes });
}

export default async function run() {
  section('teamAttractiveness — prestige, money and success all lift the pull');
  const elite = createTeam({ id: 'elite', reputation: 90, budget: 3000000 });
  const small = createTeam({ id: 'small', reputation: 35, budget: 400000 });
  assert(teamAttractiveness(elite, { success: 0.9 }) > teamAttractiveness(small, { success: 0.1 }), 'a prestigious, rich, winning club is more attractive');
  assert(teamAttractiveness(elite, { success: 0.9 }) > teamAttractiveness(elite, { success: 0 }), 'recent success raises attractiveness');
  const a = teamAttractiveness(elite, {});
  assert(a >= 0 && a <= 100, 'attractiveness is bounded 0..100');

  section('seasonSuccessScore — a champion outscores an early exit, bounded 0..1');
  const season = {
    events: [
      { type: 'champions', result: { placements: [{ rank: 1, teamId: 'A' }, { rank: 12, teamId: 'B' }] } }
    ]
  };
  const sA = seasonSuccessScore(season, 'A');
  const sB = seasonSuccessScore(season, 'B');
  assert(sA > sB, 'the champion has a higher success score');
  assert(sA >= 0 && sA <= 1 && sB >= 0, 'success score is bounded');

  section('signingDesirability — players prefer the more attractive suitor at equal pay');
  const player = mk('star', 88);
  const market = 200000;
  const wantElite = signingDesirability(player, elite, { success: 0.9, wageOffer: market, marketWage: market, willStart: true });
  const wantSmall = signingDesirability(player, small, { success: 0.1, wageOffer: market, marketWage: market, willStart: true });
  assert(wantElite > wantSmall, 'the same player prefers the prestigious club for the same wage');

  section('signingDesirability — playing time and a bigger wage both help');
  const start = signingDesirability(player, small, { wageOffer: market, marketWage: market, willStart: true });
  const bench = signingDesirability(player, small, { wageOffer: market, marketWage: market, willStart: false });
  assert(start > bench, 'a starting role is more desirable than a bench seat');
  const overpay = signingDesirability(player, small, { wageOffer: market * 1.5, marketWage: market, willStart: false });
  assert(overpay > bench, 'a fat overpay can tempt a player to a less attractive club');

  section('ambition — a journeyman weights wage more than a star does');
  const journeyman = mk('jm', 68);
  // Weak-but-rich club overpaying vs prestigious club paying market, no start.
  const richWeak = createTeam({ id: 'rw', reputation: 40, budget: 3000000 });
  const prestige = createTeam({ id: 'pg', reputation: 92, budget: 1500000 });
  const jmRich = signingDesirability(journeyman, richWeak, { success: 0.1, wageOffer: market * 1.5, marketWage: market, willStart: true });
  const jmPrestige = signingDesirability(journeyman, prestige, { success: 0.9, wageOffer: market, marketWage: market, willStart: true });
  const starRich = signingDesirability(player, richWeak, { success: 0.1, wageOffer: market * 1.5, marketWage: market, willStart: true });
  const starPrestige = signingDesirability(player, prestige, { success: 0.9, wageOffer: market, marketWage: market, willStart: true });
  // The star leans toward prestige relative to how the journeyman does.
  assert((starPrestige - starRich) > (jmPrestige - jmRich), 'the higher-rated player values prestige over money more than the journeyman');
}
