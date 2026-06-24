/**
 * tests/unit/config.test.mjs — validates the CONFIG layer (CONTRACTS §6, §8;
 * ARCHITECTURE §12). Verifies BALANCE has every required key with correct
 * values, the map pool is exactly 7, agents carry valid roles, and the CP
 * table matches the documented defaults.
 *
 * Default-exported async fn throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { BALANCE } from '../../src/config/balance.js';
import { MAPS, MAP_POOL } from '../../src/config/maps.js';
import { AGENTS, AGENTS_BY_ROLE, AGENT_ROLES } from '../../src/config/agents.js';
import { CP_TABLE } from '../../src/config/cpTable.js';

const VALID_ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

/** Every scalar key required on BALANCE (CONTRACTS §8). */
const REQUIRED_BALANCE_KEYS = [
  'DUEL_SCALE',
  'ROUND_SCALE',
  'DUEL_WEIGHTS',
  'ROUND_WEIGHTS',
  'IGL_TEAM_BONUS',
  'FORM_WEIGHT',
  'FATIGUE_WEIGHT',
  'MORALE_WEIGHT',
  'ECON_FACTOR',
  'PISTOL_AIM_DAMPEN',
  'CREDIT_START',
  'CREDIT_MAX',
  'WIN_REWARD',
  'LOSS_BASE',
  'LOSS_BONUS_STEP',
  'LOSS_BONUS_MAX',
  'KILL_REWARD',
  'PLANT_BONUS',
  'BUY_FULL_MIN',
  'BUY_FORCE_MIN',
  'TRADE_BASE',
  'CLUTCH_WEIGHT',
  'PLANT_BASE_CHANCE',
  'ENGAGEMENT_CAP',
  'ROUNDS_TO_WIN',
  'OT_WIN_BY',
  'ACS_KILL',
  'ACS_ASSIST',
  'ACS_PER_DUEL_BONUS'
];

