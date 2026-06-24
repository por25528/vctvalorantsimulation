/**
 * persistence/saveManager.js — named save slots over a StorageAdapter
 * (CONTRACTS-PERSIST §3).
 *
 * createSaveManager(adapter) returns an async API:
 *   listSlots()                -> Promise<SaveMeta[]>   (sorted lastPlayed desc)
 *   saveSlot(saveGame)         -> Promise<SaveMeta>     (full SaveGame -> 'saves', meta -> 'meta')
 *   loadSlot(id)               -> Promise<SaveGame|null>(read + migrate)
 *   deleteSlot(id)             -> Promise<void>         (drops both stores' entries)
 *   duplicateSlot(id, newName) -> Promise<SaveMeta>     (deep copy under a fresh id/meta)
 *   autosave(saveGame)         -> Promise<SaveMeta>     (debounced write to a reserved slot id)
 *
 * The 'saves' store holds the full SaveGame payload (keyed by meta.id, logs and
 * all). The 'meta' store mirrors each save's SaveMeta (also keyed by id) so
 * listSlots can build the slot index without loading every full payload; it is
 * sorted by lastPlayed descending (most-recently-played first).
 *
 * Autosave writes to the RESERVED id `AUTOSAVE_ID`, debounced: rapid autosave
 * calls coalesce (a trailing write after AUTOSAVE_DEBOUNCE_MS of quiet), so a
 * Continue-spamming UI doesn't thrash storage. The returned promise resolves with
 * the meta once the (possibly coalesced) write lands.
 *
 * adapter defaults to getDefaultAdapter() (IndexedDB in browser, Memory in Node).
 * All methods are async because IndexedDB is. Date.now is used (permitted in this
 * layer) to stamp lastPlayed on save. Named exports only.
 *
 * @typedef {import('./adapter.js').StorageAdapter} StorageAdapter
 * @typedef {import('./migrations.js').SaveGame} SaveGame
 * @typedef {import('./migrations.js').SaveMeta} SaveMeta
 */

import { getDefaultAdapter } from './db.js';
import { migrate, newSaveMeta, SCHEMA_VERSION } from './migrations.js';

const SAVES_STORE = 'saves';
const META_STORE = 'meta';

/** Reserved slot id for the rolling autosave. */
export const AUTOSAVE_ID = 'autosave';

/** Debounce window (ms) for coalescing rapid autosave() calls. */
export const AUTOSAVE_DEBOUNCE_MS = 400;

/**
 * Build a save manager bound to a StorageAdapter.
 *
 * @param {StorageAdapter} [adapter=getDefaultAdapter()]
 * @returns {{
 *   listSlots: () => Promise<SaveMeta[]>,
 *   saveSlot: (saveGame:SaveGame) => Promise<SaveMeta>,
 *   loadSlot: (id:string) => Promise<SaveGame|null>,
 *   deleteSlot: (id:string) => Promise<void>,
 *   duplicateSlot: (id:string, newName?:string) => Promise<SaveMeta>,
 *   autosave: (saveGame:SaveGame) => Promise<SaveMeta>,
 *   AUTOSAVE_ID: string
 * }}
 */
