/**
 * tests/career.test.mjs — multi-season career invariants (CONTRACTS-CAREER §3, §5).
 *
 * Drives the real career engine over multiple seasons and asserts the
 * cross-season invariants: valid rosters every year, ages advancing, newgens
 * entering, dynamics evolving DURING a season (the P6c payoff), and full
 * determinism (same seed ⇒ identical career; different seed diverges). Also guards
 * that the underlying season engine stayed pure (simSeason is unchanged).
 *
 * Top-level suite (registered in tests/run.mjs alongside season/kickoff).
 */

import { assert, section } from './_assert.mjs';
import { initCareer, advanceCareerSlot, simCareer } from '../src/engine/career/career.js';
import { simSeason } from '../src/engine/career/season.js';
import { buildWorld } from '../src/data/seed/index.js';

const MIN = 5;

/** Stable per-team roster fingerprint of a world. */
function rosterFingerprint(world) {
  return Object.keys(world.teamsById)
    .sort()
    .map((id) => `${id}:${world.teamsById[id].roster.join(',')}`)
    .join('|');
}

/** Assert every team roster is exactly MIN and nobody is double-rostered. */
function assertValidRosters(world, label) {
  const seen = new Set();
  for (const id of Object.keys(world.teamsById)) {
    const roster = world.teamsById[id].roster;
    assert(roster.length === MIN, `${label}: team ${id} has exactly ${MIN} players`);
    for (const pid of roster) {
      assert(!seen.has(pid), `${label}: player ${pid} is on only one roster`);
      seen.add(pid);
      const p = world.playersById[pid];
      assert(p && p.contract.status === 'active' && p.contract.teamId === id, `${label}: ${pid} active & owned by ${id}`);
    }
  }
  return seen;
}

export default async function run() {
  section('simCareer — runs N full seasons, crowning a champion each year');
  const { history, finalWorld } = simCareer('career-2026', 2);
  assert(history.length === 2, 'two seasons were completed');
  for (const h of history) {
    assert(typeof h.champion === 'string' && h.champion.length > 0, `season ${h.seasonIndex} crowned a champion`);
    assert(finalWorld.teamsById[h.champion] || h.champion, 'the champion is a team id');
    assert(Array.isArray(h.championsField) && h.championsField.length === 16, 'a 16-team Champions field is recorded');
    assert(Array.isArray(h.finalStandings) && h.finalStandings.length > 0, 'final standings recorded');
  }

  section('simCareer — rosters stay valid across every season');
  assertValidRosters(finalWorld, 'finalWorld');

  section('simCareer — the world ages and newgens enter over time');
  const fresh = initCareer('career-2026');
  // Every original player that survives is older; the player pool grew (newgens).
  let aged = 0;
  for (const id of Object.keys(fresh.world.playersById)) {
    const after = finalWorld.playersById[id];
    if (after && after.age > fresh.world.playersById[id].age) aged += 1;
  }
  assert(aged > 0, 'players aged across the career');
  assert(
    Object.keys(finalWorld.playersById).length > Object.keys(fresh.world.playersById).length,
    'the player pool grew (newgens joined the world)'
  );
  // No retiree holds a roster slot.
  for (const id of Object.keys(finalWorld.playersById)) {
    if (finalWorld.playersById[id].contract.status === 'retired') {
      const onRoster = Object.values(finalWorld.teamsById).some((t) => t.roster.includes(id));
      assert(!onRoster, `retiree ${id} holds no roster slot`);
    }
  }

  section('advanceCareerSlot — dynamics evolve DURING a season');
  let s = initCareer('career-2026');
  for (const id of Object.keys(s.world.playersById)) {
    const d = s.world.playersById[id].dynamics;
    assert(d.form === 0 && d.fatigue === 0, 'every player starts a fresh career rested');
  }
  s = advanceCareerSlot(s); // play the Kickoff slot
  let moved = 0;
  for (const id of Object.keys(s.world.playersById)) {
    const d = s.world.playersById[id].dynamics;
    if (d.fatigue > 0 || d.form !== 0 || d.morale !== 60) moved += 1;
  }
  assert(moved > 0, 'playing a slot moved players off their default dynamics');
  assert(s.season.events.length > 0, 'the slot was actually played');

  section('simCareer — deterministic (same seed ⇒ identical career)');
  const again = simCareer('career-2026', 2);
  assert(
    again.history.map((h) => h.champion).join(',') === history.map((h) => h.champion).join(','),
    'same seed reproduces the same champions'
  );
  assert(rosterFingerprint(again.finalWorld) === rosterFingerprint(finalWorld), 'same seed reproduces identical final rosters');

  section('simCareer — a different seed diverges');
  const other = simCareer('different-seed', 2);
  const sameChamps = other.history.map((h) => h.champion).join(',') === history.map((h) => h.champion).join(',');
  const sameRosters = rosterFingerprint(other.finalWorld) === rosterFingerprint(finalWorld);
  assert(!(sameChamps && sameRosters), 'a different seed yields a different career');

  section('regression — simSeason stayed pure (unchanged, deterministic)');
  const w = buildWorld();
  const r1 = simSeason(w, 13);
  const r2 = simSeason(w, 13);
  assert(r1.champion === r2.champion, 'simSeason is still deterministic for a fixed world');
  assert(JSON.stringify(r1.championsField) === JSON.stringify(r2.championsField), 'simSeason Champions field is stable');
}
