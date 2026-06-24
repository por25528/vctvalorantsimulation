/**
 * state/middleware/persistence.js — debounced autosave to IndexedDB after
 * state-changing actions.
 * Phase 5 (Persistence).
 */

/**
 * Create the persistence middleware.
 * @param {object} deps { saveManager }
 * @returns {(store:object) => (next:Function) => (action:object) => *}
 */
export function createPersistenceMiddleware(deps) {
  throw new Error('not implemented: state/middleware/persistence.js');
}
