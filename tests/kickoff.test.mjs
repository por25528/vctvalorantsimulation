/**
 * tests/kickoff.test.mjs — adversarial end-to-end Kickoff verification
 * (CONTRACTS-FORMAT §9 invariants, §10).
 *
 * Builds the normalized 12-team world from PACIFIC_SEED (every player via
 * createPlayer, every team via createTeam), then runs simEvent(KICKOFF, ctx,
 * seed) for >=25 distinct seeds and asserts EVERY §9 invariant on each result:
 *
 *   1. Loss invariant     — placements 1/2/3/4 have 0/1/2/3 losses; nobody is
 *                           eliminated with <3 losses; nobody placed exceeds 3.
 *   2. Structural         — 12 unique ranks 1..12, all participants once; 8 teams
 *                           in the playoff; 4 advance per group; 9..12 are the
 *                           non-advancers.
 *   3. Qualification      — exactly 3: 1 -> masters-playoff, 2 & 3 -> masters-swiss.
 *   4. CP                 — 4/3/2/1 to the top 4; 0 for placements 5..12.
 *   5. No double-booking  — no team is both sides of a match; every series winner
 *                           is one of its two participants.
 *   6. Engine-backed      — every series has real maps with finalized box scores.
 *   7. Determinism        — same seed -> deep-equal EventResult; different seed
 *                           -> different bracket outcomes.
 *
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from './_assert.mjs';
import { createPlayer } from '../src/domain/player.js';
import { createTeam } from '../src/domain/team.js';
import { PACIFIC_SEED } from '../src/data/seed/pacific.js';
import { simEvent } from '../src/engine/format/formatEngine.js';
import { KICKOFF_FORMAT } from '../src/config/formats/kickoff.js';
import { kickoffQualifiers } from '../src/engine/career/qualification.js';
import { awardCP } from '../src/engine/career/championshipPoints.js';
import { CP_TABLE } from '../src/config/cpTable.js';

/**
 * Normalize PACIFIC_SEED into the simEvent ctx: 12 teams (createTeam), 60 players
 * (createPlayer), keyed by id.
 * @returns {{ teamsById:Record<string,object>, playersById:Record<string,object>, ids:string[] }}
 */
function buildWorld() {
  /** @type {Record<string,object>} */
  const playersById = {};
  for (const p of PACIFIC_SEED.players) {
    const player = createPlayer(p);
    playersById[player.id] = player;
  }
  /** @type {Record<string,object>} */
  const teamsById = {};
  const ids = [];
  for (const t of PACIFIC_SEED.teams) {
    const team = createTeam(t);
    teamsById[team.id] = team;
    ids.push(team.id);
  }
  return { teamsById, playersById, ids };
}

/** Deterministic equality probe for whole EventResults / sub-structures. */
function stable(v) {
  return JSON.stringify(v);
}

/**
 * Assert a single EventResult satisfies every §9 invariant.
 * @param {object} ev    EventResult from simEvent
 * @param {string[]} allIds  the 12 participant teamIds
 * @param {number|string} seed
 */
