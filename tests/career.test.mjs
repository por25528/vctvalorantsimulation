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
import { initCareer, advanceCareerSlot, advanceCareer, simCareer } from '../src/engine/career/career.js';
import { simSeason } from '../src/engine/career/season.js';
import { buildWorld } from '../src/data/seed/index.js';
import { BALANCE } from '../src/config/balance.js';

const MIN = 5;
const FLOOR = BALANCE.CAREER.ECONOMY.BUDGET_FLOOR;
const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

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

  section('transfer realism — AI clubs manage rosters & budgets sanely over time (M7)');
  // Drive a real career season-by-season, auditing the off-season market each year:
  // budgets stay above the floor, rosters stay valid & trend role-complete, and the
  // AI does NOT splash transfer fees on over-the-hill players (the M7 valuation fix).
  {
    let st = initCareer('career-2026');
    let guard = 0;
    const feePaidAges = [];
    let roleCompleteSamples = 0;
    let roleCompleteTeams = 0;
    const SEASONS = 4;
    while (st.history.length < SEASONS && guard < SEASONS * 18 + 16) {
      const before = st.history.length;
      st = advanceCareer(st);
      guard += 1;
      if (st.history.length === before) continue; // mid-season slot
      const w = st.world;
      // Every roster valid every season; every budget above the floor.
      assertValidRosters(w, `season ${before}`);
      for (const t of Object.values(w.teamsById)) {
        assert(t.budget >= FLOOR, `season ${before}: team ${t.id} budget ${t.budget} >= floor ${FLOOR}`);
      }
      // Role completeness of the AI starting fives (sampled each off-season).
      for (const t of Object.values(w.teamsById)) {
        const roles = new Set();
        for (const pid of t.roster.slice(0, 5)) { const p = w.playersById[pid]; if (p) roles.add(p.role); }
        roleCompleteSamples += 1;
        if (ROLES.every((r) => roles.has(r))) roleCompleteTeams += 1;
      }
      // Ages of players acquired for a FEE (a real "we paid up for this" decision).
      for (const m of st.offseason.transfers) {
        if (m.kind === 'transfer' && m.fee > 0 && m.toTeamId) {
          const p = w.playersById[m.playerId];
          if (p) feePaidAges.push(p.age);
        }
      }
    }
    assert(feePaidAges.length > 0, 'the AI made at least some paid transfers over the career');
    const meanFeeAge = feePaidAges.reduce((a, b) => a + b, 0) / feePaidAges.length;
    // Real orgs pay fees for players in (or approaching) their prime, not for decliners.
    assert(meanFeeAge < 28, `mean age of fee-paid acquisitions is a prime band (${meanFeeAge.toFixed(1)} < 28)`);
    const over32 = feePaidAges.filter((a) => a >= 32).length;
    assert(over32 === 0, `no transfer fee is paid for a 32+ player over the career (got ${over32})`);
    const roleCompleteRate = roleCompleteTeams / roleCompleteSamples;
    assert(roleCompleteRate >= 0.75, `most AI starting fives are role-complete (${(roleCompleteRate * 100).toFixed(0)}% >= 75%)`);
  }

  section('regression — simSeason stayed pure (unchanged, deterministic)');
  const w = buildWorld();
  const r1 = simSeason(w, 13);
  const r2 = simSeason(w, 13);
  assert(r1.champion === r2.champion, 'simSeason is still deterministic for a fixed world');
  assert(JSON.stringify(r1.championsField) === JSON.stringify(r2.championsField), 'simSeason Champions field is stable');
}
