/**
 * tests/unit/awards.test.mjs — P7a season awards (CONTRACTS-POLISH §1).
 *
 * Runs a real full season (simSeason) and asserts computeSeasonAwards is
 * deterministic and obeys its invariants: the MIN_MAPS gate, MVP = top qualified
 * mean-ACS, All-Pro team sizes/disjointness/ordering, Rookie age gate, Finals MVP
 * drawn from the Champions event, regional MVPs from their region, and
 * empty-season safety.
 */

import { assert, assertEqual, assertClose, section } from '../_assert.mjs';
import { buildWorld } from '../../src/data/seed/index.js';
import { simSeason } from '../../src/engine/career/season.js';
import { computeSeasonAwards, aggregatePlayerStats } from '../../src/engine/career/awards.js';
import { BALANCE } from '../../src/config/balance.js';

const A = BALANCE.CAREER.AWARDS;

export default async function run() {
  const world = buildWorld();
  const season = simSeason(world, 7);

  section('determinism — same (season, world) => identical awards');
  const a1 = computeSeasonAwards(season, world);
  const a2 = computeSeasonAwards(season, world);
  assertEqual(a1, a2, 'awards are deterministic');

  section('MVP — top qualified mean-ACS, meets the min-maps gate');
  assert(a1.mvp, 'a full season crowns an MVP');
  assert(a1.mvp.maps >= A.MIN_MAPS, 'MVP meets the MIN_MAPS gate');
  const agg = aggregatePlayerStats(season.events);
  let bestRating = -1;
  for (const s of agg.values()) {
    if (s.maps < A.MIN_MAPS) continue;
    const r = s.acsSum / s.maps;
    if (r > bestRating) bestRating = r;
  }
  assertClose(a1.mvp.rating, bestRating, 1e-9, 'MVP rating is the qualified maximum mean-ACS');

  section('MIN_MAPS gate — every winner qualified');
  const winners = [a1.mvp, a1.finalsMvp, a1.rookieOfYear, ...a1.allProFirst, ...a1.allProSecond, ...Object.values(a1.regionMvps)].filter(Boolean);
  for (const w of winners) assert(w.maps >= A.MIN_MAPS, `winner ${w.playerId} meets the gate`);

  section('All-Pro — sizes, disjoint, rating-ordered, MVP heads First Team');
  assertEqual(a1.allProFirst.length, A.ALL_PRO_SIZE, 'First Team is full');
  assertEqual(a1.allProSecond.length, A.ALL_PRO_SIZE, 'Second Team is full');
  const firstIds = new Set(a1.allProFirst.map((w) => w.playerId));
  for (const w of a1.allProSecond) assert(!firstIds.has(w.playerId), 'teams are disjoint');
  for (let i = 1; i < a1.allProFirst.length; i++) {
    assert(a1.allProFirst[i - 1].rating >= a1.allProFirst[i].rating, 'First Team rating-ordered');
  }
  const minFirst = Math.min(...a1.allProFirst.map((w) => w.rating));
  const maxSecond = Math.max(...a1.allProSecond.map((w) => w.rating));
  assert(minFirst >= maxSecond, 'First Team all rank >= Second Team');
  assertEqual(a1.mvp.playerId, a1.allProFirst[0].playerId, 'MVP heads the All-Pro First Team');

  section('Rookie of the Year — respects ROOKIE_MAX_AGE');
  if (a1.rookieOfYear) {
    assert(a1.rookieOfYear.age != null && a1.rookieOfYear.age <= A.ROOKIE_MAX_AGE, 'rookie is young enough');
    // It must be the highest-rated qualified player at or below the age cap.
    let bestRookieRating = -1;
    for (const s of agg.values()) {
      if (s.maps < A.MIN_MAPS) continue;
      const p = world.playersById[s.playerId];
      if (!p || typeof p.age !== 'number' || p.age > A.ROOKIE_MAX_AGE) continue;
      const r = s.acsSum / s.maps;
      if (r > bestRookieRating) bestRookieRating = r;
    }
    assertClose(a1.rookieOfYear.rating, bestRookieRating, 1e-9, 'rookie is the top qualified young player');
  }

  section('Finals MVP — drawn from the Champions event');
  const champEvents = season.events.filter((e) => e.type === 'champions');
  assertEqual(champEvents.length, 1, 'exactly one Champions event');
  if (a1.finalsMvp) {
    assert(aggregatePlayerStats(champEvents).has(a1.finalsMvp.playerId), 'Finals MVP played in the Champions event');
  }

  section('Regional MVPs — each from its own region');
  for (const r of Object.keys(a1.regionMvps)) {
    const w = a1.regionMvps[r];
    if (!w) continue;
    const regionEvents = season.events.filter((e) => e.scope === 'regional' && e.region === r);
    assert(aggregatePlayerStats(regionEvents).has(w.playerId), `region ${r} MVP played there`);
  }

  section('empty / null safety');
  const empty = computeSeasonAwards({ events: [] }, world);
  assertEqual(empty.mvp, null, 'no MVP for an empty season');
  assertEqual(empty.allProFirst.length, 0, 'no All-Pro for an empty season');
  assertEqual(computeSeasonAwards(null, world).mvp, null, 'null season is safe');
  assertEqual(computeSeasonAwards(season, null).mvp, null, 'null world is safe');
}
