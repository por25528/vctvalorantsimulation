/**
 * tests/unit/talent-pool.test.mjs — newgen quality + long-run talent-pool health
 * (CONTRACTS-CAREER §1.4, §2, §5).
 *
 * Two layers of invariant:
 *   1. PROSPECT DISTRIBUTION — a large newgen batch must form a believable talent
 *      pyramid (many journeyman, fewer solid pros, a thin elite tail), honour the
 *      role-weight demographics, carry role-shaped stat lines (a Duelist is
 *      aim-heavy / igl-light), debut in the youth age band, and start below their
 *      potential.
 *   2. POOL HEALTH OVER TIME — driving the off-season pipeline (develop → retire →
 *      newgen → contracts → transfers) for many years, the T1 pool must stay
 *      STABLE: rosters always valid, the rostered overall mean neither collapses
 *      nor explodes, the ceiling never inflates past the newgen cap, no role ever
 *      droughts, and the active-player pool plateaus instead of exploding.
 *
 * The pool-health loop runs the off-season WITHOUT playing matches — pure, fast,
 * and deterministic — which isolates the talent dynamics from match variance
 * while still exercising the full reshape each year. (The match-coupled path is
 * covered by tests/career.test.mjs.)
 */

import { assert, section } from '../_assert.mjs';
import { generateNewgens } from '../../src/engine/career/offseason/newgen.js';
import { runOffseason } from '../../src/engine/career/offseason.js';
import { overall } from '../../src/engine/career/playerStats.js';
import { createPlayer } from '../../src/domain/player.js';
import { buildWorld } from '../../src/data/seed/index.js';
import { createRng } from '../../src/core/rng.js';
import { hashSeed } from '../../src/core/hash.js';
import { BALANCE } from '../../src/config/balance.js';

const N = BALANCE.CAREER.NEWGEN;
const M = BALANCE.CAREER.MARKET;
const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Roster snapshot of a world: rostered players + per-role counts. */
function rosterSnapshot(world) {
  const ids = new Set();
  for (const t of Object.values(world.teamsById)) for (const id of t.roster) ids.add(id);
  const players = [...ids].map((id) => world.playersById[id]).filter(Boolean);
  const roleCounts = {};
  for (const r of ROLES) roleCounts[r] = 0;
  for (const p of players) roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
  return { players, ovrs: players.map(overall), roleCounts };
}

