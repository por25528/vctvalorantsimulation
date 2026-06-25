/**
 * tests/unit/tier2.test.mjs — Tier-2 (Challengers) ecosystem invariants.
 *
 * Covers the second-division build, its in-season simulation alongside T1, the
 * off-season development + the cross-tier promotion/relegation pipeline, and the
 * determinism guarantees the rest of the sim relies on:
 *
 *  1. BUILD       — 4 region leagues, 12 clubs each, role-complete fives, a quality
 *                   curve a clear step below T1 (younger, with upside), deterministic.
 *  2. NON-PERTURBATION — attaching T2 leaves the T1 season BYTE-IDENTICAL (T2 uses a
 *                   separate seed namespace); the world keeps exactly 48 T1 teams.
 *  3. IN-SEASON   — a season run over a T2-attached world simulates every regional
 *                   T2 slot through the real format engine (12-team placements).
 *  4. CAREER      — over multiple seasons T2 rosters stay valid (exactly 5, no
 *                   double-roster, active contracts), budgets stay positive, the
 *                   quality curve stays sane, and the SAME seed reproduces it all.
 *  5. PROMOTION   — strong T2 players rise into the T1 free-agent pool (and get
 *                   signed); weak T1 free agents fall to T2 — a functioning pipeline.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { buildWorld } from '../../src/data/seed/index.js';
import { simSeason } from '../../src/engine/career/season.js';
import { buildTier2World, attachTier2 } from '../../src/engine/career/tier2/tier2World.js';
import { initCareer, advanceCareer } from '../../src/engine/career/career.js';
import { overall } from '../../src/engine/career/playerStats.js';
import { BALANCE } from '../../src/config/balance.js';

const T2 = BALANCE.CAREER.TIER2;
const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];
const REGIONS = ['pacific', 'americas', 'emea', 'china'];
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

/** Validate a tier2 world's rosters: exactly ROSTER_SIZE, no double-roster, owned & active. */
function assertValidTier2(t2, label) {
  const seen = new Set();
  for (const id of Object.keys(t2.teamsById)) {
    const t = t2.teamsById[id];
    assertEqual(t.roster.length, T2.ROSTER_SIZE, `${label}: ${id} has exactly ${T2.ROSTER_SIZE} players`);
    assert(t.tier === 't2', `${label}: ${id} is tier t2`);
    assert(t.budget > 0, `${label}: ${id} has a positive budget`);
    for (const pid of t.roster) {
      assert(!seen.has(pid), `${label}: ${pid} on only one roster`);
      seen.add(pid);
      const p = t2.playersById[pid];
      assert(p && p.tier === 't2' && p.contract.status === 'active' && p.contract.teamId === id,
        `${label}: ${pid} active, tier t2, owned by ${id}`);
    }
  }
}

