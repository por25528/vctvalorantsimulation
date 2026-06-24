/**
 * tests/_assert.mjs — minimal test assertion helpers (Phase 1).
 * Responsibility: provide assert/assertEqual/assertClose/section used by all
 * unit tests and the determinism suite. Throws Error on failure (per CONTRACTS §14).
 * No dependencies; runs unchanged in Node and browser.
 */

/**
 * Assert a condition is truthy.
 * @param {*} cond
 * @param {string} [msg]
 */
export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

/**
 * Deep structural equality assertion.
 * @param {*} a
 * @param {*} b
 * @param {string} [msg]
 */
export function assertEqual(a, b, msg) {
  if (!deepEqual(a, b)) {
    throw new Error(
      (msg ? msg + ': ' : '') +
        `expected deep equality\n  a = ${safeStringify(a)}\n  b = ${safeStringify(b)}`
    );
  }
}

/**
 * Assert two numbers are within eps of each other.
 * @param {number} a
 * @param {number} b
 * @param {number} eps
 * @param {string} [msg]
 */
export function assertClose(a, b, eps, msg) {
  if (typeof a !== 'number' || typeof b !== 'number' || Number.isNaN(a) || Number.isNaN(b)) {
    throw new Error((msg ? msg + ': ' : '') + `assertClose expects numbers, got ${a} and ${b}`);
  }
  if (Math.abs(a - b) > eps) {
    throw new Error((msg ? msg + ': ' : '') + `|${a} - ${b}| = ${Math.abs(a - b)} > ${eps}`);
  }
}

/**
 * Print a section banner (used to group test output).
 * @param {string} name
 */
export function section(name) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${name} ===`);
}

/**
 * Deep structural equality. Handles primitives, arrays, plain objects, Date,
 * NaN-equality, and key-set comparison.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  // NaN === NaN
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;
  if (aIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/**
 * JSON.stringify that tolerates circular refs and BigInt for error messages.
 * @param {*} v
 * @returns {string}
 */
function safeStringify(v) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      v,
      (_k, val) => {
        if (typeof val === 'bigint') return val.toString() + 'n';
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      }
    );
  } catch {
    return String(v);
  }
}
