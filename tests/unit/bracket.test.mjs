/**
 * tests/unit/bracket.test.mjs — engine/format/bracket.js & gsl.js
 * (CONTRACTS-FORMAT §4, §5).
 *
 * Covers:
 *  - buildTemplate shapes for triple/8, double/8, gsl6, single/N;
 *  - triple/8 CRITICAL loss invariant (1st:0, 2nd:1, 3rd:2, 4th:3; elim=3 losses)
 *    over many seeds, plus structural rank uniqueness;
 *  - double/8 placements (8 unique ranks, loss cap 2);
 *  - gsl6 — exactly 4 advance / 2 eliminated, advancers in rank order, cap 2;
 *  - determinism: same makeSeed -> deep-equal output; different seed -> differs.
 *
 * Deterministic: every series is decided by simSeries seeded via makeSeed(matchId)
 * == hashSeed(eventSeed, stageId, matchId). No Math.random. Default export is an
 * async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { hashSeed } from '../../src/core/hash.js';
import { buildTemplate, simulateBracket } from '../../src/engine/format/bracket.js';
import { run as gslRun } from '../../src/engine/format/gsl.js';

/**
 * Build n teams (5-man rosters) with a slight per-team skill slant so series are
 * decisive, plus the players lookup. Returns teamsById + seed-ordered ids.
 * @param {number} n
 * @returns {{ players:Record<string,object>, teamsById:Record<string,object>, ids:string[] }}
 */
function makeWorld(n) {
  /** @type {Record<string,object>} */
  const players = {};
  /** @type {Record<string,object>} */
  const teamsById = {};
  const ids = [];
  const roles = ['Controller', 'Initiator', 'Sentinel', 'Duelist', 'Duelist'];
  for (let t = 0; t < n; t++) {
    const tid = `T${t}`;
    ids.push(tid);
    const roster = [];
    const skill = 60 + ((t * 7) % 30); // spread 60..89 so matchups aren't all coinflips
    for (let i = 0; i < 5; i++) {
      const pid = `${tid}_p${i}`;
      players[pid] = createPlayer({
        id: pid,
        name: pid,
        role: roles[i],
        attributes: {
          aim: skill, reaction: skill, movement: skill, gameSense: skill,
          trading: 70, composure: 70, utility: 60, igl: i === 0 ? 70 : 30
        }
      });
      roster.push(pid);
    }
    teamsById[tid] = createTeam({ id: tid, name: tid, tag: tid, roster });
  }
  return { players, teamsById, ids };
}

/** A makeSeed factory: hashSeed(eventSeed, stageId, matchId). */
const seedFactory = (eventSeed, stageId) => (matchId) => hashSeed(eventSeed, stageId, matchId);

