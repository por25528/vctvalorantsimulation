/**
 * persistence/db.js — the IndexedDB-backed StorageAdapter (CONTRACTS-PERSIST §1).
 *
 * createIndexedDBAdapter(dbName) opens (and, on first use, creates) an IndexedDB
 * database with two object stores — 'saves' (full SaveGame payloads, logs and
 * all; IndexedDB happily holds tens of MB) and 'meta' (the slot index). It
 * exposes the SAME async StorageAdapter shape as createMemoryAdapter, so the save
 * manager is adapter-agnostic.
 *
 * getDefaultAdapter() returns the IndexedDB adapter when a global `indexedDB`
 * exists (the browser) and otherwise a MemoryAdapter — so importing this module
 * (or the save manager) in Node NEVER crashes; persistence simply runs in-memory.
 *
 * Browser-only APIs are touched lazily, inside the returned methods, and the db
 * handle is opened on first use — merely importing this file in Node touches no
 * IndexedDB global. Named exports only. Date.now is not used here.
 *
 * @typedef {import('./adapter.js').StorageAdapter} StorageAdapter
 */

import { createMemoryAdapter } from './adapter.js';

/** The two object stores this layer uses. */
const STORE_NAMES = Object.freeze(['saves', 'meta']);

/**
 * Resolve the ambient indexedDB factory if one exists (window/worker global),
 * else null. Kept as a function so Node import never dereferences a missing
 * global.
 *
 * @returns {IDBFactory|null}
 */
function getIndexedDB() {
  if (typeof indexedDB !== 'undefined' && indexedDB) return indexedDB;
  if (typeof globalThis !== 'undefined' && globalThis.indexedDB) return globalThis.indexedDB;
  return null;
}

/**
 * Promisify an IDBRequest.
 * @param {IDBRequest} req
 * @returns {Promise<*>}
 */
function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Create an IndexedDB-backed StorageAdapter.
 *
 * @param {string} [dbName='vct2026']
 * @returns {StorageAdapter}
 */
export function createIndexedDBAdapter(dbName = 'vct2026') {
  /** @type {Promise<IDBDatabase>|null} memoized open handle */
  let dbPromise = null;

  /**
   * Open (creating the object stores on first run) and memoize the database.
   * @returns {Promise<IDBDatabase>}
   */
  function open() {
    if (dbPromise) return dbPromise;
    const idb = getIndexedDB();
    if (!idb) {
      return Promise.reject(new Error('createIndexedDBAdapter: no indexedDB in this environment'));
    }
    dbPromise = new Promise((resolve, reject) => {
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORE_NAMES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  /**
   * Run a transaction over one store and resolve via the provided op.
   * @param {string} store
   * @param {IDBTransactionMode} mode
   * @param {(objectStore:IDBObjectStore)=>(IDBRequest|null)} op
   * @returns {Promise<*>}
   */
  async function withStore(store, mode, op) {
    if (!STORE_NAMES.includes(store)) {
      throw new Error(`IndexedDBAdapter: unknown store '${store}'`);
    }
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      const req = op(os);
      if (req) {
        req.onsuccess = () => {
          result = req.result;
        };
        req.onerror = () => reject(req.error);
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return Object.freeze({
    /**
     * @param {string} store
     * @param {string} key
     * @returns {Promise<*>} value or null
     */
    async get(store, key) {
      const v = await withStore(store, 'readonly', (os) => os.get(key));
      return v === undefined ? null : v;
    },

    /**
     * @param {string} store
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    async put(store, key, value) {
      await withStore(store, 'readwrite', (os) => os.put(value, key));
    },

    /**
     * @param {string} store
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(store, key) {
      await withStore(store, 'readwrite', (os) => os.delete(key));
    },

    /**
     * @param {string} store
     * @returns {Promise<Array<{key:string, value:*}>>}
     */
    async list(store) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const os = tx.objectStore(store);
        /** @type {Array<{key:string, value:*}>} */
        const out = [];
        const cursorReq = os.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            out.push({ key: String(cursor.key), value: cursor.value });
            cursor.continue();
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
  });
}

/**
 * Return the best available StorageAdapter for the current environment:
 * IndexedDB in the browser, MemoryAdapter in Node (so imports never crash).
 *
 * @param {string} [dbName='vct2026']
 * @returns {StorageAdapter}
 */
export function getDefaultAdapter(dbName = 'vct2026') {
  if (getIndexedDB()) return createIndexedDBAdapter(dbName);
  return createMemoryAdapter();
}
