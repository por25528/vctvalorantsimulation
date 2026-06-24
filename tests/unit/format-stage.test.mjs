/**
 * tests/unit/format-stage.test.mjs — STAGE_FORMAT end-to-end smoke
 * (CONTRACTS-SEASON §3, §8).
 *
 * Mints 12 generic teams (createTeam / createPlayer), runs
 * simEvent(STAGE_FORMAT, ctx, seed) over several seeds and asserts:
 *   - exactly 12 placements, ranks 1..12 unique, 12 distinct teams;
 *   - real engine-backed series were played (every series has finalized maps);
 *   - the two roundRobin groups each advance exactly 4 into the double/8 playoff;
 *   - determinism: same seed -> deep-equal EventResult.
 */

import { assert, assertEqual } from '../_assert.mjs';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { simEvent } from '../../src/engine/format/formatEngine.js';
import { STAGE_FORMAT } from '../../src/config/formats/stage.js';

const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel', 'Initiator'];

/**
 * Mint a deterministic world of `n` teams x 5 players (no Math.random).
 * @param {number} n
 * @returns {{teamsById:Record<string,object>,playersById:Record<string,object>,seedOrder:string[]}}
 */
function mintWorld(n) {
  /** @type {Record<string,object>} */ const teamsById = {};
  /** @type {Record<string,object>} */ const playersById = {};
  const seedOrder = [];
  for (let t = 0; t < n; t++) {
    const tag = `T${String(t + 1).padStart(2, '0')}`;
    const roster = [];
    for (let p = 0; p < 5; p++) {
      const player = createPlayer({
        id: `${tag}-p${p + 1}`,
        name: `${tag} Player ${p + 1}`,
        role: ROLES[p],
        attributes: { aim: 58 + ((t * 7 + p * 3) % 38), gameSense: 58 + ((t * 5 + p) % 38) }
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

/** Assert every series is a finalized, engine-backed series. */
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
  const seeds = [1, 7, 42, 1337, 90210, 555123];
  let observedPlacements = 0;

  for (const seed of seeds) {
    const { teamsById, playersById, seedOrder } = mintWorld(12);
    const ctx = { eventId: `stage-${seed}`, teamsById, playersById, seedOrder };
    const ev = simEvent(STAGE_FORMAT, ctx, seed);
    const tag = `stage seed ${seed}`;

    assertEqual(ev.type, 'stage', `${tag}: type is stage`);
    assertEqual(ev.formatId, 'stage', `${tag}: formatId is stage`);

    // 12 placements, ranks 1..12, all distinct teams.
    assertEqual(ev.placements.length, 12, `${tag}: exactly 12 placements`);
    observedPlacements = ev.placements.length;
    const ranks = ev.placements.map((p) => p.rank).slice().sort((a, b) => a - b);
    assertEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], `${tag}: ranks 1..12 no gaps`);
    assertEqual(new Set(ev.placements.map((p) => p.teamId)).size, 12, `${tag}: 12 distinct teams`);
    for (const id of seedOrder) {
      assert(ev.placements.some((p) => p.teamId === id), `${tag}: ${id} placed`);
    }

    // Two roundRobin groups -> double/8 playoff; 4 advance each.
    assertEqual(ev.stages.length, 3, `${tag}: 3 stages`);
    const [groupA, groupB, playoff] = ev.stages;
    assertEqual(groupA.kind, 'roundRobin', `${tag}: groupA roundRobin`);
    assertEqual(groupB.kind, 'roundRobin', `${tag}: groupB roundRobin`);
    assertEqual(playoff.kind, 'bracket', `${tag}: playoff bracket`);
    assertEqual(groupA.advancers.length, 4, `${tag}: group A advances 4`);
    assertEqual(groupB.advancers.length, 4, `${tag}: group B advances 4`);
    assertEqual(new Set([...groupA.advancers, ...groupB.advancers]).size, 8,
      `${tag}: 8 distinct advancers feed the playoff`);

    assertRealSeries(ev, tag);

    // Determinism: same seed -> deep-equal.
    const again = simEvent(STAGE_FORMAT,
      { eventId: `stage-${seed}`, ...mintWorld(12) }, seed);
    assertEqual(JSON.stringify(ev), JSON.stringify(again), `${tag}: deterministic`);
  }

  assertEqual(observedPlacements, 12, 'STAGE returns 12 placements');
}
