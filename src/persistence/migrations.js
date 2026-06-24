/**
 * persistence/migrations.js — SaveGame schema version + ordered upgrades
 * (CONTRACTS-PERSIST §2).
 *
 * A SaveGame carries `meta.schemaVersion`. migrate() walks ordered upgrade
 * functions from the save's version up to SCHEMA_VERSION, applying each in turn,
 * so an old save loaded by a newer build is transparently brought current. At v1
 * there is nothing to upgrade (identity); a save tagged with a version NEWER than
 * this build knows about is unloadable (we refuse rather than silently corrupt).
 *
 * This module is the ONE place in the engine/persistence boundary allowed to use
 * Date.now() — newSaveMeta stamps createdAt/lastPlayed. (Per CONTRACTS-PERSIST §0,
 * src/persistence/** may use Date.now.)
 *
 * Named exports only.
 *
 * @typedef {import('./adapter.js').StorageAdapter} StorageAdapter
 *
 * @typedef {Object} SaveMeta
 * @property {string} id
 * @property {string} name
 * @property {number} schemaVersion
 * @property {number|string} seed
 * @property {number} slotIndex
 * @property {number} createdAt
 * @property {number} lastPlayed
 *
 * @typedef {Object} SaveGame
 * @property {SaveMeta} meta
 * @property {object} world
 * @property {object} season
 * @property {object} [career]    // v2+: multi-season meta { seed, seasonIndex, history, offseason, phase }
 * @property {object[]} [inbox]   // v3+: the career news inbox (accumulated NewsItems)
 * @property {{slotId:string, dayIndex:number}|null} [reveal]  // v4+: match-day reveal cursor
 * @property {{ followedTeamId: string|null }} settings
 */

/** Current on-disk schema version. Bump and add an UPGRADES entry per change. */
export const SCHEMA_VERSION = 4;

/**
 * Ordered upgrade functions keyed by the version they upgrade FROM.
 * UPGRADES[n](save) takes a v(n) save and returns a v(n+1) save.
 *
 * @type {Record<number, (save:SaveGame)=>SaveGame>}
 */
const UPGRADES = Object.freeze({
  // v1 -> v2: Phase 6 adds the multi-season career meta. A legacy single-season
  // save becomes season 0 of a career, in-season (or in its off-season if the
  // season was already complete when saved).
  1: (save) => ({
    ...save,
    meta: { ...save.meta, schemaVersion: 2 },
    career: save.career || {
      seed: save.meta ? save.meta.seed : null,
      seasonIndex: 0,
      history: [],
      offseason: null,
      phase: save.season && save.season.complete ? 'offseason' : 'inSeason'
    }
  }),
  // v2 -> v3: Phase 7b adds the career news inbox. Older saves simply start with
  // an empty feed; news re-accumulates as the career is played on.
  2: (save) => ({
    ...save,
    meta: { ...save.meta, schemaVersion: 3 },
    inbox: Array.isArray(save.inbox) ? save.inbox : []
  }),
  // v3 -> v4: the match-day reveal cursor. Pre-v4 saves are always at a slot
  // boundary (Continue was atomic per slot), so they start with no slot revealing.
  3: (save) => ({
    ...save,
    meta: { ...save.meta, schemaVersion: 4 },
    reveal: save.reveal || null
  })
});

/**
 * Migrate a SaveGame up to SCHEMA_VERSION.
 *
 * - A save with no meta.schemaVersion is treated as v1 (baseline).
 * - v1 is the identity (nothing to do — returns the save as-is).
 * - A save FROM a future/unknown version throws (this build can't read it).
 *
 * @param {SaveGame} saveGame
 * @returns {SaveGame} migrated (current-schema) SaveGame
 */
export function migrate(saveGame) {
  if (!saveGame || typeof saveGame !== 'object' || !saveGame.meta) {
    throw new Error('migrate: a SaveGame with a meta block is required');
  }

  let version = saveGame.meta.schemaVersion;
  if (version === undefined || version === null) version = 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(`migrate: invalid meta.schemaVersion ${String(version)}`);
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `migrate: save schemaVersion ${version} is newer than this build supports (${SCHEMA_VERSION})`
    );
  }

  let save = saveGame;
  while (version < SCHEMA_VERSION) {
    const upgrade = UPGRADES[version];
    if (typeof upgrade !== 'function') {
      throw new Error(`migrate: no upgrade path from schemaVersion ${version}`);
    }
    save = upgrade(save);
    version += 1;
  }
  return save;
}

/**
 * Build a fresh SaveMeta for a new career. Stamps timestamps via Date.now()
 * (permitted in this layer) and a sortable, reasonably-unique id.
 *
 * @param {string} name              human-readable slot name
 * @param {number|string} seed       the season's master seed
 * @param {number} [slotIndex=0]     numeric slot ordinal (0 reserved sense is the manager's concern)
 * @returns {SaveMeta}
 */
export function newSaveMeta(name, seed, slotIndex = 0) {
  const now = Date.now();
  return {
    id: makeSaveId(now),
    name: typeof name === 'string' && name.length > 0 ? name : 'Untitled',
    schemaVersion: SCHEMA_VERSION,
    seed,
    slotIndex,
    createdAt: now,
    lastPlayed: now
  };
}

/**
 * A sortable, collision-resistant save id: time component + a short random
 * suffix. Date.now() is permitted here (persistence layer).
 *
 * @param {number} now  a Date.now() timestamp
 * @returns {string}
 */
function makeSaveId(now) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `save_${now.toString(36)}_${rand}`;
}
