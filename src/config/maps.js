/**
 * config/maps.js — editable map reference data.
 * Exports MAPS (the 7 active-pool maps + out-of-pool maps) and MAP_POOL
 * (the 7 active ids). Each map has `atkBias` (0.5 neutral; >0.5 favors attack)
 * and `inPool`. CONTRACTS §6: { id, name, atkBias:number, inPool:boolean }.
 *
 * Active competitive pool reflects the current VCT 2026 rotation. All entries
 * default to a neutral 0.5 atkBias (balancing happens in one place later).
 *
 * @typedef {import('../core/produce.js').GameMap} GameMap
 */

/**
 * @typedef {object} GameMapDef
 * @property {string} id
 * @property {string} name
 * @property {number} atkBias  0.5 neutral; >0.5 favors attack
 * @property {boolean} inPool  true if in the current competitive rotation
 */

/** @type {ReadonlyArray<GameMapDef>} */
export const MAPS = Object.freeze([
  // --- current 7-map active competitive pool ---
  Object.freeze({ id: 'ascent', name: 'Ascent', atkBias: 0.5, inPool: true }),
  Object.freeze({ id: 'bind', name: 'Bind', atkBias: 0.5, inPool: true }),
  Object.freeze({ id: 'haven', name: 'Haven', atkBias: 0.5, inPool: true }),
  Object.freeze({ id: 'lotus', name: 'Lotus', atkBias: 0.5, inPool: true }),
  Object.freeze({ id: 'split', name: 'Split', atkBias: 0.5, inPool: true }),
  Object.freeze({ id: 'sunset', name: 'Sunset', atkBias: 0.5, inPool: true }),
  Object.freeze({ id: 'corrode', name: 'Corrode', atkBias: 0.5, inPool: true }),
  // --- out-of-pool maps (rotated out / in the vault) ---
  Object.freeze({ id: 'icebox', name: 'Icebox', atkBias: 0.5, inPool: false }),
  Object.freeze({ id: 'breeze', name: 'Breeze', atkBias: 0.5, inPool: false }),
  Object.freeze({ id: 'fracture', name: 'Fracture', atkBias: 0.5, inPool: false }),
  Object.freeze({ id: 'pearl', name: 'Pearl', atkBias: 0.5, inPool: false }),
  Object.freeze({ id: 'abyss', name: 'Abyss', atkBias: 0.5, inPool: false })
]);

/**
 * The 7 active-pool map ids, derived from MAPS so the two never drift.
 * @type {ReadonlyArray<string>}
 */
export const MAP_POOL = Object.freeze(MAPS.filter((m) => m.inPool).map((m) => m.id));