export default async function tier2Test() {
  section('tier2 — build: leagues, clubs, role-complete fives, quality curve');
  const t2 = buildTier2World('career-2026', 0);
  assertEqual(Object.keys(t2.leagues).sort(), [...REGIONS].sort(), 'four T2 region leagues');
  assertEqual(Object.keys(t2.teamsById).length, T2.TEAMS_PER_REGION * 4, '48 T2 teams (12/region)');
  assertEqual(Object.keys(t2.playersById).length, T2.TEAMS_PER_REGION * 4 * T2.ROSTER_SIZE, '240 T2 players');
  assertValidTier2(t2, 'build');

  // Every T2 five is role-complete (one of each core role).
  for (const id of Object.keys(t2.teamsById)) {
    const roles = new Set(t2.teamsById[id].roster.map((pid) => t2.playersById[pid].role));
    assert(ROLES.every((r) => roles.has(r)), `build: ${id} is role-complete`);
  }

  // Quality curve: a clear step below the authored T1 mean (~79), youth-skewed,
  // with real upside (potential above current overall).
  const players = Object.values(t2.playersById);
  const ovrs = players.map(overall);
  const ages = players.map((p) => p.age);
  const meanOvr = mean(ovrs);
  assert(meanOvr > 58 && meanOvr < 72, `T2 overall mean is a believable second division (${meanOvr.toFixed(1)})`);
  assert(Math.max(...ovrs) < 84, 'no T2 player is already a T1 star');
  const meanAge = mean(ages);
  assert(meanAge < 24, `T2 skews young (mean age ${meanAge.toFixed(1)})`);
  assert(Math.min(...ages) >= T2.AGE_MIN && Math.max(...ages) <= T2.AGE_MAX, 'ages within the configured band');
  const withUpside = players.filter((p) => p.potential > overall(p)).length;
  assert(withUpside / players.length > 0.5, 'most T2 players carry growth upside (potential > overall)');

  // Determinism of the build.
  const t2b = buildTier2World('career-2026', 0);
  assertEqual(JSON.stringify(t2), JSON.stringify(t2b), 'same seed → identical T2 world');
  const t2c = buildTier2World('different-seed', 0);
  assert(JSON.stringify(t2) !== JSON.stringify(t2c), 'different seed → different T2 world');

  section('tier2 — attaching T2 does not perturb the T1 season (byte-identical)');
  const world = buildWorld();
  assertEqual(Object.keys(world.teamsById).length, 48, 'T1 world still 48 teams (T2 is a separate namespace)');
  const withT2 = attachTier2(world, 'career-2026', 0);
  const seed = 4242;
  const plainSeason = simSeason(world, seed);
  const t2Season = simSeason(withT2, seed);
  // The T1 portion must be identical with or without T2 attached.
  assertEqual(JSON.stringify(t2Season.events), JSON.stringify(plainSeason.events),
    'T1 event results are byte-identical whether or not T2 is attached');
  assertEqual(t2Season.champion, plainSeason.champion, 'same T1 champion regardless of T2');
  assert(!plainSeason.tier2, 'a bare world produces no tier2 season block');

  section('tier2 — in-season: every regional slot simulates the four T2 leagues');
  assert(t2Season.tier2 && Array.isArray(t2Season.tier2.events), 'T2 season block present when attached');
  // 4 regional slots (kickoff + stage1-3) × 4 regions = 16 T2 events.
  assertEqual(t2Season.tier2.events.length, 16, '16 region-tagged T2 events over the season');
  for (const ev of t2Season.tier2.events) {
    assertEqual(ev.result.placements.length, 12, `T2 ${ev.slotId}:${ev.region} placed 12 teams`);
    assert(REGIONS.includes(ev.region), 'T2 event carries a real region tag');
    assert(Array.isArray(ev.result.series) && ev.result.series.length > 0, 'T2 event played real series');
  }
  // A season-long T2 standing exists (CP accrued).
  assert(Object.keys(t2Season.tier2.ledger.totals).length > 0, 'T2 CP ledger has standings');

  section('tier2 — career: multi-season validity, promotion pipeline, determinism');
  const promoted = new Set();
  const relegated = new Set();
  let lastReportSeason = -1;
  const SEASONS = 3;
  function runCareer(careerSeed) {
    let s = initCareer(careerSeed);
    assert(s.world.tier2, 'a fresh career has a T2 sub-world attached');
    const localPromoted = new Set();
    const localRelegated = new Set();
    let guard = 0;
    let lastOff = -1;
    while (s.history.length < SEASONS && guard < SEASONS * 18 + 16) {
      s = advanceCareer(s);
      guard += 1;
      // Count each off-season's promotion report exactly once (it lingers across slots).
      if (s.tier2Offseason && s.tier2Offseason.season !== lastOff) {
        lastOff = s.tier2Offseason.season;
        for (const id of s.tier2Offseason.promoted) localPromoted.add(id);
        for (const id of s.tier2Offseason.relegated) localRelegated.add(id);
      }
      if (s.world.tier2) assertValidTier2(s.world.tier2, `career season ~${s.history.length}`);
    }
    return { s, localPromoted, localRelegated };
  }

  const a = runCareer('career-2026');
  for (const id of a.localPromoted) promoted.add(id);
  for (const id of a.localRelegated) relegated.add(id);
  lastReportSeason = a.s.tier2Offseason ? a.s.tier2Offseason.season : -1;
  assert(lastReportSeason >= 0, 'an off-season produced a T2 report');

  // Promotion pipeline actually moved talent up and down.
  assert(promoted.size > 0, `at least some T2 players were promoted (${promoted.size})`);
  assert(relegated.size > 0, `at least some T1 players were relegated (${relegated.size})`);
  // Promoted players are now part of the T1 world, and most get signed onto a T1 roster.
  const t1 = a.s.world.playersById;
  const t1Rostered = new Set();
  for (const t of Object.values(a.s.world.teamsById)) for (const pid of t.roster) t1Rostered.add(pid);
  let promotedInT1 = 0;
  let promotedRostered = 0;
  for (const id of promoted) {
    if (t1[id]) { promotedInT1 += 1; if (t1Rostered.has(id)) promotedRostered += 1; }
  }
  assertEqual(promotedInT1, promoted.size, 'every promoted player lives in the T1 pool');
  assert(promotedRostered > 0, `promoted players reach T1 rosters (${promotedRostered}/${promoted.size})`);
  // None of them is still rostered in T2 (no double-life across tiers).
  const t2Rostered = new Set();
  for (const t of Object.values(a.s.world.tier2.teamsById)) for (const pid of t.roster) t2Rostered.add(pid);
  for (const id of promoted) assert(!t2Rostered.has(id), `promoted ${id} no longer on a T2 roster`);

  // T2 quality curve stays sane across the career (no deflation/inflation).
  const t2Active = Object.values(a.s.world.tier2.playersById).filter((p) => p.contract.status !== 'retired');
  const careerMeanOvr = mean(t2Active.map(overall));
  assert(careerMeanOvr > 58 && careerMeanOvr < 73, `T2 mean overall stays a sane second division (${careerMeanOvr.toFixed(1)})`);

  // Determinism: same seed reproduces the identical T2 final state.
  const a2 = runCareer('career-2026');
  assertEqual(
    JSON.stringify(rosterPrint(a2.s.world.tier2)),
    JSON.stringify(rosterPrint(a.s.world.tier2)),
    'same seed reproduces identical T2 rosters across the career'
  );
  // A different seed diverges.
  const b = runCareer('another-seed');
  assert(
    JSON.stringify(rosterPrint(b.s.world.tier2)) !== JSON.stringify(rosterPrint(a.s.world.tier2)),
    'a different seed yields a different T2 career'
  );

  // eslint-disable-next-line no-console
  console.log(
    `tier2: build 48/240 (mean ovr ${meanOvr.toFixed(1)}, age ${meanAge.toFixed(1)}); ` +
    `T1 byte-identical with/without T2; 16 T2 events/season; ` +
    `career promoted ${promoted.size}, relegated ${relegated.size}, ` +
    `${promotedRostered} promoted reached T1 rosters; deterministic.`);
}

/** Stable per-team T2 roster fingerprint. */
function rosterPrint(t2) {
  return Object.keys(t2.teamsById).sort().map((id) => `${id}:${t2.teamsById[id].roster.join(',')}`).join('|');
}
