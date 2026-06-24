/**
 * tests/unit/composition.test.mjs — unit tests for engine/match/composition.js
 * (CONTRACTS §10, §14).
 *
 * Verifies selectComp:
 *   - returns exactly 5 distinct agentIds,
 *   - always includes at least one Controller,
 *   - is deterministic for a fixed seed (and varies across seeds),
 *   - weights picks by agent/map proficiency (a one-trick is favored),
 *   - tolerates terse players and a fresh rng each call.
 *
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createRng } from '../../src/core/rng.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { AGENTS, AGENTS_BY_ROLE } from '../../src/config/agents.js';
import { selectComp } from '../../src/engine/match/composition.js';

/** agentId -> role lookup for asserting role validity. */
const ROLE_OF = AGENTS.reduce((acc, a) => {
  acc[a.id] = a.role;
  return acc;
}, /** @type {Record<string,string>} */ ({}));

/**
 * Build a 5-player team + players lookup with the standard role spread.
 * @returns {{ team:any, players:Record<string,any> }}
 */
function makeTeam() {
  const roles = ['Duelist', 'Initiator', 'Controller', 'Sentinel', 'Initiator'];
  /** @type {Record<string,any>} */
  const players = {};
  const ids = [];
  roles.forEach((role, i) => {
    const p = createPlayer({ id: `p${i}`, name: `P${i}`, role });
    players[p.id] = p;
    ids.push(p.id);
  });
  const team = createTeam({ name: 'Test', tag: 'TST', roster: ids });
  return { team, players };
}

/** @returns {Promise<void>} */
export default async function run() {
  section('composition.selectComp — 5 distinct agents, >=1 Controller');
  {
    const { team, players } = makeTeam();
    // Run across many seeds: every comp must satisfy the structural invariants.
    for (let seed = 0; seed < 200; seed++) {
      const comp = selectComp(team, players, 'ascent', createRng(seed));

      assert(Array.isArray(comp), `seed ${seed}: comp is an array`);
      assertEqual(comp.length, 5, `seed ${seed}: exactly 5 agents`);
      assertEqual(new Set(comp).size, 5, `seed ${seed}: agents are distinct`);

      for (const id of comp) {
        assert(id in ROLE_OF, `seed ${seed}: ${id} is a real agent id`);
      }

      const controllers = comp.filter((id) => ROLE_OF[id] === 'Controller');
      assert(controllers.length >= 1, `seed ${seed}: at least one Controller`);

      // Sensible spread: at least 3 of the 4 roles represented (no mono-role comp).
      const roles = new Set(comp.map((id) => ROLE_OF[id]));
      assert(roles.size >= 3, `seed ${seed}: covers >=3 distinct roles`);
    }
  }

  section('composition.selectComp — deterministic for a fixed seed');
  {
    const { team, players } = makeTeam();
    const a = selectComp(team, players, 'haven', createRng(12345));
    const b = selectComp(team, players, 'haven', createRng(12345));
    assertEqual(a, b, 'same seed -> identical comp');

    // A fresh array each call (immutability of engine output).
    assert(a !== b, 'distinct array instances');

    // Different seeds should generally differ (not strictly required, but the
    // selection must actually consume rng). Find at least one differing seed.
    let sawDifferent = false;
    for (let s = 1; s < 50 && !sawDifferent; s++) {
      const c = selectComp(team, players, 'haven', createRng(s));
      if (JSON.stringify(c) !== JSON.stringify(a)) sawDifferent = true;
    }
    assert(sawDifferent, 'different seeds can produce different comps');
  }

  section('composition.selectComp — agent proficiency is honored');
  {
    // A player who one-tricks a specific controller (Viper) should pull that
    // agent into the comp far more often than chance across seeds.
    const ids = ['m0', 'm1', 'm2', 'm3', 'm4'];
    /** @type {Record<string,any>} */
    const players = {
      m0: createPlayer({ id: 'm0', name: 'Duel', role: 'Duelist' }),
      m1: createPlayer({ id: 'm1', name: 'Init', role: 'Initiator' }),
      m2: createPlayer({
        id: 'm2',
        name: 'Smoke',
        role: 'Controller',
        proficiency: { agents: { viper: 99 } }
      }),
      m3: createPlayer({ id: 'm3', name: 'Sent', role: 'Sentinel' }),
      m4: createPlayer({ id: 'm4', name: 'Flex', role: 'Initiator' })
    };
    const team = createTeam({ name: 'Prof', tag: 'PRF', roster: ids });

    // Compare against an identical team WITHOUT the one-trick: the proficiency
    // signal must lift viper's pick rate clearly above its baseline rate. This
    // is robust to the exact weighting curve (we assert a relative lift, not an
    // absolute majority — a soft blend is intended, not a hard override).
    /** @type {Record<string,any>} */
    const baseline = { ...players, m2: createPlayer({ id: 'm2', name: 'Smoke', role: 'Controller' }) };
    const baseTeam = createTeam({ name: 'Base', tag: 'BSE', roster: ids });

    let viperCount = 0;
    let baseViper = 0;
    const N = 500;
    for (let s = 0; s < N; s++) {
      if (selectComp(team, players, 'ascent', createRng(s)).includes('viper')) viperCount++;
      if (selectComp(baseTeam, baseline, 'ascent', createRng(s)).includes('viper')) baseViper++;
    }
    const controllerPool = AGENTS_BY_ROLE.Controller.length;
    // Sanity: baseline picks viper roughly uniformly (within a wide band).
    assert(
      baseViper > 0 && baseViper < N * 0.5,
      `baseline viper rate sane: ${baseViper}/${N} (uniform ~${Math.round(N / controllerPool)})`
    );
    // The one-trick must be picked meaningfully more often than baseline.
    assert(
      viperCount > baseViper * 1.3,
      `viper one-trick favored: ${viperCount}/${N} vs baseline ${baseViper}/${N}`
    );
  }

  section('composition.selectComp — terse / sparse inputs do not throw');
  {
    // Roster ids missing from the players lookup, terse players, empty map prof.
    const team = createTeam({ name: 'Sparse', tag: 'SPR', roster: ['x0', 'x1', 'ghost'] });
    const players = {
      x0: createPlayer({ name: 'a', role: 'Controller' }),
      x1: createPlayer({ name: 'b', role: 'Duelist' })
    };
    // re-key by actual generated ids
    const lookup = {};
    for (const p of Object.values(players)) lookup[p.id] = p;
    const teamFixed = createTeam({ name: 'Sparse', tag: 'SPR', roster: Object.keys(lookup) });

    const comp = selectComp(teamFixed, lookup, 'unknown_map', createRng(7));
    assertEqual(comp.length, 5, 'still produces 5 agents with a 2-player lineup');
    assertEqual(new Set(comp).size, 5, 'agents distinct with sparse lineup');
    assert(comp.some((id) => ROLE_OF[id] === 'Controller'), 'controller present with sparse lineup');

    // Empty team falls back to whole-pool fill, still valid.
    const emptyComp = selectComp({ roster: [] }, {}, 'ascent', createRng(3));
    assertEqual(emptyComp.length, 5, 'empty lineup still yields 5 agents');
    assert(emptyComp.some((id) => ROLE_OF[id] === 'Controller'), 'controller present with empty lineup');
  }
}
