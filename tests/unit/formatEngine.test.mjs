/**
 * tests/unit/formatEngine.test.mjs — engine/format/formatEngine.js + the Kickoff
 * descriptor (CONTRACTS-FORMAT §6, §8, §9).
 *
 * Covers:
 *  - simEvent(KICKOFF, ctx, seed) returns exactly 12 placements, ranks 1..12
 *    unique, every participant present once;
 *  - real engine-backed series across both groups + the triple-elim playoff;
 *  - the triple-elim loss invariant on the top 4 (0/1/2/3 losses);
 *  - exactly 8 teams in the playoff, 4 advance per group, non-advancers 9..12;
 *  - determinism: same seed -> deep-equal EventResult; different seed -> differs;
 *  - makeSeedFactory == hashSeed(eventSeed, stageId, matchId).
 *
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { hashSeed } from '../../src/core/hash.js';
import { simEvent, makeSeedFactory } from '../../src/engine/format/formatEngine.js';
import { KICKOFF_FORMAT } from '../../src/config/formats/kickoff.js';

/**
 * Build a 12-team world (5-man rosters) with a per-team skill slant so series are
 * decisive rather than coinflips. Returns teamsById + the players lookup.
 * @returns {{ players:Record<string,object>, teamsById:Record<string,object>, ids:string[] }}
 */
function makeWorld() {
  /** @type {Record<string,object>} */
  const players = {};
  /** @type {Record<string,object>} */
  const teamsById = {};
  const ids = [];
  const roles = ['Controller', 'Initiator', 'Sentinel', 'Duelist', 'Duelist'];
  for (let t = 0; t < 12; t++) {
    const tid = `T${t}`;
    ids.push(tid);
    const roster = [];
    const skill = 58 + ((t * 11) % 34); // spread 58..91
    for (let i = 0; i < 5; i++) {
      const pid = `${tid}_p${i}`;
      players[pid] = createPlayer({
        id: pid,
        name: pid,
        role: roles[i],
        attributes: {
          aim: skill, reaction: skill, movement: skill, gameSense: skill,
          trading: 70, composure: 70, utility: 60, igl: i === 0 ? 72 : 30
        }
      });
      roster.push(pid);
    }
    teamsById[tid] = createTeam({ id: tid, name: tid, tag: tid, roster });
  }
  return { players, teamsById, ids };
}

export default async function formatEngineTest() {
  section('engine/format/formatEngine');

  // --- makeSeedFactory is hashSeed(eventSeed, stageId, matchId) -------------
  {
    const f = makeSeedFactory(42, 'playoff');
    assertEqual(f('UQF1'), hashSeed(42, 'playoff', 'UQF1'),
      'makeSeedFactory == hashSeed(eventSeed, stageId, matchId)');
  }

  const { players, teamsById } = makeWorld();
  const ctx = { eventId: 'kickoff-2026', teamsById, playersById: players };

  // --- structural + invariant checks over several seeds --------------------
  {
    for (const seed of [1, 2, 7, 13, 99]) {
      const ev = simEvent(KICKOFF_FORMAT, ctx, seed);

      assertEqual(ev.type, 'kickoff', `seed ${seed}: event type`);
      assertEqual(ev.formatId, 'kickoff', `seed ${seed}: formatId`);

      // Exactly 12 placements, ranks 1..12 unique, every team once.
      assertEqual(ev.placements.length, 12, `seed ${seed}: 12 placements`);
      const ranks = ev.placements.map((p) => p.rank).sort((a, b) => a - b);
      assertEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        `seed ${seed}: ranks 1..12 unique, no gaps`);
      assertEqual(new Set(ev.placements.map((p) => p.teamId)).size, 12,
        `seed ${seed}: 12 distinct teams placed`);

      // Stages: two gsl groups (4 advance each) + the triple playoff.
      assertEqual(ev.stages.length, 3, `seed ${seed}: 3 stages`);
      const [groupA, groupB, playoff] = ev.stages;
      assertEqual(groupA.advancers.length, 4, `seed ${seed}: group A advances 4`);
      assertEqual(groupB.advancers.length, 4, `seed ${seed}: group B advances 4`);
      assertEqual(playoff.standings.length, 8, `seed ${seed}: 8 teams in the playoff`);
      assertEqual(playoff.series.length, 18, `seed ${seed}: triple playoff plays 18 series`);

      // Every series is engine-backed: real winner among its two teams, real maps.
      for (const s of ev.series) {
        assert(s.winnerId === s.teamAId || s.winnerId === s.teamBId,
          `seed ${seed}: series winner is one of its teams`);
        assert(Array.isArray(s.maps) && s.maps.length > 0,
          `seed ${seed}: series has real maps`);
      }

      // Triple-elim loss invariant on the top 4.
      const byRank = new Map(ev.placements.map((p) => [p.rank, p]));
      assertEqual(byRank.get(1).losses, 0, `seed ${seed}: placement 1 has 0 losses`);
      assertEqual(byRank.get(2).losses, 1, `seed ${seed}: placement 2 has 1 loss`);
      assertEqual(byRank.get(3).losses, 2, `seed ${seed}: placement 3 has 2 losses`);
      assertEqual(byRank.get(4).losses, 3, `seed ${seed}: placement 4 has 3 losses`);

      // The 8 playoff teams occupy ranks 1..8; the 4 group non-advancers 9..12.
      const playoffTeams = new Set(playoff.standings.map((s) => s.teamId));
      for (let r = 1; r <= 8; r++) {
        assert(playoffTeams.has(byRank.get(r).teamId),
          `seed ${seed}: rank ${r} is a playoff team`);
      }
      for (let r = 9; r <= 12; r++) {
        assert(!playoffTeams.has(byRank.get(r).teamId),
          `seed ${seed}: rank ${r} is a group non-advancer`);
      }

      // cp / qualifiers deferred to the career layer.
      assertEqual(ev.cp, {}, `seed ${seed}: cp left empty for career layer`);
      assertEqual(ev.qualifiers, [], `seed ${seed}: qualifiers left empty for career layer`);
    }
  }

  // --- determinism: same seed -> deep-equal; different seed -> differs ------
  {
    const a = simEvent(KICKOFF_FORMAT, ctx, 2026);
    const b = simEvent(KICKOFF_FORMAT, ctx, 2026);
    assertEqual(a.placements, b.placements, 'same seed -> identical placements');
    assertEqual(
      a.series.map((s) => [s.stageId, s.matchId, s.winnerId, s.score.A, s.score.B]),
      b.series.map((s) => [s.stageId, s.matchId, s.winnerId, s.score.A, s.score.B]),
      'same seed -> identical series outcomes'
    );

    const c = simEvent(KICKOFF_FORMAT, ctx, 555);
    const differs =
      JSON.stringify(a.placements) !== JSON.stringify(c.placements) ||
      JSON.stringify(a.series.map((s) => [s.matchId, s.winnerId])) !==
        JSON.stringify(c.series.map((s) => [s.matchId, s.winnerId]));
    assert(differs, 'different seed -> different event outcome');
  }

  // --- provided seedOrder is honored (no draw) -----------------------------
  {
    const seedOrder = Array.from({ length: 12 }, (_, i) => `T${i}`);
    const ev = simEvent(KICKOFF_FORMAT, { ...ctx, seedOrder }, 7);
    assertEqual(ev.placements.length, 12, 'provided seedOrder still yields 12 placements');
  }
}
