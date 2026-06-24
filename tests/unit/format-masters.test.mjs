/**
 * tests/unit/format-masters.test.mjs — MASTERS_FORMAT end-to-end smoke
 * (CONTRACTS-SEASON §3, §8).
 *
 * Mints 12 generic teams, runs simEvent(MASTERS_FORMAT, ctx, seed) over several
 * seeds and asserts:
 *   - exactly 12 placements, ranks 1..12 unique, 12 distinct teams;
 *   - the swiss stage (entrants seeds 5..12, 2 wins advance / 2 losses out)
 *     produces exactly 4 advancers; the 4 swiss-eliminated rank 9..12;
 *   - the double/8 playoff has 8 distinct entrants (4 direct + 4 swiss advancers);
 *   - real engine-backed series; determinism (same seed -> deep-equal).
 */

import { assert, assertEqual } from '../_assert.mjs';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { simEvent } from '../../src/engine/format/formatEngine.js';
import { MASTERS_FORMAT } from '../../src/config/formats/masters.js';

const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel', 'Initiator'];

function mintWorld(n) {
  /** @type {Record<string,object>} */ const teamsById = {};
  /** @type {Record<string,object>} */ const playersById = {};
  const seedOrder = [];
  for (let t = 0; t < n; t++) {
    const tag = `M${String(t + 1).padStart(2, '0')}`;
    const roster = [];
    for (let p = 0; p < 5; p++) {
      const player = createPlayer({
        id: `${tag}-p${p + 1}`,
        name: `${tag} Player ${p + 1}`,
        role: ROLES[p],
        attributes: { aim: 58 + ((t * 11 + p * 3) % 38), gameSense: 58 + ((t * 5 + p) % 38) }
      });
      playersById[player.id] = player;
      roster.push(player.id);
    }
    const team = createTeam({ id: tag, name: `Team ${tag}`, tag, roster });
    teamsById[team.id] = team;
    seedOrder.push(team.id);
  }
  return { teamsById, playersById, seedOrder };
}

function assertRealSeries(ev, tag) {
  assert(ev.series.length > 0, `${tag}: at least one series played`);
  for (const s of ev.series) {
    assert(Array.isArray(s.maps) && s.maps.length > 0, `${tag}: series ${s.matchId} has maps`);
    assert(s.winnerId === s.teamAId || s.winnerId === s.teamBId,
      `${tag}: series ${s.matchId} winner is a participant`);
    for (const mp of s.maps) {
      assert(mp && mp.score && Number.isInteger(mp.score.A) && Number.isInteger(mp.score.B),
        `${tag}: map in ${s.matchId} has finalized box score`);
    }
  }
}

export default async function run() {
  const seeds = [3, 11, 99, 2024, 71717, 314159];
  let observedPlacements = 0;

  for (const seed of seeds) {
    const { teamsById, playersById, seedOrder } = mintWorld(12);
    const ctx = { eventId: `masters-${seed}`, teamsById, playersById, seedOrder };
    const ev = simEvent(MASTERS_FORMAT, ctx, seed);
    const tag = `masters seed ${seed}`;

    assertEqual(ev.type, 'masters', `${tag}: type is masters`);
    assertEqual(ev.formatId, 'masters', `${tag}: formatId is masters`);

    // 12 placements, ranks 1..12, all distinct teams.
    assertEqual(ev.placements.length, 12, `${tag}: exactly 12 placements`);
    observedPlacements = ev.placements.length;
    const ranks = ev.placements.map((p) => p.rank).slice().sort((a, b) => a - b);
    assertEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], `${tag}: ranks 1..12 no gaps`);
    assertEqual(new Set(ev.placements.map((p) => p.teamId)).size, 12, `${tag}: 12 distinct teams`);

    // swiss -> double/8 playoff.
    assertEqual(ev.stages.length, 2, `${tag}: 2 stages`);
    const [swiss, playoff] = ev.stages;
    assertEqual(swiss.kind, 'swiss', `${tag}: first stage swiss`);
    assertEqual(playoff.kind, 'bracket', `${tag}: second stage bracket`);

    // Exactly 4 swiss advancers.
    assertEqual(swiss.advancers.length, 4, `${tag}: 4 swiss advancers`);

    // Playoff = 4 direct seeds (1..4) + 4 swiss advancers, all distinct.
    const directSeeds = seedOrder.slice(0, 4);
    const playoffTeams = new Set([...directSeeds, ...swiss.advancers]);
    assertEqual(playoffTeams.size, 8, `${tag}: 8 distinct playoff entrants`);

    // The 4 swiss-eliminated occupy ranks 9..12.
    const swissEntrants = seedOrder.slice(4, 12); // seeds 5..12
    const swissEliminated = swissEntrants.filter((id) => !swiss.advancers.includes(id));
    assertEqual(swissEliminated.length, 4, `${tag}: 4 swiss eliminated`);
    const lowFour = new Set(ev.placements.filter((p) => p.rank >= 9).map((p) => p.teamId));
    for (const id of swissEliminated) {
      assert(lowFour.has(id), `${tag}: swiss-eliminated ${id} ranks 9..12`);
    }

    assertRealSeries(ev, tag);

    const again = simEvent(MASTERS_FORMAT,
      { eventId: `masters-${seed}`, ...mintWorld(12) }, seed);
    assertEqual(JSON.stringify(ev), JSON.stringify(again), `${tag}: deterministic`);
  }

  assertEqual(observedPlacements, 12, 'MASTERS returns 12 placements');
}