export default async function bracketTest() {
  section('engine/format/bracket');

  // --- buildTemplate shapes ------------------------------------------------
  {
    assertEqual(buildTemplate('triple', 8).length, 18, 'triple/8 has 18 matches');
    assertEqual(buildTemplate('double', 8).length, 14, 'double/8 has 14 matches');
    assertEqual(buildTemplate('gsl6').length, 7, 'gsl6 has 7 matches');
    assertEqual(buildTemplate('single', 8).length, 7, 'single/8 has 7 matches');

    // triple LF is the series final (Bo5 marker in the template).
    const lf = buildTemplate('triple', 8).find((m) => m.id === 'LF');
    assertEqual(lf.bestOf, 5, 'triple LF is best-of-5');
    assertEqual(lf.winnerTo.placement, 3, 'triple LF winner -> placement 3');
    assertEqual(lf.loserTo.placement, 4, 'triple LF loser -> placement 4');

    let threw = false;
    try { buildTemplate('triple', 6); } catch { threw = true; }
    assert(threw, 'buildTemplate triple rejects wrong size');
    threw = false;
    try { buildTemplate('single', 6); } catch { threw = true; }
    assert(threw, 'buildTemplate single rejects non-power-of-two');
  }

  // --- triple/8: CRITICAL loss invariant over many seeds -------------------
  {
    const { players, teamsById, ids } = makeWorld(8);
    let checked = 0;
    for (let seed = 0; seed < 30; seed++) {
      const r = simulateBracket(
        buildTemplate('triple', 8),
        ids,
        { teamsById, playersById: players, stageId: 'playoff', bracketType: 'triple' },
        seedFactory(seed, 'playoff')
      );

      // 18 series, all engine-backed (real winners among the two teams).
      assertEqual(r.series.length, 18, `triple seed ${seed}: 18 series`);
      for (const s of r.series) {
        assert(s.winnerId === s.teamAId || s.winnerId === s.teamBId,
          `triple seed ${seed}: series winner is one of its teams`);
        assertEqual(s.stageId, 'playoff', `triple seed ${seed}: series carries stageId`);
        assert(typeof s.matchId === 'string', `triple seed ${seed}: series carries matchId`);
      }

      // Ranks 1..8 unique, every team present once.
      const ranks = r.placements.map((p) => p.rank).sort((a, b) => a - b);
      assertEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8], `triple seed ${seed}: ranks 1..8 unique`);
      assertEqual(new Set(r.placements.map((p) => p.teamId)).size, 8,
        `triple seed ${seed}: 8 distinct teams placed`);

      // THE invariant: placement 1=0 losses, 2=1, 3=2, 4=3; elim (5-8) = 3 losses.
      const byRank = new Map(r.placements.map((p) => [p.rank, p]));
      assertEqual(byRank.get(1).losses, 0, `triple seed ${seed}: placement 1 has 0 losses`);
      assertEqual(byRank.get(2).losses, 1, `triple seed ${seed}: placement 2 has 1 loss`);
      assertEqual(byRank.get(3).losses, 2, `triple seed ${seed}: placement 3 has 2 losses`);
      assertEqual(byRank.get(4).losses, 3, `triple seed ${seed}: placement 4 has 3 losses`);
      for (let rank = 5; rank <= 8; rank++) {
        assertEqual(byRank.get(rank).losses, 3,
          `triple seed ${seed}: eliminated placement ${rank} has exactly 3 losses`);
        assert(typeof byRank.get(rank).eliminatedIn === 'string',
          `triple seed ${seed}: eliminated placement ${rank} records eliminatedIn`);
      }
      checked++;
    }
    assert(checked === 30, 'triple invariant verified across 30 seeds');
  }

  // --- double/8: 8 unique placements, loss cap 2 ---------------------------
  {
    const { players, teamsById, ids } = makeWorld(8);
    for (let seed = 0; seed < 20; seed++) {
      const r = simulateBracket(
        buildTemplate('double', 8),
        ids,
        { teamsById, playersById: players, stageId: 'de', bracketType: 'double' },
        seedFactory(seed, 'de')
      );
      assertEqual(r.series.length, 14, `double seed ${seed}: 14 series`);
      const ranks = r.placements.map((p) => p.rank).sort((a, b) => a - b);
      assertEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8], `double seed ${seed}: ranks 1..8 unique`);
      for (const p of r.placements) {
        assert(p.losses <= 2, `double seed ${seed}: ${p.teamId} loss cap 2 (has ${p.losses})`);
      }
      // GF winner (placement 1) has 0 losses (won upper bracket through GF) OR
      // came through lower — but as upper-bracket champ it never lost, so <=1.
      assert(r.placements.find((p) => p.rank === 1).losses <= 1,
        `double seed ${seed}: champion has at most 1 loss`);
    }
  }

  // --- gsl6: exactly 4 advance / 2 eliminated, advancers ranked, cap 2 -----
  {
    const { players, teamsById, ids } = makeWorld(6);
    for (let seed = 0; seed < 30; seed++) {
      const stage = { id: 'group', bracketType: 'gsl6', seriesLen: { default: 3 } };
      const sr = gslRun(stage, ids, { teamsById, playersById: players }, seedFactory(seed, 'group'));

      assertEqual(sr.advancers.length, 4, `gsl6 seed ${seed}: exactly 4 advance`);
      assertEqual(sr.standings.length, 6, `gsl6 seed ${seed}: 6 teams ranked`);

      const advSet = new Set(sr.advancers);
      const eliminated = sr.standings.filter((s) => !advSet.has(s.teamId));
      assertEqual(eliminated.length, 2, `gsl6 seed ${seed}: exactly 2 eliminated`);

      // Advancers occupy ranks 1..4, in rank order.
      const advRanks = sr.standings.filter((s) => advSet.has(s.teamId)).map((s) => s.rank);
      assertEqual(advRanks.sort((a, b) => a - b), [1, 2, 3, 4],
        `gsl6 seed ${seed}: advancers occupy ranks 1..4`);
      const advByRank = sr.standings
        .filter((s) => advSet.has(s.teamId))
        .sort((a, b) => a.rank - b.rank)
        .map((s) => s.teamId);
      assertEqual(sr.advancers, advByRank, `gsl6 seed ${seed}: advancers listed in rank order`);

      // Loss cap 2 respected for every team.
      for (const s of sr.standings) {
        assert(s.l <= 2, `gsl6 seed ${seed}: ${s.teamId} loss cap 2 (has ${s.l})`);
      }
      // The two upper-final teams advance with <=1 loss.
      for (const s of sr.standings.filter((x) => x.rank <= 2)) {
        assert(s.l <= 1, `gsl6 seed ${seed}: top-2 advancer has <=1 loss`);
      }
    }
  }

  // --- determinism: same seed -> deep-equal; different seed -> differs ------
  {
    const { players, teamsById, ids } = makeWorld(8);
    const a = simulateBracket(
      buildTemplate('triple', 8), ids,
      { teamsById, playersById: players, stageId: 'p', bracketType: 'triple' },
      seedFactory(12345, 'p')
    );
    const b = simulateBracket(
      buildTemplate('triple', 8), ids,
      { teamsById, playersById: players, stageId: 'p', bracketType: 'triple' },
      seedFactory(12345, 'p')
    );
    assertEqual(a.placements, b.placements, 'same seed -> identical placements');
    assertEqual(
      a.series.map((s) => [s.matchId, s.winnerId, s.score.A, s.score.B]),
      b.series.map((s) => [s.matchId, s.winnerId, s.score.A, s.score.B]),
      'same seed -> identical series outcomes'
    );

    // The engine still RESPONDS to the seed: across a range of seeds the full
    // series signature is not constant (close matchups still flip on luck). We
    // scan rather than compare two fixed seeds, since a decisive favourite can
    // make any two particular seeds coincide (skill > luck is the intended feel).
    const sig = (seed) =>
      JSON.stringify(
        simulateBracket(
          buildTemplate('triple', 8), ids,
          { teamsById, playersById: players, stageId: 'p', bracketType: 'triple' },
          seedFactory(seed, 'p')
        ).series.map((s) => [s.matchId, s.winnerId, s.score.A, s.score.B])
      );
    const sigs = new Set();
    for (let seed = 0; seed < 60; seed++) sigs.add(sig(seed));
    assert(sigs.size >= 2, 'different seeds still produce different bracket outcomes (>=2 over 60 seeds)');
  }
}
