/**
 * tests/unit/seed-americas.test.mjs — AMERICAS_SEED fixture validation
 * (CONTRACTS-SEASON §1).
 *
 * Checks:
 *   - league shape: id/name/region/teamIds present and consistent with teams.
 *   - exactly 12 teams, each with EXACTLY 5 players (60 total).
 *   - player/team ids unique; team ids namespaced with the `na-` prefix; every
 *     roster id resolves to a real player; every player's contract.teamId points
 *     at a real team.
 *   - each player + each team normalizes cleanly through createPlayer /
 *     createTeam from domain (no throw; attributes clamp 0-100; defaults fill).
 *
 * Default export is an async fn that throws on failure (per CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { AMERICAS_SEED } from '../../src/data/seed/americas.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';

const ROLES = new Set(['Duelist', 'Initiator', 'Controller', 'Sentinel']);
const ATTR_KEYS = [
  'aim',
  'movement',
  'reaction',
  'composure',
  'consistency',
  'gameSense',
  'utility',
  'trading',
  'igl'
];

export default async function seedAmericasTest() {
  section('seed/americas — structure');

  const { league, teams, players } = AMERICAS_SEED;
  assert(league && typeof league === 'object', 'AMERICAS_SEED.league missing');
  assert(Array.isArray(teams), 'AMERICAS_SEED.teams must be an array');
  assert(Array.isArray(players), 'AMERICAS_SEED.players must be an array');

  // league shape
  assertEqual(league.id, 'americas', 'league.id should be "americas"');
  assertEqual(league.region, 'americas', 'league.region should be "americas"');
  assert(typeof league.name === 'string' && league.name.length > 0, 'league.name missing');
  assert(Array.isArray(league.teamIds), 'league.teamIds must be an array');

  // exactly 12 Americas teams, 60 players
  assertEqual(teams.length, 12, `expected 12 teams, got ${teams.length}`);
  assertEqual(players.length, 60, `expected 60 players, got ${players.length}`);
  assertEqual(
    league.teamIds.length,
    teams.length,
    'league.teamIds length must match teams length'
  );

  // id uniqueness + na- prefix namespacing
  const teamIds = new Set();
  for (const t of teams) {
    assert(typeof t.id === 'string' && t.id.length > 0, 'team.id missing');
    assert(t.id.startsWith('na-'), `team id must be namespaced with "na-": ${t.id}`);
    assert(!teamIds.has(t.id), `duplicate team id: ${t.id}`);
    teamIds.add(t.id);
  }
  for (const id of league.teamIds) {
    assert(teamIds.has(id), `league.teamIds references unknown team: ${id}`);
  }

  const playerIds = new Set();
  for (const p of players) {
    assert(typeof p.id === 'string' && p.id.length > 0, 'player.id missing');
    assert(!playerIds.has(p.id), `duplicate player id: ${p.id}`);
    playerIds.add(p.id);
  }

  section('seed/americas — rosters (exactly 5 each)');

  const byTeam = new Map(teams.map((t) => [t.id, t]));
  const contractCount = new Map([...teamIds].map((id) => [id, 0]));

  for (const t of teams) {
    assert(Array.isArray(t.roster), `team ${t.id} roster must be an array`);
    assertEqual(t.roster.length, 5, `team ${t.id} must have exactly 5 players`);
    const seen = new Set();
    for (const pid of t.roster) {
      assert(playerIds.has(pid), `team ${t.id} roster references unknown player: ${pid}`);
      assert(!seen.has(pid), `team ${t.id} roster has duplicate player: ${pid}`);
      seen.add(pid);
    }
  }

  for (const p of players) {
    const teamId = p.contract && p.contract.teamId;
    assert(byTeam.has(teamId), `player ${p.id} contract.teamId unknown: ${teamId}`);
    contractCount.set(teamId, contractCount.get(teamId) + 1);
    assert(
      byTeam.get(teamId).roster.includes(p.id),
      `player ${p.id} not listed in roster of ${teamId}`
    );
    assert(ROLES.has(p.role), `player ${p.id} has invalid role: ${p.role}`);
    assert(p.attributes && typeof p.attributes === 'object', `player ${p.id} attributes missing`);
    for (const k of ATTR_KEYS) {
      const v = p.attributes[k];
      assert(
        typeof v === 'number' && v >= 0 && v <= 100,
        `player ${p.id} attribute ${k} out of range: ${v}`
      );
    }
  }

  for (const [tid, n] of contractCount) {
    assertEqual(n, 5, `team ${tid} must have exactly 5 contracted players`);
  }

  section('seed/americas — domain normalization');

  // Every player normalizes cleanly through createPlayer.
  for (const p of players) {
    const np = createPlayer(p);
    assert(np && typeof np === 'object', `createPlayer returned non-object for ${p.id}`);
    assertEqual(np.id, p.id, `createPlayer changed id for ${p.id}`);
    assert(np.attributes && typeof np.attributes === 'object', `normalized ${p.id} lost attributes`);
    for (const k of ATTR_KEYS) {
      const v = np.attributes[k];
      assert(
        typeof v === 'number' && v >= 0 && v <= 100,
        `normalized ${p.id} attribute ${k} not clamped 0-100: ${v}`
      );
    }
    assert(np.dynamics && typeof np.dynamics === 'object', `normalized ${p.id} missing dynamics`);
    assert(np.contract && typeof np.contract === 'object', `normalized ${p.id} missing contract`);
  }

  // Every team normalizes cleanly through createTeam.
  for (const t of teams) {
    const nt = createTeam(t);
    assert(nt && typeof nt === 'object', `createTeam returned non-object for ${t.id}`);
    assertEqual(nt.id, t.id, `createTeam changed id for ${t.id}`);
    assert(Array.isArray(nt.roster) && nt.roster.length >= 5, `normalized team ${t.id} roster < 5`);
    assertEqual(nt.leagueId, 'americas', `normalized team ${t.id} leagueId should be americas`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `seed/americas: ${teams.length} teams, ${players.length} players normalized cleanly`
  );
}
