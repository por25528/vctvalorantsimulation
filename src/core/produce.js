/**
 * core/produce.js — immutable update helpers (CONTRACTS §4).
 * Responsibility: structural-clone-then-recipe updates and immutable deep set.
 * Inputs are never mutated. Pure & dependency-free; Node + browser.
 */

/**
 * Shallow structural clone of `obj`, then run `recipe(draft)`. The recipe may
 * mutate the draft (a fresh shallow copy) or return a replacement object. The
 * original `obj` is never mutated.
 * @template T
 * @param {T} obj
 * @param {(draft:T) => (T|void)} recipe
 * @returns {T} a new object
 */
export function produce(obj, recipe) {
  const draft = shallowClone(obj);
  const result = recipe(draft);
  return /** @type {T} */ (result === undefined ? draft : result);
}

/**
 * Immutable deep set by array path. Returns a new object with the value at
 * `path` replaced; every object/array along the path is cloned, the rest shared.
 * @template T
 * @param {T} obj
 * @param {Array<string|number>} path
 * @param {*} value
 * @returns {T} a new object
 */
export function set(obj, path, value) {
  if (!Array.isArray(path) || path.length === 0) {
    return /** @type {T} */ (value);
  }
  const [key, ...rest] = path;
  const clone = shallowClone(obj);
  clone[key] = rest.length === 0 ? value : set(obj == null ? undefined : obj[key], rest, value);
  return clone;
}

/**
 * Shallow clone preserving array vs plain-object kind. Non-objects pass through.
 * @template T
 * @param {T} v
 * @returns {T}
 */
function shallowClone(v) {
  if (Array.isArray(v)) return /** @type {T} */ (v.slice());
  if (v !== null && typeof v === 'object') return /** @type {T} */ ({ ...v });
  // For primitives / null / undefined on a set path, start a fresh object.
  return /** @type {T} */ (v === undefined || v === null ? {} : v);
}