function assertInvariants(ev, allIds, seed) {
  const tag = `seed ${seed}`;

  // --- basic identity ------------------------------------------------------
  assertEqual(ev.type, 'kickoff', `${tag}: event type is kickoff`);
  assertEqual(ev.formatId, 'kickoff', `${tag}: formatId is kickoff`);

  // === 2. STRUCTURAL =======================================================
  assertEqual(ev.placements.length, 12, `${tag}: exactly 12 placements`);
  const ranks = ev.placements.map((p) => p.rank).slice().sort((a, b) => a - b);
  assertEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    `${tag}: ranks 1..12 unique, no gaps`);
  const placedTeams = ev.placements.map((p) => p.teamId);
  assertEqual(new Set(placedTeams).size, 12, `${tag}: 12 distinct teams placed`);
  for (const id of allIds) {
    assert(placedTeams.includes(id), `${tag}: participant ${id} is placed`);
  }

  // Three stages: groupA gsl, groupB gsl, playoff triple.
  assertEqual(ev.stages.length, 3, `${tag}: 3 stages`);
  const [groupA, groupB, playoff] = ev.stages;
  assertEqual(groupA.stageId, 'groupA', `${tag}: first stage is groupA`);
  assertEqual(groupB.stageId, 'groupB', `${tag}: second stage is groupB`);
  assertEqual(playoff.stageId, 'playoff', `${tag}: third stage is playoff`);

  // Exactly 4 advance from each group.
  assertEqual(groupA.advancers.length, 4, `${tag}: group A advances exactly 4`);
  assertEqual(groupB.advancers.length, 4, `${tag}: group B advances exactly 4`);
  assertEqual(new Set([...groupA.advancers, ...groupB.advancers]).size, 8,
    `${tag}: 8 distinct advancers`);

  // Exactly 8 teams in the playoff, and they are precisely the 8 advancers.
  assertEqual(playoff.standings.length, 8, `${tag}: 8 teams in the playoff`);
  const playoffTeams = new Set(playoff.standings.map((s) => s.teamId));
  assertEqual(playoffTeams.size, 8, `${tag}: 8 distinct playoff teams`);
  for (const id of [...groupA.advancers, ...groupB.advancers]) {
    assert(playoffTeams.has(id), `${tag}: advancer ${id} is a playoff team`);
  }

  const byRank = new Map(ev.placements.map((p) => [p.rank, p]));

  // Ranks 1..8 are the playoff teams; 9..12 are the non-advancers.
  for (let r = 1; r <= 8; r++) {
    assert(playoffTeams.has(byRank.get(r).teamId),
      `${tag}: rank ${r} is a playoff team`);
  }
  for (let r = 9; r <= 12; r++) {
    assert(!playoffTeams.has(byRank.get(r).teamId),
      `${tag}: rank ${r} (${byRank.get(r).teamId}) is a group non-advancer`);
  }
  // Group non-advancers: each group contributes exactly 2 of ranks 9..12.
  const nonAdvancers = [9, 10, 11, 12].map((r) => byRank.get(r).teamId);
  const aTeams = new Set(groupA.standings.map((s) => s.teamId));
  const bTeams = new Set(groupB.standings.map((s) => s.teamId));
  const naFromA = nonAdvancers.filter((id) => aTeams.has(id)).length;
  const naFromB = nonAdvancers.filter((id) => bTeams.has(id)).length;
  assertEqual(naFromA, 2, `${tag}: 2 non-advancers from group A`);
  assertEqual(naFromB, 2, `${tag}: 2 non-advancers from group B`);

  // === 1. LOSS INVARIANT ===================================================
  assertEqual(byRank.get(1).losses, 0, `${tag}: placement 1 has 0 losses`);
  assertEqual(byRank.get(2).losses, 1, `${tag}: placement 2 has 1 loss`);
  assertEqual(byRank.get(3).losses, 2, `${tag}: placement 3 has 2 losses`);
  assertEqual(byRank.get(4).losses, 3, `${tag}: placement 4 has 3 losses`);
  // Ranks 5..8 are eliminated in the playoff with exactly 3 losses.
  for (let r = 5; r <= 8; r++) {
    assertEqual(byRank.get(r).losses, 3,
      `${tag}: eliminated playoff placement ${r} has exactly 3 losses`);
    assert(byRank.get(r).eliminatedIn !== undefined,
      `${tag}: eliminated placement ${r} records eliminatedIn`);
  }
  // Nobody anywhere exceeds 3 losses; nobody placed in the top 4 (survivors) <3
  // except by the exact ladder above. Group non-advancers exit at <3 (gsl cap 2)
  // — they were eliminated within their group, never reaching the playoff.
  for (const p of ev.placements) {
    assert(p.losses <= 3, `${tag}: ${p.teamId} (rank ${p.rank}) has <=3 losses`);
  }
  // No team is eliminated FROM THE PLAYOFF with <3 losses: every playoff
  // placement (ranks 1..8) that is not the champion ladder has the exact count.
  // (Already covered by the per-rank checks above.)

  // === 5. NO DOUBLE-BOOKING / engine integrity =============================
  // Every series across the whole event: a != b, winner is a participant.
  for (const s of ev.series) {
    assert(typeof s.teamAId === 'string' && typeof s.teamBId === 'string',
      `${tag}: series has two team ids`);
    assert(s.teamAId !== s.teamBId,
      `${tag}: series ${s.stageId}/${s.matchId} not same team both sides`);
    assert(s.winnerId === s.teamAId || s.winnerId === s.teamBId,
      `${tag}: series ${s.stageId}/${s.matchId} winner is a participant`);
  }
  // Within each stage, each match id appears once (no slot double-booking would
  // have thrown in the engine, but assert match-id uniqueness per stage too).
  const stageMatchKeys = ev.series.map((s) => `${s.stageId}:${s.matchId}`);
  assertEqual(new Set(stageMatchKeys).size, stageMatchKeys.length,
    `${tag}: every (stage,match) series id is unique`);
  // Playoff plays exactly 18 series (triple/8); each gsl group plays 7.
  assertEqual(playoff.series.length, 18, `${tag}: triple playoff plays 18 series`);
  assertEqual(groupA.series.length, 7, `${tag}: group A plays 7 series`);
  assertEqual(groupB.series.length, 7, `${tag}: group B plays 7 series`);

  // === 6. ENGINE-BACKED ====================================================
  for (const s of ev.series) {
    assert(Array.isArray(s.maps) && s.maps.length > 0,
      `${tag}: series ${s.stageId}/${s.matchId} has real maps`);
    // Series score consistent with a decided winner.
    assert(s.score && typeof s.score.A === 'number' && typeof s.score.B === 'number',
      `${tag}: series ${s.stageId}/${s.matchId} has a numeric map score`);
    assert(s.score.A !== s.score.B,
      `${tag}: series ${s.stageId}/${s.matchId} has a decisive score`);
    for (const mp of s.maps) {
      // Real, finalized box score: a record per player with computed stats.
      assert(mp.boxScore && typeof mp.boxScore === 'object',
        `${tag}: map ${mp.mapId} has a box score`);
      const ids = Object.keys(mp.boxScore);
      assert(ids.length >= 10,
        `${tag}: map ${mp.mapId} box score covers both lineups (>=10 players)`);
      let kills = 0;
      for (const pid of ids) {
        const st = mp.boxScore[pid];
        assert(typeof st.kills === 'number' && typeof st.deaths === 'number',
          `${tag}: box score for ${pid} has k/d`);
        assert(typeof st.acs === 'number' && Number.isFinite(st.acs),
          `${tag}: box score for ${pid} has finalized acs`);
        assert(typeof st.kd === 'number' && Number.isFinite(st.kd),
          `${tag}: box score for ${pid} has finalized kd`);
        kills += st.kills;
      }
      assert(kills > 0, `${tag}: map ${mp.mapId} recorded real kills`);
      assert(typeof mp.mvpPlayerId === 'string' && mp.mvpPlayerId.length > 0,
        `${tag}: map ${mp.mapId} named an MVP`);
      assert(mp.winner === 'A' || mp.winner === 'B',
        `${tag}: map ${mp.mapId} has a winner side`);
    }
  }

  // === 3. QUALIFICATION ====================================================
  const quals = kickoffQualifiers(ev);
  assertEqual(quals.length, 3, `${tag}: exactly 3 qualifiers`);
  assertEqual(quals[0].teamId, byRank.get(1).teamId, `${tag}: qualifier 1 = placement 1`);
  assertEqual(quals[0].seedInto, 'masters-playoff', `${tag}: placement 1 -> masters-playoff`);
  assertEqual(quals[1].teamId, byRank.get(2).teamId, `${tag}: qualifier 2 = placement 2`);
  assertEqual(quals[1].seedInto, 'masters-swiss', `${tag}: placement 2 -> masters-swiss`);
  assertEqual(quals[2].teamId, byRank.get(3).teamId, `${tag}: qualifier 3 = placement 3`);
  assertEqual(quals[2].seedInto, 'masters-swiss', `${tag}: placement 3 -> masters-swiss`);

  // === 4. CP ===============================================================
  const cp = awardCP(ev, CP_TABLE);
  assertEqual(cp[byRank.get(1).teamId], 4, `${tag}: placement 1 gets 4 CP`);
  assertEqual(cp[byRank.get(2).teamId], 3, `${tag}: placement 2 gets 3 CP`);
  assertEqual(cp[byRank.get(3).teamId], 2, `${tag}: placement 3 gets 2 CP`);
  assertEqual(cp[byRank.get(4).teamId], 1, `${tag}: placement 4 gets 1 CP`);
  for (let r = 5; r <= 12; r++) {
    assertEqual(cp[byRank.get(r).teamId], 0, `${tag}: placement ${r} gets 0 CP`);
  }
}

