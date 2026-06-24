/**
 * tests/unit/veto.test.mjs — unit tests for engine/match/veto.js
 * (CONTRACTS §10, §14).
 *
 * Verifies runVeto:
 *   - Bo3 yields up to 3 maps with the correct pick/ban ordering
 *     (ban,ban,pick,pick,ban,ban,decider → picks tagged A, B, then decider),
 *   - mapsToPlay length === bestOf,
 *   - is deterministic for a fixed seed (and varies across seeds),
 *   - all maps come from MAP_POOL and are unique,
 *   - teams ban LOW-proficiency maps and pick HIGH-proficiency maps,
 *   - Bo5 produces 5 maps with the pick,pick,pick,pick,decider tagging.
 *
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createRng } from '../../src/core/rng.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { MAP_POOL } from '../../src/config/maps.js';
import { runVeto } from '../../src/engine/match/veto.js';

/**
 * Build a team + players lookup. `mapProf` lets a test bias the whole roster's
 * map proficiency for specific maps (every player shares it).
 * @param {string} tag
 * @param {Record<string, number>} [mapProf]
 * @returns {{ team:any, players:Record<string,any> }}
 */
function makeTeam(tag, mapProf = {}) {
  const roles = ['Duelist', 'Initiator', 'Controller', 'Sentinel', 'Initiator'];
  /** @type {Record<string,any>} */
  const players = {};
  const ids = [];
  roles.forEach((role, i) => {
    const p = createPlayer({
      id: `${tag}_p${i}`,
      name: `${tag}${i}`,
      role,
      proficiency: { maps: { ...mapProf } }
    });
    players[p.id] = p;
    ids.push(p.id);
  });
  const team = createTeam({ name: tag, tag, roster: ids });
  return { team, players };
}

/**
 * Merge two players lookups into one (ids are tag-prefixed so no collisions).
 * @param {...Record<string,any>} maps
 * @returns {Record<string,any>}
 */
function mergePlayers(...maps) {
  return Object.assign({}, ...maps);
}

