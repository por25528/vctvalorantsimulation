/**
 * tests/unit/injuries.test.mjs — P7c injury mechanics (CONTRACTS-POLISH P7c).
 *
 * Pure mechanics (tick/chance/roll/fatigue-floor) + the injuryNews generator +
 * a multi-slot career integration: injuries occur, are seeded/deterministic, never
 * break the >=5 roster, pin fatigue while active, and heal over the off-season.
 */

import { assert, assertEqual, assertClose, section } from '../_assert.mjs';
import { createRng } from '../../src/core/rng.js';
import { hashSeed } from '../../src/core/hash.js';
import {
  tickInjury, injuryChance, rollInjury, injuredFatigue, isFreshInjury, INJURY_TYPES
} from '../../src/engine/career/injuries.js';
import { injuryNews } from '../../src/engine/career/news.js';
import { initCareer, advanceCareerSlot, runCareerOffseason } from '../../src/engine/career/career.js';
import { BALANCE } from '../../src/config/balance.js';

const I = BALANCE.CAREER.INJURY;

export default async function run() {
  section('tickInjury — heals one slot at a time, clears at 0');
  assertEqual(tickInjury({ weeks: 3, type: 'knock' }), { weeks: 2, type: 'knock' }, 'weeks decremented, type kept');
  assertEqual(tickInjury({ weeks: 1, type: 'knock' }), null, 'a 1-week injury clears');
  assertEqual(tickInjury(null), null, 'null is safe');

  section('injuryChance — scales with fatigue / maps / age, clamped');
  const base = injuryChance({ age: 20 }, { fatigue: 0 }, 0);
  assert(base >= I.BASE_CHANCE - 1e-9, 'floor at BASE_CHANCE for a fresh young player');
  assert(injuryChance({ age: 20 }, { fatigue: 100 }, 0) > base, 'fatigue raises the chance');
  assert(injuryChance({ age: 20 }, { fatigue: 0 }, 30) > base, 'maps raise the chance');
  assert(injuryChance({ age: 34 }, { fatigue: 0 }, 0) > base, 'age raises the chance');
  assert(injuryChance({ age: 40 }, { fatigue: 100 }, 200) <= I.MAX_CHANCE + 1e-9, 'clamped to MAX_CHANCE');

  section('rollInjury — deterministic, valid shape, gated by chance');
  // forced hit / miss via stub rng
  const hit = rollInjury({ age: 30 }, { fatigue: 90 }, 20, { chance: () => true, range: () => 2, int: () => 1 });
  assert(hit && hit.weeks === 2 && INJURY_TYPES.includes(hit.type), 'a hit returns a valid injury');
  assertEqual(rollInjury({ age: 30 }, { fatigue: 90 }, 20, { chance: () => false, range: () => 2, int: () => 0 }), null, 'a miss returns null');
  // determinism with a real seeded rng
  const r1 = rollInjury({ age: 30 }, { fatigue: 95 }, 25, createRng(hashSeed('s', 1)));
  const r2 = rollInjury({ age: 30 }, { fatigue: 95 }, 25, createRng(hashSeed('s', 1)));
  assertEqual(r1, r2, 'same seed => identical roll');

  section('injuredFatigue — never below the floor, clamped to 100');
  assert(injuredFatigue(0) >= I.FATIGUE_FLOOR, 'pins up to the floor');
  assertEqual(injuredFatigue(99), 99, 'keeps a higher current fatigue');
  assert(injuredFatigue(200) === 100, 'clamped at 100');

  section('isFreshInjury — fresh vs continuing-tick vs heal-and-reinjure');
  assert(isFreshInjury(null, { weeks: 2, type: 'k' }) === true, 'fit -> injured is fresh');
  assert(isFreshInjury({ weeks: 3, type: 'k' }, { weeks: 2, type: 'k' }) === false, 'a continuing tick-down is NOT fresh');
  assert(isFreshInjury({ weeks: 1, type: 'old' }, { weeks: 1, type: 'new' }) === true, 'heal-and-reinjure (same weeks) IS fresh');
  assert(isFreshInjury({ weeks: 1, type: 'k' }, { weeks: 3, type: 'k2' }) === true, 'heal-and-reinjure (longer) IS fresh');
  assert(isFreshInjury({ weeks: 1, type: 'k' }, null) === false, 'a clean heal is not fresh');
  assert(isFreshInjury({ weeks: 2, type: 'k' }, null) === false, 'no current injury is never fresh');

  section('injuryNews — generator items');
  const world = { teamsById: { t1: { id: 't1', name: 'Alpha' } }, playersById: { p1: { id: 'p1', handle: 'star', contract: { teamId: 't1' } } } };
  const news = injuryNews([{ playerId: 'p1', injury: { weeks: 2, type: 'wrist strain' } }], world, { seasonIndex: 0, slotId: 'stage1', followedTeamId: 't1' });
  assert(news.length === 1 && news[0].kind === 'injury', 'one injury item');
  assert(news[0].headline.includes('star picks up a wrist strain') && news[0].headline.includes('2 events'), 'headline text');
  assertEqual(news[0].tone, 'bad', 'followed-team injury is bad-toned');

  section('career integration — injuries occur, deterministic, roster-safe, heal in the off-season');
  const fingerprint = (st) => Object.keys(st.world.playersById).filter((id) => st.world.playersById[id].injury).sort().join(',');
  let a = initCareer('inj-test');
  let b = initCareer('inj-test');
  let injuredEver = 0;
  for (let i = 0; i < 8; i++) {
    a = advanceCareerSlot(a);
    b = advanceCareerSlot(b);
    assertEqual(fingerprint(a), fingerprint(b), `slot ${i}: same seed => identical injuries`);
    // every roster still has exactly 5 and no double-roster
    const seen = new Set();
    for (const tid of Object.keys(a.world.teamsById)) {
      const roster = a.world.teamsById[tid].roster;
      assert(roster.length === 5, `slot ${i}: team ${tid} still fields 5`);
      for (const pid of roster) { assert(!seen.has(pid), 'no double-roster'); seen.add(pid); }
    }
    // injured players carry the pinned fatigue floor
    for (const id of Object.keys(a.world.playersById)) {
      const p = a.world.playersById[id];
      if (p.injury) { injuredEver += 1; assert(p.dynamics.fatigue >= I.FATIGUE_FLOOR, `injured ${id} has pinned fatigue`); }
    }
  }
  assert(injuredEver > 0, 'injuries happened over the season');

  // The off-season heals everyone.
  a = runCareerOffseason(a);
  const stillInjured = Object.keys(a.world.playersById).filter((id) => a.world.playersById[id].injury).length;
  assertEqual(stillInjured, 0, 'the off-season clears every injury');

  section('regression — different seed yields a different injury pattern');
  let c = initCareer('inj-other');
  for (let i = 0; i < 8; i++) c = advanceCareerSlot(c);
  // (a is post-offseason now; compare pre-offseason b vs c)
  assert(fingerprint(b) !== fingerprint(c) || b.season.champion !== c.season.champion, 'a different seed diverges');
}
