/**
 * engine/match/composition.js — agent composition selection (CONTRACTS §10).
 *
 * `selectComp(team, players, mapId, rng)` picks 5 distinct agentIds forming a
 * role-valid comp for a team's active lineup:
 *   - at least 1 Controller, and a sensible spread across the four roles,
 *   - picks weighted by each player's agent proficiency and map proficiency
 *     where available, else by role fit (role proficiency),
 *   - deterministic given the injected `rng` (no Math.random / Date.now / DOM).
 *
 * Pure & dependency-free apart from the agent reference data; runs unchanged in
 * Node and browser (plain ES modules). The returned Comp is a fresh array.
 *
 * The *shape* of a valid comp (how many of each role, the role fill order) is a
 * composition-domain concern, centralized in COMP below rather than scattered as
 * inline literals; engine *tuning* numbers live in config/balance.js.
 *
 * @typedef {import('../../config/agents.js').Agent} Agent
 * @typedef {import('../../config/agents.js').AgentRole} AgentRole
 * @typedef {import('../../domain/player.js').Player} Player
 * @typedef {import('../../core/rng.js').Rng} Rng
 * @typedef {string[]} Comp   // exactly 5 agentIds
 */

import { AGENTS_BY_ROLE } from '../../config/agents.js';

/** Composition-domain constants (single source of comp-shape defaults). */
const COMP = Object.freeze({
  COMP_SIZE: 5,

  // The four required role slots, filled in this fixed order. Guarantees at
  // least one Controller and a balanced one-of-each-role base; the 5th slot is
  // a flex pick (see FLEX_ROLE_WEIGHTS) layered on top.
  REQUIRED_ROLES: Object.freeze(['Controller', 'Initiator', 'Sentinel', 'Duelist']),

  // Relative weight for which role the flexible 5th slot leans toward. Duelists
  // and initiators are the usual "double" picks in modern comps; controllers and
  // sentinels rarely doubled. Weights are consumed via rng.weightedPick so the
  // flex role is deterministic for a fixed seed.
  FLEX_ROLE_WEIGHTS: Object.freeze({ Duelist: 0.4, Initiator: 0.35, Sentinel: 0.15, Controller: 0.1 }),

  // Baseline used when a proficiency entry is absent (mirrors the domain layer's
  // PROFICIENCY_BASELINE: a missing key means "average familiarity").
  PROFICIENCY_BASELINE: 50,

  // Relative blend of the signals feeding an agent's pick weight. Agent
  // proficiency dominates where present, then map proficiency; role fit is the
  // always-available floor.
  SIGNAL_WEIGHTS: Object.freeze({ agent: 1.0, map: 0.45, role: 0.3 }),

  // Sharpness applied to the blended affinity before it becomes a pick weight.
  // >1 makes a strong specialist (e.g. a one-trick on a map) clearly favored
  // over a baseline-familiarity pick, instead of all candidates being near-flat.
  WEIGHT_EXPONENT: 2.4,

  // Floor added to every candidate weight so an unfamiliar-but-valid agent still
  // has a non-zero chance, keeping rng.weightedPick well-defined.
  WEIGHT_FLOOR: 1
});

/**
 * Read a proficiency value from a player's map, treating absence as baseline.
 * @param {Record<string, number>|undefined} map
 * @param {string} key
 * @returns {number}
 */
function prof(map, key) {
  if (map && typeof map === 'object' && typeof map[key] === 'number' && Number.isFinite(map[key])) {
    return map[key];
  }
  return COMP.PROFICIENCY_BASELINE;
}

/**
 * Resolve a team's active 5-player lineup (first 5 valid roster ids) into Player
 * objects from the `players` lookup. Falls back gracefully if the lookup is
 * sparse so selection never throws.
 * @param {{ roster?: string[] }} team
 * @param {Record<string, Player>} players
 * @returns {Player[]}
 */
function lineupOf(team, players) {
  const roster = team && Array.isArray(team.roster) ? team.roster : [];
  /** @type {Player[]} */
  const lineup = [];
  for (const id of roster) {
    const p = players && players[id];
    if (p && typeof p === 'object') lineup.push(p);
    if (lineup.length >= COMP.COMP_SIZE) break;
  }
  return lineup;
}

/**
 * Affinity of one player for one role/map, blending agent, map and role
 * proficiency signals. Higher = better fit. The `agentId` term lets the same
 * function score a specific agent for a player (used when picking the agent).
 * @param {Player} player
 * @param {AgentRole} role
 * @param {string} mapId
 * @param {string} agentId
 * @returns {number}
 */
