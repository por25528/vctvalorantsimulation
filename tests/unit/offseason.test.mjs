/**
 * tests/unit/offseason.test.mjs — the off-season pipeline (CONTRACTS-CAREER §2, §5).
 * Runs runOffseason over the real 48-team world and asserts the world-transition
 * invariants hold even under the season-0 mass-renewal stress (all seed contracts
 * expire at 0). Pure & rng-injected.
 */

import { assert, section } from '../_assert.mjs';
import { runOffseason } from '../../src/engine/career/offseason.js';
import { buildWorld } from '../../src/data/seed/index.js';
import { createRng } from '../../src/core/rng.js';
import { BALANCE } from '../../src/config/balance.js';

const MIN = BALANCE.CAREER.MARKET.MIN_ROSTER;

/** A stable fingerprint of a world's rosters (order-sensitive). */
function rosterFingerprint(world) {
  return Object.keys(world.teamsById)
    .sort()
    .map((id) => `${id}:${world.teamsById[id].roster.join(',')}`)
    .join('|');
}

export default async function run() {
  const world = buildWorld();
  const origAges = {};
  for (const id of Object.keys(world.playersById)) origAges[id] = world.playersById[id].age;

  const { world: next, report } = runOffseason(world, createRng(2026), { season: 0 });

  section('runOffseason — every roster stays valid (exactly MIN_ROSTER)');
  for (const id of Object.keys(next.teamsById)) {
    assert(next.teamsById[id].roster.length === MIN, `team ${id} has exactly ${MIN} players`);
  }

  section('runOffseason — no player is on two rosters; rostered ⇒ active & owned');
  const seen = new Set();
  for (const id of Object.keys(next.teamsById)) {
    for (const pid of next.teamsById[id].roster) {
      assert(!seen.has(pid), `player ${pid} appears on only one roster`);
      seen.add(pid);
      const p = next.playersById[pid];
      assert(p, `rostered player ${pid} exists in playersById`);
      assert(p.contract.status === 'active' && p.contract.teamId === id, `rostered ${pid} is active & owned by ${id}`);
    }
  }

  section('runOffseason — everyone aged exactly one year; retired are off the rosters');
  for (const id of Object.keys(origAges)) {
    const p = next.playersById[id];
    assert(p, `original player ${id} survives into the next world`);
    assert(p.age === origAges[id] + 1, `player ${id} aged exactly one year`);
  }
  for (const rid of report.retired) {
    const p = next.playersById[rid];
    assert(p.contract.status === 'retired' && p.contract.teamId === null, `retiree ${rid} is retired & teamless`);
    assert(!seen.has(rid), `retiree ${rid} holds no roster slot`);
  }

  section('runOffseason — report shape + newgens entered the world');
  assert(report.season === 0, 'report carries the season');
  assert(Array.isArray(report.retired) && Array.isArray(report.newgens), 'retired/newgens are arrays');
  assert(Array.isArray(report.contracts.renewed) && Array.isArray(report.contracts.released), 'contract lists present');
  assert(Array.isArray(report.transfers), 'transfers are an array');
  assert(report.newgens.length > 0, 'newgens were generated');
  for (const ng of report.newgens) {
    assert(next.playersById[ng], `newgen ${ng} exists in the next world`);
  }

  section('runOffseason — input world is not mutated');
  assert(world.playersById[Object.keys(origAges)[0]].age === origAges[Object.keys(origAges)[0]], 'source ages untouched');
  for (const id of Object.keys(world.teamsById)) {
    assert(world.teamsById[id].roster.length === MIN, `source team ${id} roster untouched`);
  }

  section('runOffseason — deterministic for a given seed');
  const again = runOffseason(buildWorld(), createRng(2026), { season: 0 });
  assert(rosterFingerprint(again.world) === rosterFingerprint(next), 'same world+seed reproduces identical rosters');
  assert(JSON.stringify(again.report.retired) === JSON.stringify(report.retired), 'same seed reproduces identical retirements');
  const diff = runOffseason(buildWorld(), createRng(777), { season: 0 });
  assert(rosterFingerprint(diff.world) !== rosterFingerprint(next), 'a different seed diverges');

  section('runOffseason — totals balance (rosters conserved at MIN×teams)');
  const teamCount = Object.keys(next.teamsById).length;
  assert(seen.size === teamCount * MIN, `${teamCount} teams × ${MIN} = ${teamCount * MIN} rostered players`);
}
