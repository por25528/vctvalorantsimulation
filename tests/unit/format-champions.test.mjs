/**
 * tests/unit/format-champions.test.mjs — CHAMPIONS_FORMAT end-to-end smoke
 * (CONTRACTS-SEASON §3, §8).
 *
 * Mints 16 generic teams, runs simEvent(CHAMPIONS_FORMAT, ctx, seed) over several
 * seeds and asserts:
 *   - exactly 16 placements, ranks 1..16 unique, 16 distinct teams;
 *   - the swiss stage (entrants seeds 1..16, 3 wins advance / 3 losses out)
 *     produces exactly 8 advancers; the 8 swiss-eliminated rank 9..16;
 *   - the double/8 playoff has 8 distinct entrants (the swiss advancers);
 *   - real engine-backed series; determinism (same seed -> deep-equal).
 */

import { assert, assertEqual } from '../_assert.mjs';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { simEvent } from '../../src/engine/format/formatEngine.js';
import { CHAMPIONS_FORMAT } from '../../src/config/formats/champions.js';

const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel', 'Initiator'];

function mintWorld(n) {
  /** @type {Record<string,object>} */ const teamsById = {};
  /** @type {Record<string,object>} */ const playersById = {};
  const seedOrder = [];
  for (let t = 0; t < n; t++) {
    const tag = `C${String(t + 1).padStart(2, '0')}`;
    const roster = [];
    for (let p = 0; p < 5; p++) {
      const player = createPlayer({
        id: `${tag}-p${p + 1}`,
        name: `${tag} Player ${p + 1}`,
        role: ROLES[p],
        attributes: { aim: 56 + ((t * 9 + p * 3) % 40), gameSense: 56 + ((t * 5 + p) % 40) }
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
  const seeds = [5, 13, 88, 2026, 60606, 271828];
  let observedPlacements = 0;

  for (const seed of seeds) {
    const { teamsById, playersById, seedOrder } = mintWorld(16);
    const ctx = { eventId: `champions-${seed}`, teamsById, playersById, seedOrder };
    const ev = simEvent(CHAMPIONS_FORMAT, ctx, seed);
    const tag = `champions seed ${seed}`;

    assertEqual(ev.type, 'champions', `${tag}: type is champions`);
    assertEqual(ev.formatId, 'champions', `${tag}: formatId is champions`);

    // 16 placements, ranks 1..16, all distinct teams.
    assertEqual(ev.placements.length, 16, `${tag}: exactly 16 placements`);
    observedPlacements = ev.placements.length;
    const ranks = ev.placements.map((p) => p.rank).slice().sort((a, b) => a - b);
    assertEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      `${tag}: ranks 1..16 no gaps`);
    assertEqual(new Set(ev.placements.map((p) => p.teamId)).size, 16, `${tag}: 16 distinct teams`);

    // swiss -> double/8 playoff.
    assertEqual(ev.stages.length, 2, `${tag}: 2 stages`);
    const [swiss, playoff] = ev.stages;
    assertEqual(swiss.kind, 'swiss', `${tag}: first stage swiss`);
    assertEqual(playoff.kind, 'bracket', `${tag}: second stage bracket`);

    // Exactly 8 swiss advancers, all distinct, feeding the 8-team playoff.
    assertEqual(swiss.advancers.length, 8, `${tag}: 8 swiss advancers`);
    assertEqual(new Set(swiss.advancers).size, 8, `${tag}: 8 distinct advancers`);

    // The 8 swiss-eliminated occupy ranks 9..16.
    const eliminated = seedOrder.filter((id) => !swiss.advancers.includes(id));
    assertEqual(eliminated.length, 8, `${tag}: 8 swiss eliminated`);
    const lowEight = new Set(ev.placements.filter((p) => p.rank >= 9).map((p) => p.teamId));
    for (const id of eliminated) {
      assert(lowEight.has(id), `${tag}: swiss-eliminated ${id} ranks 9..16`);
    }

    assertRealSeries(ev, tag);

    const again = simEvent(CHAMPIONS_FORMAT,
      { eventId: `champions-${seed}`, ...mintWorld(16) }, seed);
    assertEqual(JSON.stringify(ev), JSON.stringify(again), `${tag}: deterministic`);
  }

  assertEqual(observedPlacements, 16, 'CHAMPIONS returns 16 placements');
}
