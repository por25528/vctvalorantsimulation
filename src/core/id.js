/**
 * core/id.js — deterministic id builders (CONTRACTS §3).
 * Responsibility: stable string ids with no randomness; same inputs -> same id.
 * Pure & dependency-free; runs unchanged in Node and the browser.
 */

/**
 * Series id from event/phase/slot.
 * @param {string} eventId
 * @param {string} phaseId
 * @param {number|string} slot
 * @returns {string} `${eventId}:${phaseId}:s${slot}`
 */
export function seriesId(eventId, phaseId, slot) {
  return `${eventId}:${phaseId}:s${slot}`;
}

/**
 * Map id from a series id and game number.
 * @param {string} seriesId
 * @param {number|string} gameNo
 * @returns {string} `${seriesId}:m${gameNo}`
 */
export function mapId(seriesId, gameNo) {
  return `${seriesId}:m${gameNo}`;
}

/**
 * Generic prefixed id from parts.
 * @param {string} prefix
 * @param {...(string|number)} parts
 * @returns {string} `${prefix}_${parts.join('-')}`
 */
export function makeId(prefix, ...parts) {
  return `${prefix}_${parts.join('-')}`;
}
