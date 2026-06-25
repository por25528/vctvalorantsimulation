/**
 * tests/season.test.mjs — adversarial end-to-end full-Season verification
 * (CONTRACTS-SEASON §7 invariants, §8).
 *
 * Builds the full 48-team / 240-player World via buildWorld() and runs
 * simSeason(world, seed) for >=10 distinct seeds, asserting EVERY §7 invariant
 * on each SeasonResult:
 *
 *   1. Calendar shape     — exactly 20 event entries in order:
 *                           4 kickoff, 1 m0, 4 stage1, 1 m1, 4 stage2, 1 m2,
 *                           4 stage3, 1 champions.
 *   2. Masters composition— each Masters has 12 participants = 4 direct
 *                           (placement-1 of the 4 feeders) + 8 swiss; each
 *                           region exactly 3; m0<-kickoff, m1<-stage1, m2<-stage2.
 *   3. Champions composition — 16 unique teams; index 0 = m2 champion; the other
 *                           15 = current top-15 by cumulative CP (excluding the
 *                           direct team); the m2 champion appears exactly once.
 *   4. CP accounting      — ledger.totals == sum of per-event awardCP; kickoff/
 *                           stage/masters award CP; champions awards none; no
 *                           NaN / negative.
 *   5. Determinism        — same seed -> deep-equal SeasonResult; different seed
 *                           -> differs.
 *   6. Engine-backed       — every event has played series with valid placements;
 *                           champion is a real team present in the Champions field;
 *                           no team double-booked within any event.
 *
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from './_assert.mjs';
import { buildWorld } from '../src/data/seed/index.js';
import { simSeason } from '../src/engine/career/season.js';
import { CALENDAR } from '../src/engine/career/calendar.js';
import { mastersSeedOrder, REGION_ORDER } from '../src/engine/career/qualification.js';
import { awardCP } from '../src/engine/career/championshipPoints.js';
import { CP_TABLE } from '../src/config/cpTable.js';

/** Deterministic equality probe for whole SeasonResults / sub-structures. */
function stable(v) {
  return JSON.stringify(v);
}

/** Find a placement teamId by rank within an EventResult. */
function teamAtRank(result, rank) {
  const p = result.placements.find((x) => x.rank === rank);
  return p ? p.teamId : undefined;
}

/**
 * Map each region to the set of its 12 team ids, from the World leagues.
 * @param {object} world
 * @returns {Record<string, Set<string>>}
 */
function regionTeamSets(world) {
  /** @type {Record<string, Set<string>>} */
  const sets = {};
  for (const region of REGION_ORDER) {
    sets[region] = new Set(world.leagues[region].teamIds);
  }
  return sets;
}

/**
 * Assert one event entry's EventResult is genuinely engine-backed: real series
 * with decisive scores, finalized box scores, and a winner that is one of the
 * two participants. Also asserts no team is double-booked (a !== b) per series.
 * @param {object} entry  SeasonEventEntry
 * @param {string} tag
 */
function assertEngineBackedEvent(entry, tag) {
  const ev = entry.result;
  const label = `${tag} ${entry.slotId}${entry.region ? ':' + entry.region : ''}`;

  assert(Array.isArray(ev.placements) && ev.placements.length > 0,
    `${label}: has placements`);
  // Ranks are 1..N unique, every placed team distinct.
  const ranks = ev.placements.map((p) => p.rank).slice().sort((a, b) => a - b);
  const expected = ranks.map((_, i) => i + 1);
  assertEqual(ranks, expected, `${label}: ranks are 1..N unique, no gaps`);
  assertEqual(new Set(ev.placements.map((p) => p.teamId)).size, ev.placements.length,
    `${label}: every placed team distinct`);

  assert(Array.isArray(ev.series) && ev.series.length > 0,
    `${label}: has at least one played series`);
  for (const s of ev.series) {
    assert(typeof s.teamAId === 'string' && typeof s.teamBId === 'string',
      `${label}: series has two team ids`);
    assert(s.teamAId !== s.teamBId,
      `${label}: series ${s.stageId}/${s.matchId} not the same team both sides`);
    assert(s.winnerId === s.teamAId || s.winnerId === s.teamBId,
      `${label}: series ${s.stageId}/${s.matchId} winner is a participant`);
    assert(Array.isArray(s.maps) && s.maps.length > 0,
      `${label}: series ${s.stageId}/${s.matchId} played real maps`);
    assert(s.score && s.score.A !== s.score.B,
      `${label}: series ${s.stageId}/${s.matchId} has a decisive score`);
  }
  // Match ids unique per stage (no slot double-booking).
  const keys = ev.series.map((s) => `${s.stageId}:${s.matchId}`);
  assertEqual(new Set(keys).size, keys.length,
    `${label}: every (stage,match) series id is unique`);
}