export default async function run() {
  // ============================ 1. PROSPECT DISTRIBUTION ============================
  section('talent pool — prospect potential forms a believable pyramid');
  const big = generateNewgens(3000, createRng(20260624), { season: 1, nationalityPool: ['KR', 'US', 'BR', 'EU'] });
  const pots = big.map((p) => p.potential);
  const journeyman = pots.filter((v) => v < 70).length;
  const solid = pots.filter((v) => v >= 70 && v < 84).length;
  const elite = pots.filter((v) => v >= 84).length;
  assert(journeyman > elite, `journeyman prospects outnumber elite (${journeyman} vs ${elite})`);
  assert(solid > elite, `solid prospects outnumber elite (${solid} vs ${elite})`);
  assert(elite / big.length < 0.18, `elite prospects are a thin tail (${(100 * elite / big.length).toFixed(1)}%)`);
  assert(elite / big.length > 0.01, `but elite prospects do exist (${(100 * elite / big.length).toFixed(1)}%)`);
  const potMean = mean(pots);
  assert(Math.abs(potMean - N.POT_MEAN) < 2.5, `batch potential mean (${potMean.toFixed(1)}) tracks POT_MEAN (${N.POT_MEAN})`);
  assert(Math.min(...pots) >= N.POT_MIN && Math.max(...pots) <= N.POT_MAX, `potential stays within [${N.POT_MIN}, ${N.POT_MAX}] (the ceiling never inflates into 95+ gods)`);

  section('talent pool — prospects debut young and below their potential');
  let below = 0;
  for (const p of big) {
    assert(p.age >= N.AGE_MIN && p.age <= N.AGE_MAX, `debut age ${p.age} within youth band`);
    if (overall(p) < p.potential) below += 1;
  }
  assert(below >= big.length * 0.95, `the overwhelming majority start below potential (${below}/${big.length})`);

  section('talent pool — role demographics track the configured weights');
  const roleCount = {};
  for (const r of ROLES) roleCount[r] = 0;
  for (const p of big) roleCount[p.role] += 1;
  for (const r of ROLES) {
    assert(roleCount[r] > 0, `role ${r} is represented (${roleCount[r]})`);
    const share = roleCount[r] / big.length;
    const want = N.ROLE_WEIGHTS[r];
    assert(Math.abs(share - want) < 0.05, `role ${r} share ${(100 * share).toFixed(1)}% ~ weight ${(100 * want).toFixed(0)}%`);
  }

  section('talent pool — generated players carry a believable role identity');
  const byRole = {};
  for (const r of ROLES) byRole[r] = big.filter((p) => p.role === r);
  const avgAttr = (ps, k) => mean(ps.map((p) => p.attributes[k]));
  // A Duelist is aim-heavy and igl-light relative to a Controller/Sentinel.
  assert(avgAttr(byRole.Duelist, 'aim') > avgAttr(byRole.Controller, 'aim') + 6, 'Duelists out-aim Controllers');
  assert(avgAttr(byRole.Duelist, 'igl') < avgAttr(byRole.Controller, 'igl') - 6, 'Duelists are more igl-light than Controllers');
  assert(avgAttr(byRole.Controller, 'utility') > avgAttr(byRole.Duelist, 'utility') + 6, 'Controllers out-utility Duelists');

  // ============================ 2. POOL HEALTH OVER TIME ============================
  section('talent pool — health stays stable across many off-seasons');
  const SEED = 'pool-health-2026';
  const SEASONS = 12;
  const teamCount = Object.keys(buildWorld().teamsById).length;
  const expectRostered = teamCount * M.MIN_ROSTER;

  let world = buildWorld();
  const initialActive = Object.values(world.playersById).filter((p) => p.contract.status !== 'retired').length;
  const meansOverTime = [];
  let maxCeiling = 0;
  for (let i = 0; i < SEASONS; i += 1) {
    const rng = createRng(hashSeed(SEED, 'offseason', i));
    ({ world } = runOffseason(world, rng, { season: i }));

    const snap = rosterSnapshot(world);
    // Rosters always valid: exactly MIN_ROSTER per team, every rostered player active+owned.
    assert(snap.players.length === expectRostered, `season ${i}: ${expectRostered} players rostered (got ${snap.players.length})`);
    for (const t of Object.values(world.teamsById)) {
      assert(t.roster.length === M.MIN_ROSTER, `season ${i}: team ${t.id} has exactly ${M.MIN_ROSTER}`);
    }

    const m = mean(snap.ovrs);
    meansOverTime.push(m);
    maxCeiling = Math.max(maxCeiling, Math.max(...snap.ovrs));

    // No role drought: every role keeps a healthy share of the 240 seats.
    for (const r of ROLES) {
      assert(snap.roleCounts[r] >= 0.10 * expectRostered, `season ${i}: role ${r} not droughted (${snap.roleCounts[r]}/${expectRostered})`);
    }

    // Active pool never explodes (bounded relative to the seed population).
    const active = Object.values(world.playersById).filter((p) => p.contract.status !== 'retired').length;
    assert(active < initialActive * 2.2, `season ${i}: active pool bounded (${active} vs seed ${initialActive})`);
  }

  // Steady-state band (after the seed→newgen transition completes ~season 6).
  const steady = meansOverTime.slice(6);
  for (const m of steady) {
    assert(m >= 64 && m <= 82, `steady-state rostered mean stays in a believable band (${m.toFixed(1)})`);
  }
  // No drift: the back half barely moves (stable, not slowly bleeding or inflating).
  const firstHalf = mean(steady.slice(0, Math.floor(steady.length / 2)));
  const secondHalf = mean(steady.slice(Math.floor(steady.length / 2)));
  assert(Math.abs(firstHalf - secondHalf) < 4, `pool quality does not drift across the steady state (${firstHalf.toFixed(1)} → ${secondHalf.toFixed(1)})`);
  // Ceiling never inflates past the newgen potential cap (no runaway megastars).
  assert(maxCeiling <= N.POT_MAX + 1, `the league ceiling never inflates past the newgen cap (${maxCeiling.toFixed(1)} vs ${N.POT_MAX})`);

  section('talent pool — multi-season pipeline is deterministic');
  function fingerprintRun(seed) {
    let w = buildWorld();
    for (let i = 0; i < 4; i += 1) {
      const rng = createRng(hashSeed(seed, 'offseason', i));
      ({ world: w } = runOffseason(w, rng, { season: i }));
    }
    return Object.keys(w.teamsById).sort().map((id) => `${id}:${w.teamsById[id].roster.join(',')}`).join('|');
  }
  assert(fingerprintRun(SEED) === fingerprintRun(SEED), 'same seed reproduces the identical multi-season pool');
  assert(fingerprintRun(SEED) !== fingerprintRun('other-seed'), 'a different seed diverges');

  // ============================ 3. POTENTIAL DERIVATION ============================
  section('talent pool — authored players are never stranded below their own ability');
  // A strong, unspecified-potential player (the seed-data case) must get a
  // ceiling at or above their current overall, with youth carrying headroom.
  const star = createPlayer({ name: 'Star', age: 22, role: 'Duelist', attributes: { aim: 88, movement: 86, reaction: 86, composure: 82, consistency: 84, gameSense: 84, utility: 78, trading: 84, igl: 70 } });
  assert(star.potential >= overall(star), `a young star's potential (${star.potential}) is >= their overall (${overall(star).toFixed(1)})`);
  const vet = createPlayer({ name: 'Vet', age: 30, role: 'Duelist', attributes: { aim: 88, movement: 86, reaction: 86, composure: 82, consistency: 84, gameSense: 84, utility: 78, trading: 84, igl: 70 } });
  assert(vet.potential >= overall(vet) - 0.5, `a veteran's potential (${vet.potential}) is ~ their overall (${overall(vet).toFixed(1)}) — capped, no growth runway`);
  assert(star.potential > vet.potential, `the younger player carries more headroom (${star.potential} > ${vet.potential})`);
  // An explicit potential is still honoured verbatim.
  const fixed = createPlayer({ name: 'Fixed', age: 18, potential: 80, attributes: { aim: 60 } });
  assert(fixed.potential === 80, 'an explicit potential is honoured');
}
