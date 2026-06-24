/**
 * persistence/serializer.js — SaveGame <-> JSON, with optional log-stripping
 * (CONTRACTS-PERSIST §3). PURE: no adapter, no Date.now, no DOM.
 *
 * A played EventResult carries, for every series, the full per-round logs at
 * `series[].maps[].rounds` (tens of MB across a season). Those logs are NOT data
 * — they are a deterministic function of the series seed, so they regenerate
 * exactly via hydrateSeries(...series.seed). exportSave therefore defaults to the
 * COMPACT form: it strips every `rounds[]` it can find under
 * `season.events[].result`, keeping exports small and shareable. The series
 * `seed` is preserved, so a stripped save + hydrateSeries reproduces byte-
 * identical round logs (the determinism payoff).
 *
 * Series objects appear in several mirrored places inside a persisted season:
 *   season.events[].result.series[] / .stages[].series[]   — the played events
 *   season.regionalResultsBySlot[slot][region].…series[]   — the SeasonState's
 *     internal seeding cache (a stepped/runtime save is a SeasonState, and the
 *     cache embeds the SAME regional EventResults — logs and all). The cache is
 *     KEPT (a mid-season resume seeds the upcoming Masters from it via
 *     mastersSeedOrder, which reads placements only), but its logs are bulky and
 *     deterministically rehydratable, so they are stripped too.
 * stripLogs therefore clears EVERY `rounds[]` anywhere under `season`, so no round
 * logs survive a compact export regardless of where they were mirrored.
 *
 *   exportSave(saveGame, { includeLogs=false }) -> JSON string
 *   importSave(jsonString)                       -> SaveGame (JSON.parse + migrate)
 *   stripLogs(saveGame) / withLogs(saveGame)     -> helpers (pure, structural)
 *
 * Named exports only.
 *
 * @typedef {import('./migrations.js').SaveGame} SaveGame
 */

import { migrate } from './migrations.js';

/**
 * Return a SaveGame copy with every series round-log removed: every `rounds[]`
 * anywhere under `saveGame.season` (the played `events`, the `stages` mirror, AND
 * the SeasonState's internal `regionalResultsBySlot` seeding cache) becomes `[]`.
 * Structural and pure — the input is never mutated (a fresh tree is built).
 *
 * @param {SaveGame} saveGame
 * @returns {SaveGame} a new SaveGame with no non-empty rounds[] under season
 */
export function stripLogs(saveGame) {
  if (!saveGame || typeof saveGame !== 'object') return saveGame;
  if (!saveGame.season || typeof saveGame.season !== 'object') return saveGame;
  return { ...saveGame, season: stripRoundsDeep(saveGame.season) };
}

/**
 * Identity-shaped helper: return the SaveGame unchanged (with logs intact).
 * Provided as the symmetric counterpart to stripLogs so exportSave can branch
 * cleanly on includeLogs. Pure (returns the same reference; callers treat
 * SaveGames as immutable).
 *
 * @param {SaveGame} saveGame
 * @returns {SaveGame}
 */
export function withLogs(saveGame) {
  return saveGame;
}

/**
 * Serialize a SaveGame to a JSON string. By default strips all round logs (small,
 * shareable, deterministic-rehydratable). Pass { includeLogs:true } to embed the
 * full logs.
 *
 * @param {SaveGame} saveGame
 * @param {{ includeLogs?: boolean }} [opts]
 * @returns {string} JSON
 */
export function exportSave(saveGame, { includeLogs = false } = {}) {
  if (!saveGame || typeof saveGame !== 'object') {
    throw new Error('exportSave: a SaveGame is required');
  }
  const payload = includeLogs ? withLogs(saveGame) : stripLogs(saveGame);
  return JSON.stringify(payload);
}

/**
 * Parse an exported JSON string back into a SaveGame and migrate it to the
 * current schema. Absent rounds[] are left absent (empty) — series are rehydrated
 * on demand via hydrateSeries (CONTRACTS-PERSIST §4) before showing the Match
 * screen.
 *
 * @param {string} jsonString
 * @returns {SaveGame} migrated SaveGame
 */
export function importSave(jsonString) {
  if (typeof jsonString !== 'string') {
    throw new Error('importSave: a JSON string is required');
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new Error(`importSave: invalid JSON — ${err && err.message ? err.message : err}`);
  }
  return migrate(parsed);
}

// ---------------------------------------------------------------------------
// internals (pure structural transforms)
// ---------------------------------------------------------------------------

/**
 * Deep-copy a JSON-shaped value, emptying every array stored under a `rounds`
 * key (at any depth) to `[]`. Everything else is rebuilt structurally so the
 * input is never mutated. Used by {@link stripLogs} to drop the bulky, seed-
 * regenerable round logs wherever a season mirrors them (events, the per-stage
 * lists, and the SeasonState's `regionalResultsBySlot` cache).
 *
 * @template T
 * @param {T} value
 * @returns {T} a fresh value with every `rounds[]` cleared
 */
function stripRoundsDeep(value) {
  if (Array.isArray(value)) {
    return value.map(stripRoundsDeep);
  }
  if (value && typeof value === 'object') {
    /** @type {Record<string, *>} */
    const out = {};
    for (const k of Object.keys(value)) {
      out[k] = k === 'rounds' && Array.isArray(value[k]) ? [] : stripRoundsDeep(value[k]);
    }
    return out;
  }
  return value;
}