export function createSaveManager(adapter = getDefaultAdapter()) {
  if (!adapter || typeof adapter.put !== 'function') {
    throw new Error('createSaveManager: a StorageAdapter is required');
  }

  // --- autosave debounce state ---
  /** @type {ReturnType<typeof setTimeout>|null} */
  let autosaveTimer = null;
  /** @type {SaveGame|null} latest pending payload */
  let pendingAutosave = null;
  /** @type {Array<{resolve:(m:SaveMeta)=>void, reject:(e:*)=>void}>} */
  let autosaveWaiters = [];

  /**
   * Persist a full SaveGame plus its meta, stamping lastPlayed=now. The meta's
   * schemaVersion is normalized to the current build's SCHEMA_VERSION on write.
   *
   * @param {SaveGame} saveGame
   * @returns {Promise<SaveMeta>} the written meta
   */
  async function writeSave(saveGame) {
    if (!saveGame || typeof saveGame !== 'object' || !saveGame.meta || !saveGame.meta.id) {
      throw new Error('saveSlot: a SaveGame with meta.id is required');
    }
    const meta = {
      ...saveGame.meta,
      schemaVersion: SCHEMA_VERSION,
      lastPlayed: Date.now()
    };
    const payload = { ...saveGame, meta };
    await adapter.put(SAVES_STORE, meta.id, payload);
    await adapter.put(META_STORE, meta.id, meta);
    return meta;
  }

  return Object.freeze({
    AUTOSAVE_ID,

    /**
     * List all slot metas, most-recently-played first.
     * @returns {Promise<SaveMeta[]>}
     */
    async listSlots() {
      const entries = await adapter.list(META_STORE);
      return entries
        .map((e) => e.value)
        .filter((m) => m && typeof m === 'object')
        .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    },

    /**
     * Write a full SaveGame to its slot (keyed by meta.id) and mirror its meta.
     * @param {SaveGame} saveGame
     * @returns {Promise<SaveMeta>}
     */
    async saveSlot(saveGame) {
      return writeSave(saveGame);
    },

    /**
     * Read a slot's full SaveGame and migrate it to the current schema.
     * @param {string} id
     * @returns {Promise<SaveGame|null>} null if no such slot
     */
    async loadSlot(id) {
      const raw = await adapter.get(SAVES_STORE, id);
      if (raw == null) return null;
      return migrate(raw);
    },

    /**
     * Remove a slot's payload and meta.
     * @param {string} id
     * @returns {Promise<void>}
     */
    async deleteSlot(id) {
      await adapter.delete(SAVES_STORE, id);
      await adapter.delete(META_STORE, id);
    },

    /**
     * Deep-copy an existing slot into a brand-new slot (fresh id + timestamps),
     * optionally renamed. The copy's createdAt/lastPlayed are now; slotIndex is
     * preserved from the source meta.
     *
     * @param {string} id        source slot id
     * @param {string} [newName] name for the copy (defaults to "<name> (copy)")
     * @returns {Promise<SaveMeta>} the new slot's meta
     */
    async duplicateSlot(id, newName) {
      const source = await adapter.get(SAVES_STORE, id);
      if (source == null) {
        throw new Error(`duplicateSlot: no slot '${id}'`);
      }
      const migrated = migrate(source);
      const name = newName || `${migrated.meta && migrated.meta.name ? migrated.meta.name : 'Save'} (copy)`;
      const slotIndex = migrated.meta && Number.isInteger(migrated.meta.slotIndex)
        ? migrated.meta.slotIndex
        : 0;
      const meta = newSaveMeta(name, migrated.meta ? migrated.meta.seed : undefined, slotIndex);
      const copy = { ...migrated, meta };
      return writeSave(copy);
    },

    /**
     * Debounced autosave to the reserved AUTOSAVE_ID slot. Rapid calls coalesce
     * into a single trailing write; every caller's promise resolves with the
     * meta of the write that lands.
     *
     * @param {SaveGame} saveGame
     * @returns {Promise<SaveMeta>}
     */
    autosave(saveGame) {
      // Force the payload into the reserved slot id (rolling autosave).
      const meta = { ...(saveGame.meta || {}), id: AUTOSAVE_ID, name: 'Autosave' };
      pendingAutosave = { ...saveGame, meta };

      return new Promise((resolve, reject) => {
        autosaveWaiters.push({ resolve, reject });
        if (autosaveTimer) clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
          const payload = pendingAutosave;
          const waiters = autosaveWaiters;
          autosaveTimer = null;
          pendingAutosave = null;
          autosaveWaiters = [];
          writeSave(payload).then(
            (m) => waiters.forEach((w) => w.resolve(m)),
            (e) => waiters.forEach((w) => w.reject(e))
          );
        }, AUTOSAVE_DEBOUNCE_MS);
      });
    }
  });
}
