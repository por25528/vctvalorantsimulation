/**
 * domain/event.js — Event factory & typedef (CONTRACTS §7).
 *
 * Phase 1 stub: `createEvent(partial)` produces a minimal, fully-formed,
 * immutable calendar Event. The full format/phase machinery lands in Phase 2
 * (see ARCHITECTURE §4, §6). Pure, no randomness, no DOM; runs unchanged in
 * Node and browser.
 *
 * @typedef Event
 * @property {string} id
 * @property {string} name
 * @property {'kickoff'|'stage'|'masters'|'champions'} type
 * @property {string|null} formatId
 * @property {string|null} leagueId
 * @property {string[]} participants   // team ids
 * @property {'pending'|'live'|'complete'} status
 * @property {object[]} standings      // final standings (filled in Phase 2)
 */

/** Domain-shape defaults for an Event. */
const DOMAIN = Object.freeze({
  DEFAULT_NAME: 'Unknown Event',
  DEFAULT_TYPE: 'kickoff',
  TYPES: Object.freeze(['kickoff', 'stage', 'masters', 'champions']),
  DEFAULT_STATUS: 'pending',
  STATUSES: Object.freeze(['pending', 'live', 'complete'])
});

/**
 * Create a fully-formed, immutable Event from a (possibly terse) partial.
 * @param {Partial<Event>} [partial]
 * @returns {Event}
 */
export function createEvent(partial = {}) {
  const e = partial && typeof partial === 'object' ? partial : {};
  const type = DOMAIN.TYPES.includes(e.type) ? e.type : DOMAIN.DEFAULT_TYPE;
  const status = DOMAIN.STATUSES.includes(e.status) ? e.status : DOMAIN.DEFAULT_STATUS;
  const name = typeof e.name === 'string' && e.name.length > 0 ? e.name : DOMAIN.DEFAULT_NAME;
  const participants = Array.isArray(e.participants)
    ? e.participants.filter((id) => typeof id === 'string' && id.length > 0).slice()
    : [];

  return {
    id: typeof e.id === 'string' && e.id.length > 0 ? e.id : `event_${type}`,
    name,
    type,
    formatId: typeof e.formatId === 'string' && e.formatId.length > 0 ? e.formatId : null,
    leagueId: typeof e.leagueId === 'string' && e.leagueId.length > 0 ? e.leagueId : null,
    participants,
    status,
    standings: Array.isArray(e.standings) ? e.standings.slice() : []
  };
}