/** @returns {Promise<void>} */
export default async function run() {
  const POOL = new Set(MAP_POOL);

  section('veto.runVeto — Bo3 shape, ordering, and pool validity');
  {
    const A = makeTeam('A');
    const B = makeTeam('B');
    const players = mergePlayers(A.players, B.players);

    for (let seed = 0; seed < 100; seed++) {
      const res = runVeto(A.team, B.team, players, 3, createRng(seed));

      assert(res && typeof res === 'object', `seed ${seed}: returns an object`);
      assert(Array.isArray(res.mapsToPlay), `seed ${seed}: mapsToPlay is an array`);
      assert(Array.isArray(res.picks), `seed ${seed}: picks is an array`);

      // mapsToPlay length === bestOf, and "up to 3 maps".
      assertEqual(res.mapsToPlay.length, 3, `seed ${seed}: mapsToPlay length === bestOf`);
      assert(res.mapsToPlay.length <= 3, `seed ${seed}: up to 3 maps`);

      // All maps from MAP_POOL and unique.
      for (const m of res.mapsToPlay) {
        assert(POOL.has(m), `seed ${seed}: ${m} is in MAP_POOL`);
      }
      assertEqual(
        new Set(res.mapsToPlay).size,
        res.mapsToPlay.length,
        `seed ${seed}: mapsToPlay are unique`
      );

      // Pick/ban ordering: Bo3 = ban,ban,pick,pick,ban,ban,decider → the picks
      // list is [A pick, B pick, decider].
      assertEqual(res.picks.length, 3, `seed ${seed}: 2 picks + 1 decider`);
      assertEqual(res.picks[0].by, 'A', `seed ${seed}: first pick by A`);
      assertEqual(res.picks[1].by, 'B', `seed ${seed}: second pick by B`);
      assertEqual(res.picks[2].by, 'decider', `seed ${seed}: third is the decider`);

      // picks and mapsToPlay describe the same maps in the same order.
      assertEqual(
        res.picks.map((p) => p.mapId),
        res.mapsToPlay,
        `seed ${seed}: picks align with mapsToPlay order`
      );
      // Picks are unique and all in the pool.
      assertEqual(new Set(res.picks.map((p) => p.mapId)).size, 3, `seed ${seed}: picks unique`);
      for (const p of res.picks) assert(POOL.has(p.mapId), `seed ${seed}: pick ${p.mapId} in pool`);
    }
  }

  section('veto.runVeto — deterministic for a fixed seed, varies across seeds');
  {
    const A = makeTeam('A');
    const B = makeTeam('B');
    const players = mergePlayers(A.players, B.players);

    const a = runVeto(A.team, B.team, players, 3, createRng(4242));
    const b = runVeto(A.team, B.team, players, 3, createRng(4242));
    assertEqual(a, b, 'same seed -> identical veto result');
    assert(a !== b, 'distinct object instances (fresh engine output)');
    assert(a.mapsToPlay !== b.mapsToPlay, 'fresh mapsToPlay array');

    let sawDifferent = false;
    for (let s = 1; s < 80 && !sawDifferent; s++) {
      const c = runVeto(A.team, B.team, players, 3, createRng(s));
      if (JSON.stringify(c.mapsToPlay) !== JSON.stringify(a.mapsToPlay)) sawDifferent = true;
    }
    assert(sawDifferent, 'different seeds can produce different vetoes');
  }

  section('veto.runVeto — teams ban LOW and pick HIGH proficiency maps');
  {
    // Team A loves "ascent" (high) and hates "bind" (low); team B is neutral.
    const A = makeTeam('A', { ascent: 95, bind: 5 });
    const B = makeTeam('B');
    const players = mergePlayers(A.players, B.players);

    let aPickedFav = 0;
    let aBannedHated = 0;
    let bindPlayed = 0;
    let ascentPlayed = 0;
    const N = 300;
    for (let s = 0; s < N; s++) {
      const res = runVeto(A.team, B.team, players, 3, createRng(s));
      const aPick = res.picks.find((p) => p.by === 'A');
      if (aPick && aPick.mapId === 'ascent') aPickedFav++;
      // A's ban (it acts first → first ban is A's). If "bind" never survives to
      // be played, A is effectively banning its hated map.
      const played = new Set(res.mapsToPlay);
      if (played.has('bind')) bindPlayed++;
      if (played.has('ascent')) ascentPlayed++;
      // Reconstruct A's ban: it is removed before any pick; we infer via absence.
      if (!played.has('bind')) aBannedHated++;
    }

    // A should pick its strong map (ascent) the large majority of the time.
    assert(aPickedFav > N * 0.6, `A picks favored 'ascent' often: ${aPickedFav}/${N}`);
    // A's hated 'bind' should rarely make it into the played set (A bans it).
    assert(bindPlayed < N * 0.25, `'bind' rarely played (A bans it): ${bindPlayed}/${N}`);
    // A's favored 'ascent' should frequently be in the played set.
    assert(ascentPlayed > N * 0.6, `'ascent' frequently played: ${ascentPlayed}/${N}`);
  }

  section('veto.runVeto — Bo5 shape and ordering');
  {
    const A = makeTeam('A');
    const B = makeTeam('B');
    const players = mergePlayers(A.players, B.players);

    for (let seed = 0; seed < 50; seed++) {
      const res = runVeto(A.team, B.team, players, 5, createRng(seed));
      assertEqual(res.mapsToPlay.length, 5, `seed ${seed}: Bo5 mapsToPlay length === 5`);
      assertEqual(new Set(res.mapsToPlay).size, 5, `seed ${seed}: Bo5 maps unique`);
      for (const m of res.mapsToPlay) assert(POOL.has(m), `seed ${seed}: ${m} in pool`);

      // Bo5: ban,ban,pick,pick,pick,pick,decider → picks tagged A,B,A,B,decider.
      assertEqual(res.picks.length, 5, `seed ${seed}: 4 picks + 1 decider`);
      assertEqual(res.picks.map((p) => p.by), ['A', 'B', 'A', 'B', 'decider'],
        `seed ${seed}: Bo5 pick ownership order`);
    }
  }
}