export default async function kickoffTest() {
  section('kickoff — end-to-end §9 invariants over many seeds');

  const { teamsById, playersById, ids } = buildWorld();
  assertEqual(ids.length, 12, 'PACIFIC_SEED has exactly 12 teams');
  assertEqual(Object.keys(playersById).length, 60, 'PACIFIC_SEED has 60 players (5x12)');
  for (const id of ids) {
    assert(teamsById[id].roster.length === 5, `${id} normalized to a 5-man roster`);
  }

  const ctx = { eventId: 'kickoff-2026', teamsById, playersById };

  // 25 distinct seeds (mix of small ints, primes, and big labels-as-numbers).
  const seeds = [
    1, 2, 3, 5, 7, 11, 13, 17, 19, 23,
    29, 31, 37, 41, 43, 47, 53, 99, 100, 256,
    1024, 4096, 12345, 99999, 2026
  ];
  assertEqual(new Set(seeds).size, 25, 'exactly 25 distinct test seeds');

  /** @type {Map<string,string>} per-seed fingerprint, to verify divergence. */
  const fingerprints = new Map();

  for (const seed of seeds) {
    const ev = simEvent(KICKOFF_FORMAT, ctx, seed);
    assertInvariants(ev, ids, seed);

    // === 7. DETERMINISM (same seed) ======================================
    const again = simEvent(KICKOFF_FORMAT, ctx, seed);
    assertEqual(again.placements, ev.placements,
      `seed ${seed}: re-sim -> identical placements`);
    assertEqual(
      again.series.map((s) => [s.stageId, s.matchId, s.winnerId, s.score.A, s.score.B]),
      ev.series.map((s) => [s.stageId, s.matchId, s.winnerId, s.score.A, s.score.B]),
      `seed ${seed}: re-sim -> identical series outcomes`);
    assertEqual(stable(again), stable(ev), `seed ${seed}: re-sim -> deep-equal EventResult`);

    // Fingerprint the bracket outcome (placements + every series winner/score).
    const fp = stable({
      placements: ev.placements.map((p) => [p.rank, p.teamId, p.losses]),
      series: ev.series.map((s) => [s.stageId, s.matchId, s.winnerId, s.score.A, s.score.B])
    });
    fingerprints.set(String(seed), fp);
  }

  // === 7. DETERMINISM (different seed -> different outcome) ================
  // Across 25 seeds the bracket outcomes must not all collapse to one result —
  // require a large number of distinct fingerprints (different seeds differ).
  const distinct = new Set(fingerprints.values());
  assert(distinct.size >= 24,
    `different seeds diverge: ${distinct.size}/25 distinct bracket fingerprints (expected >=24)`);

  // And a direct pairwise check on two arbitrary seeds.
  assert(fingerprints.get('1') !== fingerprints.get('2'),
    'seeds 1 and 2 produce different bracket outcomes');

  // eslint-disable-next-line no-console
  console.log(
    `kickoff: 25 seeds x full §9 invariants OK; ` +
    `${distinct.size}/25 distinct bracket outcomes; each event = 32 series (7+7+18).`);
}
