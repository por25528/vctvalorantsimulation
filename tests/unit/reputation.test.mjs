/**
 * tests/unit/reputation.test.mjs — dynamic team reputation (P13).
 *
 * Reputation moves with results (titles + deep runs + CP finish) and mean-reverts
 * toward BASE. Pure, deterministic, input-immutable.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import {
  seasonReputationEarned,
  nextReputation,
  applySeasonReputation
} from '../../src/engine/career/reputation.js';
import { createTeam } from '../../src/domain/team.js';
import { BALANCE } from '../../src/config/balance.js';

const R = BALANCE.CAREER.REPUTATION;

/** A synthetic completed season: A wins Champions + a Stage, B/C go deep, D nowhere. */
function fakeSeason() {
  return {
    events: [
      { type: 'champions', result: { placements: [
        { rank: 1, teamId: 'A' }, { rank: 2, teamId: 'B' }, { rank: 3, teamId: 'C' }, { rank: 8, teamId: 'D' }
      ] } },
      { type: 'stage', region: 'pacific', result: { placements: [
        { rank: 1, teamId: 'A' }, { rank: 2, teamId: 'B' }, { rank: 5, teamId: 'C' }
      ] } }
    ],
    finalStandings: ['A', 'B', 'C', 'D']
  };
}

export default async function run() {
  const season = fakeSeason();

  section('seasonReputationEarned — titles & deep runs outrank a no-show');
  const eA = seasonReputationEarned(season, 'A');
  const eB = seasonReputationEarned(season, 'B');
  const eC = seasonReputationEarned(season, 'C');
  const eD = seasonReputationEarned(season, 'D');
  assert(eA > eB && eB > eC && eC > eD, `earned ordering A>B>C>D (got ${eA.toFixed(1)}/${eB.toFixed(1)}/${eC.toFixed(1)}/${eD.toFixed(1)})`);
  assert(eA >= R.TITLE_CHAMPIONS + R.TITLE_STAGE, 'the double winner earns at least both title worths');
  assertEqual(seasonReputationEarned(season, 'nobody'), 0, 'a team that never appears earns 0');

  section('nextReputation — a winner climbs, a faded club mean-reverts');
  const winner = createTeam({ id: 'A', reputation: 50 });
  const climbed = nextReputation(winner, season);
  assert(climbed > 50, `the champion's reputation rises (50 -> ${climbed})`);

  // A high-reputation team that won NOTHING this season slides back toward BASE.
  const fadedSeason = { events: [], finalStandings: ['X', 'A'] }; // A finishes last, no titles
  const faded = createTeam({ id: 'A', reputation: 90 });
  const reverted = nextReputation(faded, fadedSeason);
  assert(reverted < 90, `a club that stops winning loses prestige (90 -> ${reverted})`);
  assert(reverted > R.BASE, 'but reversion is gradual — it does not crash to the mean in one year');

  section('nextReputation — clamped to the dynamic band');
  const ceiling = nextReputation(createTeam({ id: 'A', reputation: 98 }), season);
  assert(ceiling <= R.MAX, `reputation never exceeds MAX (${ceiling} <= ${R.MAX})`);
  const floorTeam = nextReputation(createTeam({ id: 'Z', reputation: R.MIN }), { events: [], finalStandings: ['A', 'Z'] });
  assert(floorTeam >= R.MIN, `reputation never drops below MIN (${floorTeam} >= ${R.MIN})`);

  section('applySeasonReputation — pure, only reputation changes, deterministic');
  const world = Object.freeze({
    leagues: {},
    teamsById: Object.freeze({
      A: createTeam({ id: 'A', reputation: 50, roster: ['p1'] }),
      D: createTeam({ id: 'D', reputation: 70, roster: ['p2'] })
    }),
    playersById: Object.freeze({ p1: { id: 'p1' }, p2: { id: 'p2' } })
  });
  const { world: next, changes } = applySeasonReputation(world, season);
  assert(next.teamsById.A.reputation > 50, 'champion A gained reputation');
  assert(next.teamsById.D.reputation < 70, 'no-show D (high rep, deep loss) lost reputation toward the mean');
  assertEqual(next.teamsById.A.roster, world.teamsById.A.roster, 'rosters are preserved');
  assert(next.playersById === world.playersById, 'players are reused (no copy) — outcome-neutral for matches');
  assertEqual(world.teamsById.A.reputation, 50, 'input world is not mutated');
  assert(Array.isArray(changes) && changes.length === 2, 'changes are reported for both teams');

  const again = applySeasonReputation(world, season);
  assertEqual(again.world.teamsById.A.reputation, next.teamsById.A.reputation, 'deterministic for the same world+season');
}
