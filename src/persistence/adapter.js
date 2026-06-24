/**
 * persistence/adapter.js — the StorageAdapter abstraction (CONTRACTS-PERSIST §1).
 *
 * A StorageAdapter is an async key/value store over a small set of NAMED stores
 * (this layer uses 'saves' and 'meta'). Every method returns a Promise so the
 * in-memory adapter and the IndexedDB adapter (db.js) are drop-in
 * interchangeable — the save manager is written once against this shape and runs
 * headlessly in Node via createMemoryAdapter().
 *
 *   get(store, key)    -> Promise<value|null>
 *   put(store, key, v) -> Promise<void>
 *   delete(store, key) -> Promise<void>
 *   list(store)        -> Promise<Array<{ key, value }>>
 *
 * createMemoryAdapter() is Map-backed (a Map per store, lazily created) and
 * Promise-wrapped. It is pure with respect to module state — each call returns an
 * independent, isolated adapter (no shared globals), so tests never leak state
 * between cases.
 *
 * Stored values are deep-cloned on the way in and on the way out, so callers can
 * never mutate what the store holds (and the store never hands back a live
 * reference into a frozen engine output). This mirrors the structured-clone
 * boundary a real IndexedDB adapter imposes, keeping behavior consistent across
 * adapters.
 *
 * Named exports only. No DOM, no Date.now — pure storage mechanics.
 *
 * @typedef {Object} StorageAdapter
 * @property {(store:string, key:string)=>Promise<*>} get
 * @property {(store:string, key:string, value:*)=>Promise<void>} put
 * @property {(store:string, key:string)=>Promise<void>} delete
 * @property {(store:string)=>Promise<Array<{key:string, value:*}>>} list
 */

/**
 * Deep-clone a JSON-serializable value so the store and its callers never share
 * a live reference. structuredClone is used when available (Node 17+, browsers);
 * otherwise a JSON round-trip is the fallback (save payloads are JSON-safe).
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Create a fresh in-memory StorageAdapter (Map-backed, Promise-wrapped).
 * Each store is an independent Map keyed by string. Suitable for Node + tests
 * and as getDefaultAdapter()'s fallback when IndexedDB is unavailable.
 *
 * @returns {StorageAdapter}
 */
export function createMemoryAdapter() {
  /** @type {Map<string, Map<string, *>>} store name -> (key -> value) */
  const stores = new Map();

  /**
   * Lazily get (creating if needed) the Map backing a named store.
   * @param {string} store
   * @returns {Map<string, *>}
   */
  function storeMap(store) {
    if (typeof store !== 'string' || store.length === 0) {
      throw new Error('StorageAdapter: store name must be a non-empty string');
    }
    let m = stores.get(store);
    if (!m) {
      m = new Map();
      stores.set(store, m);
    }
    return m;
  }

  return Object.freeze({
    /**
     * @param {string} store
     * @param {string} key
     * @returns {Promise<*>} the stored value (cloned), or null if absent
     */
    get(store, key) {
      const m = storeMap(store);
      return Promise.resolve(m.has(key) ? clone(m.get(key)) : null);
    },

    /**
     * @param {string} store
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    put(store, key, value) {
      if (typeof key !== 'string' || key.length === 0) {
        return Promise.reject(new Error('StorageAdapter.put: key must be a non-empty string'));
      }
      storeMap(store).set(key, clone(value));
      return Promise.resolve();
    },

    /**
     * @param {string} store
     * @param {string} key
     * @returns {Promise<void>}
     */
    delete(store, key) {
      storeMap(store).delete(key);
      return Promise.resolve();
    },

    /**
     * @param {string} store
     * @returns {Promise<Array<{key:string, value:*}>>} all entries (values cloned)
     */
    list(store) {
      const m = storeMap(store);
      /** @type {Array<{key:string, value:*}>} */
      const out = [];
      for (const [key, value] of m) out.push({ key, value: clone(value) });
      return Promise.resolve(out);
    }
  });
}