function affinity(player, role, mapId, agentId) {
  const pr = player && player.proficiency ? player.proficiency : {};
  const agentProf = prof(pr.agents, agentId);
  const mapProf = prof(pr.maps, mapId);
  const roleProf = prof(pr.roles, role);
  // Normalize the blended signal to ~[0,1] (proficiencies are 0..100), then
  // sharpen it so specialists clearly outweigh baseline picks, and add a floor.
  const blend =
    (COMP.SIGNAL_WEIGHTS.agent * agentProf +
      COMP.SIGNAL_WEIGHTS.map * mapProf +
      COMP.SIGNAL_WEIGHTS.role * roleProf) /
    (100 *
      (COMP.SIGNAL_WEIGHTS.agent + COMP.SIGNAL_WEIGHTS.map + COMP.SIGNAL_WEIGHTS.role));
  return Math.pow(blend, COMP.WEIGHT_EXPONENT) * 100 + COMP.WEIGHT_FLOOR;
}

/**
 * Decide the role layout for the 5 slots: one of each REQUIRED_ROLE plus a flex
 * role chosen by FLEX_ROLE_WEIGHTS. Deterministic via rng.
 * @param {Rng} rng
 * @returns {AgentRole[]} length-5 array of roles (order is fill order)
 */
function rollRoleLayout(rng) {
  const flexRoles = /** @type {AgentRole[]} */ (Object.keys(COMP.FLEX_ROLE_WEIGHTS));
  const flex = rng.weightedPick(flexRoles, (r) => COMP.FLEX_ROLE_WEIGHTS[r]);
  return [...COMP.REQUIRED_ROLES, flex];
}

/**
 * Pick the agent for a role slot: choose the lineup player who best anchors the
 * role (weighted by their role/map affinity), then choose one of that role's
 * agents (weighted by that player's agent/map proficiency). Both picks are
 * deterministic via rng. Already-used agents and already-assigned players are
 * excluded so the comp has 5 distinct agents on 5 distinct players.
 *
 * @param {AgentRole} role
 * @param {Player[]} lineup
 * @param {string} mapId
 * @param {Set<string>} usedAgents
 * @param {Set<string>} usedPlayers
 * @param {Rng} rng
 * @returns {string|null} agentId, or null if no agent of this role is available
 */
function pickForRole(role, lineup, mapId, usedAgents, usedPlayers, rng) {
  const rolePool = (AGENTS_BY_ROLE[role] || []).filter((a) => !usedAgents.has(a.id));
  if (rolePool.length === 0) return null;

  // Choose which (still-unassigned) player anchors this role. If every player is
  // already assigned (flex slot), fall back to the whole lineup.
  const free = lineup.filter((p) => !usedPlayers.has(p.id));
  const candidates = free.length > 0 ? free : lineup;

  let anchor = null;
  if (candidates.length > 0) {
    anchor = rng.weightedPick(candidates, (p) => {
      // Score the player's best agent in this role so a one-trick is favored.
      let best = 0;
      for (const a of rolePool) {
        const aff = affinity(p, role, mapId, a.id);
        if (aff > best) best = aff;
      }
      return best;
    });
  }

  // Choose the agent within the role, weighted by the anchor's affinity for it.
  const agent = rng.weightedPick(rolePool, (a) =>
    anchor ? affinity(anchor, role, mapId, a.id) : COMP.WEIGHT_FLOOR
  );

  if (anchor) usedPlayers.add(anchor.id);
  usedAgents.add(agent.id);
  return agent.id;
}

/**
 * Select a role-valid, proficiency-weighted 5-agent composition for a team.
 *
 * Guarantees:
 *   - exactly 5 distinct agentIds,
 *   - at least 1 Controller (Controller is a REQUIRED_ROLE slot),
 *   - a sensible role spread (one of each role + a weighted flex),
 *   - deterministic for a fixed `rng` seed.
 *
 * @param {{ roster?: string[] }} team    Team whose first 5 roster ids are the lineup.
 * @param {Record<string, Player>} players  playerId -> Player lookup.
 * @param {string} mapId                   Map being played (for map proficiency).
 * @param {Rng} rng                        Injected deterministic PRNG.
 * @returns {Comp} fresh array of 5 distinct agentIds.
 */
export function selectComp(team, players, mapId, rng) {
  const lineup = lineupOf(team, players);
  const layout = rollRoleLayout(rng);

  /** @type {Set<string>} */
  const usedAgents = new Set();
  /** @type {Set<string>} */
  const usedPlayers = new Set();
  /** @type {string[]} */
  const comp = [];

  for (const role of layout) {
    const id = pickForRole(role, lineup, mapId, usedAgents, usedPlayers, rng);
    if (id) comp.push(id);
  }

  // Backfill if any role pool was exhausted (defensive; should not happen with
  // the standard roster) — top up with any unused agent across all roles so the
  // comp is always exactly COMP_SIZE distinct agents.
  if (comp.length < COMP.COMP_SIZE) {
    const fallbackRoles = /** @type {AgentRole[]} */ (Object.keys(AGENTS_BY_ROLE));
    for (const role of fallbackRoles) {
      if (comp.length >= COMP.COMP_SIZE) break;
      const id = pickForRole(role, lineup, mapId, usedAgents, usedPlayers, rng);
      if (id) comp.push(id);
    }
  }

  return comp;
}