/**
 * Assert every §7 invariant on a single SeasonResult.
 * @param {object} season  SeasonResult
 * @param {object} world
 * @param {Record<string, Set<string>>} regionSets
 * @param {number|string} seed
 */
function assertInvariants(season, world, regionSets, seed) {
  const tag = `seed ${seed}`;
  const allTeamIds = new Set(Object.keys(world.teamsById));

  // === 1. CALENDAR SHAPE ===================================================
  assertEqual(season.events.length, 21, `${tag}: exactly 21 event entries`);
  const expectedSlots = [
    'kickoff', 'kickoff', 'kickoff', 'kickoff',
    'm0',
    'stage1', 'stage1', 'stage1', 'stage1',
    'm1',
    'stage2', 'stage2', 'stage2', 'stage2',
    'm2',
    'stage3', 'stage3', 'stage3', 'stage3',
    'lcq',
    'champions'
  ];
  assertEqual(season.events.map((e) => e.slotId), expectedSlots,
    `${tag}: 21 entries in exact calendar order`);

  // Regional slots expand to one tagged entry per region, in REGION_ORDER.
  for (const slotId of ['kickoff', 'stage1', 'stage2', 'stage3']) {
    const regionalEntries = season.events.filter((e) => e.slotId === slotId);
    assertEqual(regionalEntries.length, 4, `${tag}: ${slotId} has 4 regional entries`);
    assertEqual(regionalEntries.map((e) => e.region), REGION_ORDER,
      `${tag}: ${slotId} regions in fixed order`);
    for (const e of regionalEntries) {
      assertEqual(e.scope, 'regional', `${tag}: ${slotId} entry is regional`);
      // A regional event holds exactly that league's 12 teams.
      const placed = new Set(e.result.placements.map((p) => p.teamId));
      assertEqual(placed.size, 12, `${tag}: ${slotId}:${e.region} has 12 teams`);
      for (const id of placed) {
        assert(regionSets[e.region].has(id),
          `${tag}: ${slotId}:${e.region} team ${id} belongs to ${e.region}`);
      }
    }
  }
  // International slots are single, untagged entries.
  for (const slotId of ['m0', 'm1', 'm2', 'lcq', 'champions']) {
    const intl = season.events.filter((e) => e.slotId === slotId);
    assertEqual(intl.length, 1, `${tag}: ${slotId} is a single event`);
    assertEqual(intl[0].scope, 'international', `${tag}: ${slotId} is international`);
    assert(intl[0].region === undefined, `${tag}: ${slotId} carries no region tag`);
  }

  // Build quick lookups for regional results by slot+region.
  /** @type {Record<string, Record<string, object>>} */
  const regionalBySlot = {};
  for (const slotId of ['kickoff', 'stage1', 'stage2', 'stage3']) {
    regionalBySlot[slotId] = {};
    for (const e of season.events.filter((x) => x.slotId === slotId)) {
      regionalBySlot[slotId][e.region] = e.result;
    }
  }

  // === 2. MASTERS COMPOSITION =============================================
  const feeders = { m0: 'kickoff', m1: 'stage1', m2: 'stage2' };
  for (const [mSlot, feedSlot] of Object.entries(feeders)) {
    const mEntry = season.events.find((e) => e.slotId === mSlot);
    const seedOrder = season.masters[mSlot].seedOrder;
    assertEqual(seedOrder.length, 12, `${tag}: ${mSlot} seeded 12 teams`);
    assertEqual(new Set(seedOrder).size, 12, `${tag}: ${mSlot} 12 unique seeds`);
    // 12 participants in the played event.
    assertEqual(mEntry.result.placements.length, 12,
      `${tag}: ${mSlot} has 12 participants`);
    assertEqual(new Set(mEntry.result.placements.map((p) => p.teamId)),
      new Set(seedOrder), `${tag}: ${mSlot} participants are exactly its seed order`);

    // Seed order must equal mastersSeedOrder over the feeding regional results.
    const expectedSeedOrder = mastersSeedOrder(regionalBySlot[feedSlot]);
    assertEqual(seedOrder, [...expectedSeedOrder],
      `${tag}: ${mSlot} seedOrder == mastersSeedOrder(${feedSlot})`);

    // Exactly 4 direct = placement-1 of the 4 feeders (seeds 1..4).
    const directs = seedOrder.slice(0, 4);
    const swiss = seedOrder.slice(4);
    assertEqual(directs.length, 4, `${tag}: ${mSlot} has 4 direct seeds`);
    assertEqual(swiss.length, 8, `${tag}: ${mSlot} has 8 swiss seeds`);
    for (const region of REGION_ORDER) {
      const placement1 = teamAtRank(regionalBySlot[feedSlot][region], 1);
      assert(directs.includes(placement1),
        `${tag}: ${mSlot} direct seeds include ${region} placement-1`);
    }
    // Each region contributes exactly 3 (its placements 1, 2, 3).
    for (const region of REGION_ORDER) {
      const fromRegion = seedOrder.filter((id) => regionSets[region].has(id));
      assertEqual(fromRegion.length, 3,
        `${tag}: ${mSlot} region ${region} contributes exactly 3`);
      // And those 3 are exactly placements 1,2,3 of that feeder.
      const expectedTrio = new Set([
        teamAtRank(regionalBySlot[feedSlot][region], 1),
        teamAtRank(regionalBySlot[feedSlot][region], 2),
        teamAtRank(regionalBySlot[feedSlot][region], 3)
      ]);
      assertEqual(new Set(fromRegion), expectedTrio,
        `${tag}: ${mSlot} ${region} trio == feeder placements 1,2,3`);
    }
  }

  // === 3. CHAMPIONS COMPOSITION ===========================================
  const m2Entry = season.events.find((e) => e.slotId === 'm2');
  const m2Winner = teamAtRank(m2Entry.result, 1);
  const lcqEntry = season.events.find((e) => e.slotId === 'lcq');
  const lcqWinner = teamAtRank(lcqEntry.result, 1);
  const field = season.championsField;
  assertEqual(field.length, 16, `${tag}: Champions field has 16 teams`);
  assertEqual(new Set(field).size, 16, `${tag}: Champions field 16 unique teams`);
  assertEqual(field[0], m2Winner, `${tag}: Champions index 0 == m2 champion (direct slot)`);
  assertEqual(field[15], lcqWinner, `${tag}: Champions index 15 == LCQ winner`);
  assertEqual(field.filter((id) => id === m2Winner).length, 1,
    `${tag}: m2 champion appears exactly once in the field`);
  assertEqual(field.filter((id) => id === lcqWinner).length, 1,
    `${tag}: LCQ winner appears exactly once in the field`);

  // Indices 1..14 = top-14 by cumulative CP at Champions seeding time, excluding
  // the direct team AND the LCQ winner. The LCQ winner earns seed 16 via the
  // play-in path regardless of their final CP rank.
  // Note: totals include LCQ CP awards (applied before Champions seeding), so
  // we use the final ledger totals for this check.
  const totals = season.ledger.totals;
  const expectedTop14 = Object.keys(totals)
    .filter((id) => id !== m2Winner && id !== lcqWinner)
    .sort((a, b) => (totals[b] - totals[a]) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, 14);
  assertEqual(field.slice(1, 15), expectedTop14,
    `${tag}: Champions seeds 2..15 == top-14 by cumulative CP (excl. direct and LCQ winner)`);
  for (const id of field) {
    assert(allTeamIds.has(id), `${tag}: Champions team ${id} is a real world team`);
  }

  // === 6. ENGINE-BACKED & SOUND (per event) ===============================
  for (const entry of season.events) {
    assertEngineBackedEvent(entry, tag);
  }
  // Champion is the Champions placement-1 and present in the field exactly once.
  const championsEntry = season.events.find((e) => e.slotId === 'champions');
  assertEqual(season.champion, teamAtRank(championsEntry.result, 1),
    `${tag}: champion == Champions placement 1`);
  assert(field.includes(season.champion),
    `${tag}: crowned champion is in the Champions field`);
  assert(allTeamIds.has(season.champion),
    `${tag}: crowned champion is a real world team`);
  // Champions event has exactly 16 participants.
  assertEqual(championsEntry.result.placements.length, 16,
    `${tag}: Champions event has 16 participants`);
  assertEqual(new Set(championsEntry.result.placements.map((p) => p.teamId)),
    new Set(field), `${tag}: Champions participants == the field`);

  // === 4. CP ACCOUNTING ===================================================
  // ledger.totals[t] == sum over events of awardCP(result)[t].
  /** @type {Record<string, number>} */
  const recomputed = {};
  for (const entry of season.events) {
    const awards = awardCP(entry.result, CP_TABLE);
    // The entry's cached cpAwards must match a fresh awardCP.
    assertEqual(entry.cpAwards, awards,
      `${tag}: ${entry.slotId}${entry.region ? ':' + entry.region : ''} cpAwards == awardCP(result)`);
    for (const [teamId, pts] of Object.entries(awards)) {
      assert(Number.isFinite(pts) && pts >= 0,
        `${tag}: CP award for ${teamId} is finite and non-negative (${pts})`);
      recomputed[teamId] = (recomputed[teamId] || 0) + pts;
    }
  }
  // Every ledger total matches the recomputed sum.
  assertEqual(new Set(Object.keys(totals)), new Set(Object.keys(recomputed)),
    `${tag}: ledger totals cover exactly the teams that earned CP`);
  for (const [teamId, total] of Object.entries(totals)) {
    assertEqual(total, recomputed[teamId],
      `${tag}: ledger.totals[${teamId}] == sum of per-event awards`);
    assert(Number.isFinite(total) && total >= 0,
      `${tag}: ledger total for ${teamId} finite & non-negative`);
  }
  // Champions awards zero CP to everyone.
  const chAwards = championsEntry.cpAwards;
  for (const v of Object.values(chAwards)) {
    assertEqual(v, 0, `${tag}: champions awards 0 CP`);
  }
  // Kickoff / stage / masters / lcq DO award CP (their placement-1 gets > 0).
  for (const slotId of ['kickoff', 'stage1', 'stage2', 'stage3', 'm0', 'm1', 'm2', 'lcq']) {
    const entry = season.events.find((e) => e.slotId === slotId);
    const winner = teamAtRank(entry.result, 1);
    assert(entry.cpAwards[winner] > 0,
      `${tag}: ${slotId} placement-1 (${winner}) earns positive CP`);
  }
}

