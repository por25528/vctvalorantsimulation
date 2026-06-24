/**
 * domain/league.js — League factory & typedef (CONTRACTS §7).
 *
 * `createLeague(partial)` returns a fully-formed, immutable League with sane
 * defaults. Pure, no randomness, no DOM; runs unchanged in Node and browser.
 */

/**
 * @typedef League
 * @property {string} id
 * @property {string} name
 * @property {string} region   // 'pacific'|'americas'|'emea'|'china' (free-form fallback)
 * @property {string[]} teamIds
 */

/** Domain-shape defaults for a League. */
const DOMAIN = Object.freeze({
  DEFAULT_NAME: 'Unknown League',
  DEFAULT_REGION: 'pacific'
});

/**
 * Create a fully-formed, immutable League from a (possibly terse) partial.
 * @param {Partial<League>} [partial]
 * @returns {League}
 */
export function createLeague(partial = {}) {
  const l = partial && typeof partial === 'object' ? partial : {};
  const region = typeof l.region === 'string' && l.region.length > 0 ? l.region : DOMAIN.DEFAULT_REGION;
  const name = typeof l.name === 'string' && l.name.length > 0 ? l.name : DOMAIN.DEFAULT_NAME;
  const teamIds = Array.isArray(l.teamIds) ? l.teamIds.filter((id) => typeof id === 'string' && id.length > 0).slice() : [];

  return {
    id: typeof l.id === 'string' && l.id.length > 0 ? l.id : `league_${region}`,
    name,
    region,
    teamIds
  };
}
