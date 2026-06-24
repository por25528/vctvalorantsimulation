/**
 * config/agents.js — editable agent reference data (the current Valorant roster).
 * Exports AGENTS (array of { id, name, role }) and AGENTS_BY_ROLE (grouped).
 * Roles are one of 'Duelist' | 'Initiator' | 'Controller' | 'Sentinel'
 * (CONTRACTS §6 Agent typedef).
 *
 * @typedef {'Duelist'|'Initiator'|'Controller'|'Sentinel'} AgentRole
 * @typedef {object} Agent
 * @property {string} id
 * @property {string} name
 * @property {AgentRole} role
 */

/** @type {ReadonlyArray<Agent>} */
export const AGENTS = Object.freeze([
  // --- Duelists ---
  Object.freeze({ id: 'jett', name: 'Jett', role: 'Duelist' }),
  Object.freeze({ id: 'raze', name: 'Raze', role: 'Duelist' }),
  Object.freeze({ id: 'reyna', name: 'Reyna', role: 'Duelist' }),
  Object.freeze({ id: 'phoenix', name: 'Phoenix', role: 'Duelist' }),
  Object.freeze({ id: 'yoru', name: 'Yoru', role: 'Duelist' }),
  Object.freeze({ id: 'neon', name: 'Neon', role: 'Duelist' }),
  Object.freeze({ id: 'iso', name: 'Iso', role: 'Duelist' }),
  Object.freeze({ id: 'waylay', name: 'Waylay', role: 'Duelist' }),
  // --- Initiators ---
  Object.freeze({ id: 'sova', name: 'Sova', role: 'Initiator' }),
  Object.freeze({ id: 'breach', name: 'Breach', role: 'Initiator' }),
  Object.freeze({ id: 'skye', name: 'Skye', role: 'Initiator' }),
  Object.freeze({ id: 'kayo', name: 'KAY/O', role: 'Initiator' }),
  Object.freeze({ id: 'fade', name: 'Fade', role: 'Initiator' }),
  Object.freeze({ id: 'gekko', name: 'Gekko', role: 'Initiator' }),
  Object.freeze({ id: 'tejo', name: 'Tejo', role: 'Initiator' }),
  // --- Controllers ---
  Object.freeze({ id: 'brimstone', name: 'Brimstone', role: 'Controller' }),
  Object.freeze({ id: 'omen', name: 'Omen', role: 'Controller' }),
  Object.freeze({ id: 'viper', name: 'Viper', role: 'Controller' }),
  Object.freeze({ id: 'astra', name: 'Astra', role: 'Controller' }),
  Object.freeze({ id: 'harbor', name: 'Harbor', role: 'Controller' }),
  Object.freeze({ id: 'clove', name: 'Clove', role: 'Controller' }),
  // --- Sentinels ---
  Object.freeze({ id: 'killjoy', name: 'Killjoy', role: 'Sentinel' }),
  Object.freeze({ id: 'cypher', name: 'Cypher', role: 'Sentinel' }),
  Object.freeze({ id: 'sage', name: 'Sage', role: 'Sentinel' }),
  Object.freeze({ id: 'chamber', name: 'Chamber', role: 'Sentinel' }),
  Object.freeze({ id: 'deadlock', name: 'Deadlock', role: 'Sentinel' }),
  Object.freeze({ id: 'vyse', name: 'Vyse', role: 'Sentinel' })
]);

/**
 * The four valid agent roles.
 * @type {ReadonlyArray<AgentRole>}
 */
export const AGENT_ROLES = Object.freeze(['Duelist', 'Initiator', 'Controller', 'Sentinel']);

/**
 * AGENTS grouped by role. Derived from AGENTS so the two never drift.
 * @type {Readonly<Record<AgentRole, ReadonlyArray<Agent>>>}
 */
export const AGENTS_BY_ROLE = Object.freeze(
  AGENT_ROLES.reduce((acc, role) => {
    acc[role] = Object.freeze(AGENTS.filter((a) => a.role === role));
    return acc;
  }, /** @type {Record<AgentRole, ReadonlyArray<Agent>>} */ ({}))
);
