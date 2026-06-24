/**
 * tests/unit/boxScore.test.mjs — engine/match/boxScore.js (CONTRACTS §9,§10,§11,§14).
 *
 * Verifies:
 *  - createBoxScore zeroes a PlayerMapStat per roster id (and is immutable input).
 *  - accumulate tallies kills/deaths/firstBloods/firstDeaths/tradeKills/clutches
 *    exactly against a synthetic RoundLog, assigns assists RARELY (0..MAX_PER_KILL
 *    per kill, utility-weighted) via the injected rng, increments roundsPlayed,
 *    returns a NEW box.
 *  - finalize yields sane acs/kd/kast/adr (matching the contract formula).
 *  - pickMvp returns the top fragger / highest-acs player.
 *
 * Deterministic: all randomness via createRng(seed); no Math.random.
 */

import { assert, assertEqual, assertClose, section } from '../_assert.mjs';
import { createRng } from '../../src/core/rng.js';
import { BALANCE } from '../../src/config/balance.js';
import {
  createBoxScore,
  accumulate,
  finalize,
  pickMvp
} from '../../src/engine/match/boxScore.js';

const ROSTER = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'];

/**
 * Build a synthetic RoundLog with known, hand-countable events.
 * Two rounds:
 *  R1: a1 first-bloods b1 (assist candidate a2). a1 kills b2. b3 trade-kills a1.
 *      clutch player = a2 (won last-alive).
 *  R2: a1 kills b1. a3 kills b2 (assist candidate a2). a1 kills b3.
 * @returns {import('../../src/engine/match/boxScore.js').RoundLog[]}
 */
function syntheticRounds() {
  return [
    {
      n: 1,
      winnerSide: 'atk',
      winnerTeam: 'A',
      endCondition: 'elim',
      economy: { A: { type: 'pistol', credits: 800 }, B: { type: 'pistol', credits: 800 } },
      events: [
        { round: 1, killerId: 'a1', victimId: 'b1', killerSide: 'atk', isFirstBlood: true, isTrade: false, isClutchKill: false, assistIds: ['a2'] },
        { round: 1, killerId: 'a1', victimId: 'b2', killerSide: 'atk', isFirstBlood: false, isTrade: false, isClutchKill: false, assistIds: [] },
        { round: 1, killerId: 'b3', victimId: 'a1', killerSide: 'def', isFirstBlood: false, isTrade: true, isClutchKill: false, assistIds: [] }
      ],
      aliveEnd: { A: 2, B: 1 },
      planted: false,
      clutchPlayerId: 'a2'
    },
    {
      n: 2,
      winnerSide: 'atk',
      winnerTeam: 'A',
      endCondition: 'elim',
      economy: { A: { type: 'full', credits: 4000 }, B: { type: 'full', credits: 4000 } },
      events: [
        { round: 2, killerId: 'a1', victimId: 'b1', killerSide: 'atk', isFirstBlood: true, isTrade: false, isClutchKill: false, assistIds: [] },
        { round: 2, killerId: 'a3', victimId: 'b2', killerSide: 'atk', isFirstBlood: false, isTrade: false, isClutchKill: false, assistIds: ['a2'] },
        { round: 2, killerId: 'a1', victimId: 'b3', killerSide: 'atk', isFirstBlood: false, isTrade: false, isClutchKill: false, assistIds: [] }
      ],
      aliveEnd: { A: 3, B: 0 },
      planted: false,
      clutchPlayerId: null
    }
  ];
}