export default async function seasonTest() {
  section('season — end-to-end §7 invariants over many seeds');

  const world = buildWorld();
  assertEqual(Object.keys(world.teamsById).length, 48, 'World has 48 teams');
  assertEqual(Object.keys(world.playersById).length, 240, 'World has 240 players');
  assertEqual(Object.keys(world.leagues).sort(), [...REGION_ORDER].sort(),
    'World has the four regional leagues');

  // CALENDAR is the canonical 9-slot calendar (sanity, drives §1).
  assertEqual(CALENDAR.length, 9, 'CALENDAR has 9 slots');

  const regionSets = regionTeamSets(world);

  // >= 10 distinct seeds.
  const seeds = [1, 2, 3, 7, 13, 42, 99, 256, 2026, 31337, 65535, 1000003];
  assert(seeds.length >= 10, 'at least 10 test seeds');
  assertEqual(new Set(seeds).size, seeds.length, 'all seeds distinct');

  /** @type {Map<string, string>} per-seed fingerprint to verify divergence. */
  const fingerprints = new Map();
  const champions = new Set();

  for (const seed of seeds) {
    const season = simSeason(world, seed);
    assertInvariants(season, world, regionSets, seed);

    // === 5. DETERMINISM (same seed -> deep-equal SeasonResult) ============
    const again = simSeason(world, seed);
    assertEqual(stable(again), stable(season),
      `seed ${seed}: re-sim -> deep-equal SeasonResult`);
    assertEqual(again.champion, season.champion,
      `seed ${seed}: re-sim -> same champion`);
    assertEqual(again.championsField, season.championsField,
      `seed ${seed}: re-sim -> same Champions field`);
    assertEqual(again.ledger.totals, season.ledger.totals,
      `seed ${seed}: re-sim -> same CP totals`);

    // Fingerprint: champion + field + final standings + per-event series winners.
    const fp = stable({
      champion: season.champion,
      field: season.championsField,
      finalStandings: season.finalStandings,
      events: season.events.map((e) => [
        e.slotId, e.region || '',
        e.result.series.map((s) => [s.stageId, s.matchId, s.winnerId])
      ])
    });
    fingerprints.set(String(seed), fp);
    champions.add(season.champion);
  }

  // === 5. DETERMINISM (different seed -> differs) =========================
  const distinct = new Set(fingerprints.values());
  assertEqual(distinct.size, seeds.length,
    `different seeds diverge: ${distinct.size}/${seeds.length} distinct season fingerprints`);
  assert(fingerprints.get('1') !== fingerprints.get('2'),
    'seeds 1 and 2 produce different seasons');

  // eslint-disable-next-line no-console
  console.log(
    `season: ${seeds.length} seeded full seasons x §7 invariants OK; ` +
    `${distinct.size}/${seeds.length} distinct fingerprints; ` +
    `${champions.size} distinct champions across seeds.`);
}