export default async function configTest() {
  section('config: BALANCE');

  // every required key present
  for (const key of REQUIRED_BALANCE_KEYS) {
    assert(
      Object.prototype.hasOwnProperty.call(BALANCE, key),
      `BALANCE missing required key: ${key}`
    );
    assert(BALANCE[key] !== undefined, `BALANCE.${key} is undefined`);
  }

  // spot-check the documented default values
  assertEqual(BALANCE.DUEL_SCALE, 11, 'BALANCE.DUEL_SCALE');
  assertEqual(BALANCE.ROUND_SCALE, 80, 'BALANCE.ROUND_SCALE');
  assertEqual(BALANCE.DUEL_WEIGHTS, { aim: 0.5, reaction: 0.2, movement: 0.18, gameSense: 0.12 }, 'BALANCE.DUEL_WEIGHTS');
  assertEqual(BALANCE.ROUND_WEIGHTS, { duel: 0.7, utility: 0.18, trading: 0.12 }, 'BALANCE.ROUND_WEIGHTS');
  assertEqual(BALANCE.ECON_FACTOR, { full: 1.0, force: 0.92, eco: 0.8, pistol: 0.95 }, 'BALANCE.ECON_FACTOR');
  assertEqual(BALANCE.CREDIT_START, 800, 'BALANCE.CREDIT_START');
  assertEqual(BALANCE.ROUNDS_TO_WIN, 13, 'BALANCE.ROUNDS_TO_WIN');
  assertEqual(BALANCE.OT_WIN_BY, 2, 'BALANCE.OT_WIN_BY');
  assertEqual(BALANCE.ACS_KILL, 150, 'BALANCE.ACS_KILL');

  // BALANCE must be frozen (immutable single source of truth)
  assert(Object.isFrozen(BALANCE), 'BALANCE must be frozen');
  assert(Object.isFrozen(BALANCE.DUEL_WEIGHTS), 'BALANCE.DUEL_WEIGHTS must be frozen');

  section('config: MAPS');

  // exactly 7 active-pool maps
  assertEqual(MAP_POOL.length, 7, 'MAP_POOL must contain exactly 7 ids');

  // MAP_POOL ids all resolve to in-pool maps
  for (const id of MAP_POOL) {
    const map = MAPS.find((m) => m.id === id);
    assert(map, `MAP_POOL id ${id} not found in MAPS`);
    assert(map.inPool === true, `MAP_POOL id ${id} must be inPool`);
  }

  // exactly 7 maps flagged inPool, and there are out-of-pool maps too
  const inPool = MAPS.filter((m) => m.inPool);
  assertEqual(inPool.length, 7, 'exactly 7 MAPS must be inPool');
  assert(MAPS.some((m) => m.inPool === false), 'MAPS must include out-of-pool maps');

  // shape: id, name, atkBias (default 0.5), inPool
  for (const m of MAPS) {
    assert(typeof m.id === 'string' && m.id.length > 0, `map id invalid: ${m.id}`);
    assert(typeof m.name === 'string' && m.name.length > 0, `map name invalid for ${m.id}`);
    assert(typeof m.atkBias === 'number', `map atkBias not a number for ${m.id}`);
    assertEqual(m.atkBias, 0.5, `map ${m.id} atkBias should default to 0.5`);
    assert(typeof m.inPool === 'boolean', `map inPool not a boolean for ${m.id}`);
  }

  // ids unique
  const mapIds = new Set(MAPS.map((m) => m.id));
  assertEqual(mapIds.size, MAPS.length, 'map ids must be unique');

  section('config: AGENTS');

  assert(Array.isArray(AGENTS) && AGENTS.length > 0, 'AGENTS must be a non-empty array');

  // every agent has a valid role and a well-formed shape
  for (const a of AGENTS) {
    assert(typeof a.id === 'string' && a.id.length > 0, `agent id invalid: ${a.id}`);
    assert(typeof a.name === 'string' && a.name.length > 0, `agent name invalid for ${a.id}`);
    assert(VALID_ROLES.includes(a.role), `agent ${a.id} has invalid role: ${a.role}`);
  }

  // agent ids unique
  const agentIds = new Set(AGENTS.map((a) => a.id));
  assertEqual(agentIds.size, AGENTS.length, 'agent ids must be unique');

  // AGENTS_BY_ROLE covers every role and partitions AGENTS exactly
  assertEqual([...AGENT_ROLES].sort(), [...VALID_ROLES].sort(), 'AGENT_ROLES set');
  let grouped = 0;
  for (const role of VALID_ROLES) {
    assert(Array.isArray(AGENTS_BY_ROLE[role]), `AGENTS_BY_ROLE missing role: ${role}`);
    assert(AGENTS_BY_ROLE[role].length > 0, `AGENTS_BY_ROLE.${role} is empty`);
    for (const a of AGENTS_BY_ROLE[role]) {
      assertEqual(a.role, role, `agent ${a.id} grouped under wrong role`);
    }
    grouped += AGENTS_BY_ROLE[role].length;
  }
  assertEqual(grouped, AGENTS.length, 'AGENTS_BY_ROLE must partition all AGENTS');

  section('config: CP_TABLE');

  // Kickoff 4/3/2/1
  assertEqual(CP_TABLE.kickoff[1], 4, 'kickoff 1st = 4');
  assertEqual(CP_TABLE.kickoff[2], 3, 'kickoff 2nd = 3');
  assertEqual(CP_TABLE.kickoff[3], 2, 'kickoff 3rd = 2');
  assertEqual(CP_TABLE.kickoff[4], 1, 'kickoff 4th = 1');

  // Stage 1st = 5 descending
  assertEqual(CP_TABLE.stage[1], 5, 'stage 1st = 5');
  assertEqual(CP_TABLE.stage[5], 1, 'stage 5th = 1');

  // Masters champion = 8 descending
  assertEqual(CP_TABLE.masters[1], 8, 'masters champion = 8');
  assertEqual(CP_TABLE.masters[8], 1, 'masters 8th = 1');

  // Champions = finale, no CP
  assertEqual(Object.keys(CP_TABLE.champions).length, 0, 'champions awards no CP');
}