export default async function boxScoreTest() {
  section('engine/match/boxScore');

  // --- createBoxScore: zeroed PlayerMapStat per id ---
  {
    const box = createBoxScore(ROSTER);
    assertEqual(Object.keys(box).sort(), [...ROSTER].sort(), 'one row per roster id');
    for (const id of ROSTER) {
      const r = box[id];
      assertEqual(r.playerId, id, 'playerId set');
      assertEqual(
        [r.kills, r.deaths, r.assists, r.firstBloods, r.firstDeaths, r.tradeKills, r.clutches, r.roundsPlayed, r.acs, r.kd, r.kast, r.adr],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        'all fields zeroed'
      );
    }
    // dedupe / null-safety
    const dup = createBoxScore(['x', 'x', null, 'y']);
    assertEqual(Object.keys(dup).sort(), ['x', 'y'], 'dedupes and skips null ids');
  }

  // --- accumulate: exact tallies vs synthetic log ---
  {
    const rng = createRng(12345);
    const rounds = syntheticRounds();
    let box = createBoxScore(ROSTER);
    const before = JSON.parse(JSON.stringify(box));

    for (const rl of rounds) box = accumulate(box, rl, rng);

    // immutability: original empty box object untouched (we reassigned `box`,
    // but the first snapshot must be unchanged).
    assertEqual(before.a1.kills, 0, 'accumulate did not mutate the original empty box');

    // kills: a1 = 3 (b1,b2 in R1; b1,b3 in R2 = actually b1,b2 R1 + b1,b3 R2 = 4)
    assertEqual(box.a1.kills, 4, 'a1 kills tallied');
    assertEqual(box.a3.kills, 1, 'a3 kills tallied');
    assertEqual(box.b3.kills, 1, 'b3 trade kill tallied');

    // deaths
    assertEqual(box.a1.deaths, 1, 'a1 died once (traded in R1)');
    assertEqual(box.b1.deaths, 2, 'b1 died twice');
    assertEqual(box.b2.deaths, 2, 'b2 died twice');
    assertEqual(box.b3.deaths, 1, 'b3 died once');

    // firstBloods / firstDeaths
    assertEqual(box.a1.firstBloods, 2, 'a1 two first bloods');
    assertEqual(box.b1.firstDeaths, 2, 'b1 two first deaths');

    // tradeKills
    assertEqual(box.b3.tradeKills, 1, 'b3 one trade kill');
    assertEqual(box.a1.tradeKills, 0, 'a1 no trade kills');

    // clutches
    assertEqual(box.a2.clutches, 1, 'a2 one clutch');

    // assists: only a2 is ever a candidate (R1 first-blood, R2 a3's kill). Assists
    // are now RARE & probabilistic, so a2 receives 0..2 (one per candidate event,
    // each gated by the per-kill assist chance) — NOT one-per-kill. Whatever the
    // rng yields must respect the per-kill cap and never credit the killer.
    assert(box.a2.assists >= 0 && box.a2.assists <= 2, 'a2 assists within [0, candidate events]');
    assertEqual(box.a1.assists, 0, 'killer never self-assists');
    // every assist credited must trace to a candidate teammate (a2 only here)
    for (const id of ['a1', 'a3', 'b1', 'b2', 'b3']) {
      assertEqual(box[id].assists, 0, `${id} got no assists (never a candidate)`);
    }

    // roundsPlayed: every tracked player played 2 rounds
    for (const id of ROSTER) {
      assertEqual(box[id].roundsPlayed, 2, `${id} roundsPlayed == 2`);
    }

    // kills summed == deaths summed across both teams (sanity from §14)
    let totalKills = 0;
    let totalDeaths = 0;
    for (const id of Object.keys(box)) {
      totalKills += box[id].kills;
      totalDeaths += box[id].deaths;
    }
    assertEqual(totalKills, totalDeaths, 'total kills == total deaths');
    assertEqual(totalKills, 6, 'six kills total across two rounds');
  }

  // --- assist weighting: utility skews probabilistic pick (multi-candidate) ---
  {
    // One round, one kill, two candidate assisters with very different utility.
    // Over many rng draws the high-utility candidate should win the lion's share.
    const hi = 'hiUtil';
    const lo = 'loUtil';
    const log = {
      n: 1,
      winnerSide: 'atk',
      winnerTeam: 'A',
      endCondition: 'elim',
      economy: { A: { type: 'full', credits: 4000 }, B: { type: 'full', credits: 4000 } },
      events: [
        {
          round: 1,
          killerId: 'k',
          victimId: 'v',
          killerSide: 'atk',
          isFirstBlood: true,
          isTrade: false,
          isClutchKill: false,
          // candidate objects carry utility for weighting
          assistIds: [{ id: hi, utility: 95 }, { id: lo, utility: 5 }]
        }
      ],
      aliveEnd: { A: 5, B: 4 },
      planted: false,
      clutchPlayerId: null
    };

    let hiCount = 0;
    let loCount = 0;
    let kills = 0;
    const trials = 400;
    for (let i = 0; i < trials; i++) {
      const rng = createRng(1000 + i);
      const box = accumulate(createBoxScore(['k', hi, lo]), log, rng);
      // Assists are rare: a trial may credit 0, 1, or 2 assists; the FIRST goes to
      // a utility-weighted pick (the high-util candidate far more often), and a
      // rare second assist may also land. Tally totals to check the skew.
      hiCount += box[hi].assists;
      loCount += box[lo].assists;
      kills += box.k.kills; // one kill per trial
      assert(box[hi].assists + box[lo].assists <= 2, 'never exceeds MAX_PER_KILL per kill');
      assert(box.k.assists === 0, 'killer never self-assists');
    }
    assert(hiCount > 0 && loCount > 0, 'both candidates remain eligible');
    // Utility skews the primary assist heavily toward the high-utility candidate.
    assert(hiCount > loCount, 'high-utility candidate assists far more often');
    // SANITY: assists stay rare — total assists well below total kills.
    const totalAssists = hiCount + loCount;
    assert(totalAssists < kills * 2, 'assists capped at MAX_PER_KILL per kill in aggregate');
  }

  // --- assist cap & weighting with 3 candidates (selection actually varies) ---
  {
    const log = {
      n: 1,
      winnerSide: 'atk',
      winnerTeam: 'A',
      endCondition: 'elim',
      economy: { A: { type: 'full', credits: 0 }, B: { type: 'full', credits: 0 } },
      events: [
        {
          round: 1,
          killerId: 'k',
          victimId: 'v',
          killerSide: 'atk',
          isFirstBlood: false,
          isTrade: false,
          isClutchKill: false,
          assistIds: [{ id: 'c1', utility: 90 }, { id: 'c2', utility: 50 }, { id: 'c3', utility: 10 }]
        }
      ],
      aliveEnd: { A: 5, B: 4 },
      planted: false,
      clutchPlayerId: null
    };
    const counts = { c1: 0, c2: 0, c3: 0 };
    const trials = 600;
    for (let i = 0; i < trials; i++) {
      const rng = createRng(5000 + i);
      const box = accumulate(createBoxScore(['k', 'c1', 'c2', 'c3']), log, rng);
      let assignedThisTrial = 0;
      for (const id of ['c1', 'c2', 'c3']) {
        counts[id] += box[id].assists;
        assignedThisTrial += box[id].assists;
      }
      assert(assignedThisTrial <= 2, 'never exceeds MAX_PER_KILL assists per kill');
      assert(box.k.assists === 0, 'killer never self-assists');
    }
    // higher utility -> picked more often as one of the two
    assert(counts.c1 >= counts.c2, 'c1 (util 90) >= c2 (util 50)');
    assert(counts.c2 >= counts.c3, 'c2 (util 50) >= c3 (util 10)');
  }

  // --- REALISM: assists-per-kill cap + team-total ratio over many kills ---
  // Feeds a long stream of single-kill rounds (each with 4 alive teammate
  // candidates, the realistic per-kill pool) and asserts: (1) no kill ever yields
  // more than MAX_PER_KILL assists, and (2) in aggregate team assists land in the
  // realistic ~30-70% of team kills band — NOT the old ~2-per-kill over-count.
  {
    const candidates = [
      { id: 't1', utility: 70 },
      { id: 't2', utility: 60 },
      { id: 't3', utility: 50 },
      { id: 't4', utility: 40 }
    ];
    const roster = ['k', 't1', 't2', 't3', 't4'];
    const kills = 300;
    let totalAssists = 0;
    let box = createBoxScore(roster);
    const rng = createRng(24680);
    for (let i = 0; i < kills; i++) {
      const before = box;
      const log = {
        n: i + 1,
        winnerSide: 'atk',
        winnerTeam: 'A',
        endCondition: 'elim',
        economy: { A: { type: 'full', credits: 4000 }, B: { type: 'full', credits: 4000 } },
        events: [
          {
            round: i + 1,
            killerId: 'k',
            victimId: 'v',
            killerSide: 'atk',
            isFirstBlood: i === 0,
            isTrade: false,
            isClutchKill: false,
            assistIds: candidates
          }
        ],
        aliveEnd: { A: 5, B: 4 },
        planted: false,
        clutchPlayerId: null
      };
      box = accumulate(before, log, rng);
      // per-kill cap: assists credited THIS round across all teammates <= MAX
      let assignedThisKill = 0;
      for (const id of ['t1', 't2', 't3', 't4']) {
        assignedThisKill += box[id].assists - before[id].assists;
      }
      assert(assignedThisKill <= 2, 'assists per kill never exceed MAX_PER_KILL (2)');
      assert(box.k.assists === 0, 'killer never self-assists');
    }
    for (const id of ['t1', 't2', 't3', 't4']) totalAssists += box[id].assists;
    const ratio = totalAssists / kills; // team assists / team kills
    assert(ratio > 0.3 && ratio < 0.7, `team assists ~30-70% of kills (got ${ratio.toFixed(2)})`);
  }

  // --- finalize: sane acs/kd/kast/adr matching the contract formula ---
  {
    const rng = createRng(777);
    const rounds = syntheticRounds();
    let box = createBoxScore(ROSTER);
    for (const rl of rounds) box = accumulate(box, rl, rng);

    const totalRounds = 2;
    const fin = finalize(box, totalRounds);

    // immutability: pre-finalize box has no derived overwrite leaking back, and
    // transient __kastHits is gone from the finalized output.
    assert(!('__kastHits' in fin.a1), 'transient kast field removed after finalize');

    // a1: kills 4, assists 0, firstBloods 2, deaths 1, rounds 2
    const expAcsA1 =
      (BALANCE.ACS_KILL * 4 + BALANCE.ACS_ASSIST * 0 + BALANCE.ACS_PER_DUEL_BONUS * 2) / totalRounds;
    assertClose(fin.a1.acs, Math.round(expAcsA1 * 100) / 100, 1e-6, 'a1 acs matches formula');
    assertClose(fin.a1.kd, 4 / 1, 1e-6, 'a1 kd = kills/deaths');

    // a2: 0 kills/firstBloods, clutch 1 -> acs derives purely from its (rare)
    // assists, however many the rng credited this run.
    const a2Assists = fin.a2.assists;
    assert(a2Assists >= 0 && a2Assists <= 2, 'a2 assists within per-kill cap');
    const expAcsA2 = (BALANCE.ACS_ASSIST * a2Assists) / totalRounds;
    assertClose(fin.a2.acs, Math.round(expAcsA2 * 100) / 100, 1e-6, 'a2 acs from assists');

    // kd guards divide-by-zero: a2 has 0 deaths -> kd == kills (0)
    assertClose(fin.a2.kd, 0, 1e-6, 'a2 kd with zero deaths is finite');

    // kast in [0,1] for everyone, and a1 (impactful both rounds) == 1
    for (const id of Object.keys(fin)) {
      assert(fin[id].kast >= 0 && fin[id].kast <= 1, `${id} kast in [0,1]`);
      assert(fin[id].acs >= 0, `${id} acs non-negative`);
      assert(fin[id].adr >= 0, `${id} adr non-negative`);
    }
    assertClose(fin.a1.kast, 1, 1e-6, 'a1 KAST-impactful in both rounds');

    // b1: died both rounds, no impact -> kast 0
    assertClose(fin.b1.kast, 0, 1e-6, 'b1 zero KAST (died untraded both rounds)');
  }

  // --- pickMvp: top fragger / highest acs wins ---
  {
    const rng = createRng(42);
    const rounds = syntheticRounds();
    let box = createBoxScore(ROSTER);
    for (const rl of rounds) box = accumulate(box, rl, rng);
    box = finalize(box, 2);

    const mvp = pickMvp(box);
    assertEqual(mvp, 'a1', 'a1 (4 kills, 2 FB) is MVP by acs');

    // deterministic tie-break: empty box -> null
    assertEqual(pickMvp({}), null, 'empty box has no mvp');
  }

  // --- immutability: accumulate/finalize return new objects ---
  {
    const rng = createRng(9);
    const box0 = createBoxScore(['p1']);
    const log = {
      n: 1,
      winnerSide: 'atk',
      winnerTeam: 'A',
      endCondition: 'elim',
      economy: { A: { type: 'full', credits: 0 }, B: { type: 'full', credits: 0 } },
      events: [{ round: 1, killerId: 'p1', victimId: 'q1', killerSide: 'atk', isFirstBlood: true, isTrade: false, isClutchKill: false, assistIds: [] }],
      aliveEnd: { A: 5, B: 4 },
      planted: false,
      clutchPlayerId: null
    };
    const box1 = accumulate(box0, log, rng);
    assert(box1 !== box0, 'accumulate returns a new box');
    assertEqual(box0.p1.kills, 0, 'accumulate left original box untouched');
    const box2 = finalize(box1, 1);
    assert(box2 !== box1, 'finalize returns a new box');
    assert(box2.p1 !== box1.p1, 'finalize clones stat rows');
  }
}
