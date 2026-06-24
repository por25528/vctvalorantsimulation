/**
 * tests/unit/development.test.mjs — aging & attribute development
 * (CONTRACTS-CAREER §1.2, §5; P12.1 rewrite). Pure & rng-injected.
 *
 * The P12.1 model is shape-preserving logistic growth toward `potential` with an
 * age-falloff, so a talent ARRIVES inside their prime (not decades later), plus
 * wonderkid/bust archetypes and IGL-aware longevity.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { developPlayer } from '../../src/engine/career/offseason/development.js';
import { overall } from '../../src/engine/career/playerStats.js';
import { createPlayer } from '../../src/domain/player.js';
import { createRng } from '../../src/core/rng.js';

const FLAT = (v) => ({ aim: v, movement: v, reaction: v, composure: v, consistency: v, gameSense: v, utility: v, trading: v, igl: v });

/** Mean over N seeded developments of a fresh copy of `make()`. */
function meanTrajectory(make, n) {
  let sum = 0;
  for (let s = 0; s < n; s += 1) {
    const after = developPlayer(make(), createRng(1000 + s));
    sum += after.development.trajectory;
  }
  return sum / n;
}

/** Develop a player `years` times down one seeded rng stream. */
function developYears(player, years, seed) {
  const rng = createRng(seed);
  let p = player;
  for (let i = 0; i < years; i += 1) p = developPlayer(p, rng);
  return p;
}

export default async function run() {
  section('developPlayer — deterministic + non-mutating');
  const p = createPlayer({ name: 'Y', age: 19, potential: 92, attributes: { aim: 70 }, development: { peakAge: 25, declineAge: 29 } });
  assertEqual(developPlayer(p, createRng(7)), developPlayer(p, createRng(7)), 'same seed reproduces the player');
  assert(developPlayer(p, createRng(7)).age === p.age + 1, 'age advances by exactly one');
  assert(p.age === 19, 'the input player is not mutated');

  section('developPlayer — young high-potential players grow on average');
  const makeYoung = () => createPlayer({
    name: 'Prospect', age: 18, potential: 92, attributes: FLAT(70),
    development: { peakAge: 25, declineAge: 29 }
  });
  const youngTraj = meanTrajectory(makeYoung, 60);
  assert(youngTraj > 1.5, `young high-potential prospects climb meaningfully (mean trajectory ${youngTraj.toFixed(2)})`);

  section('developPlayer — a prospect REACHES near potential during the prime (the P12.1 fix)');
  {
    // A raw 16-yo (overall 55, potential 88) developed year-by-year should arrive
    // within ~10 of potential by their peak age — a handful of seasons, not 15+.
    let young = createPlayer({ name: 'Riser', age: 16, potential: 88, attributes: FLAT(55), development: { peakAge: 25, declineAge: 29, growthRate: 1, archetype: 'normal' } });
    young = developYears(young, 25 - 16, 4242); // develop until age 25 (peak)
    const ov = overall(young);
    assert(young.age === 25, `developed to peak age (age ${young.age})`);
    assert(ov >= young.potential - 10, `arrives near potential by peak (overall ${ov.toFixed(1)} vs potential ${young.potential})`);
    assert(ov > 55 + 18, `climbed substantially from a raw start (overall ${ov.toFixed(1)})`);
  }

  section('developPlayer — wonderkids outgrow busts, growthRate matters');
  {
    const base = { name: 'X', age: 17, potential: 86, attributes: FLAT(60), development: { peakAge: 25, declineAge: 29, growthRate: 1 } };
    const wk = developYears(createPlayer({ ...base, development: { ...base.development, archetype: 'wonderkid' } }), 4, 99);
    const bs = developYears(createPlayer({ ...base, development: { ...base.development, archetype: 'bust' } }), 4, 99);
    assert(overall(wk) > overall(bs) + 4, `wonderkid (${overall(wk).toFixed(1)}) clearly outgrows bust (${overall(bs).toFixed(1)})`);
  }

  section('developPlayer — role shape is preserved through growth');
  {
    // A duelist (high aim, low igl) should still be aim-heavy / igl-light after
    // several growth seasons — growth lifts the whole profile, not the weak spots.
    let duelist = createPlayer({ role: 'Duelist', name: 'Aimer', age: 18, potential: 92, attributes: { aim: 86, movement: 84, reaction: 84, composure: 70, consistency: 72, gameSense: 66, utility: 60, trading: 72, igl: 40 }, development: { peakAge: 25, declineAge: 29 } });
    duelist = developYears(duelist, 4, 17);
    assert(duelist.attributes.aim - duelist.attributes.igl > 30, `role identity persists (aim ${duelist.attributes.aim.toFixed(0)} vs igl ${duelist.attributes.igl.toFixed(0)})`);
  }

  section('developPlayer — aging veterans decline, physical faster than mental');
  const makeVet = () => createPlayer({
    name: 'Vet', age: 33, potential: 90,
    attributes: { aim: 84, movement: 82, reaction: 84, composure: 80, consistency: 80, gameSense: 86, utility: 78, trading: 80, igl: 80 },
    development: { peakAge: 25, declineAge: 29 }
  });
  const vetTraj = meanTrajectory(makeVet, 60);
  assert(vetTraj < 0, `aging veterans trend down (mean trajectory ${vetTraj.toFixed(2)})`);

  let physDrop = 0;
  let mentDrop = 0;
  const N = 80;
  for (let s = 0; s < N; s += 1) {
    const v = makeVet();
    const a = developPlayer(v, createRng(5000 + s));
    physDrop += (v.attributes.aim - a.attributes.aim) + (v.attributes.movement - a.attributes.movement) + (v.attributes.reaction - a.attributes.reaction);
    mentDrop += (v.attributes.gameSense - a.attributes.gameSense) + (v.attributes.igl - a.attributes.igl) + (v.attributes.composure - a.attributes.composure);
  }
  assert(physDrop > mentDrop, `physical decline (${(physDrop / N).toFixed(2)}) exceeds mental decline (${(mentDrop / N).toFixed(2)})`);

  section('developPlayer — high-IGL veterans last longer (softer, later decline)');
  {
    const attrs = (igl) => ({ aim: 80, movement: 80, reaction: 80, composure: 82, consistency: 80, gameSense: 84, utility: 80, trading: 80, igl });
    const hi = createPlayer({ name: 'Leader', age: 31, potential: 90, attributes: attrs(92), development: { peakAge: 25, declineAge: 29 } });
    const lo = createPlayer({ name: 'Fragger', age: 31, potential: 90, attributes: attrs(55), development: { peakAge: 25, declineAge: 29 } });
    const hiT = developPlayer(hi, createRng(321)).development.trajectory;
    const loT = developPlayer(lo, createRng(321)).development.trajectory;
    assert(hiT > loT, `the IGL declines slower (igl-vet Δ ${hiT} vs fragger Δ ${loT})`);
  }

  section('developPlayer — attributes stay within [0,100]');
  const extreme = createPlayer({ name: 'Old', age: 45, attributes: { aim: 2, movement: 2, reaction: 2 }, development: { peakAge: 25, declineAge: 29 } });
  const aged = developPlayer(extreme, createRng(3));
  for (const k of Object.keys(aged.attributes)) {
    const v = aged.attributes[k];
    assert(v >= 0 && v <= 100, `attribute ${k} (${v}) stays clamped in [0,100]`);
  }
  assert(typeof overall(aged) === 'number', 'overall is computable on the aged player');
}
