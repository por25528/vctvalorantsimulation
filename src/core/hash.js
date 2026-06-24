/**
 * core/hash.js — seed derivation (CONTRACTS §2).
 * Responsibility: turn stable string/number paths into 32-bit seeds for the Rng.
 * Pure & dependency-free; runs unchanged in Node and the browser.
 */

/**
 * cyrb53 string hash → 32-bit unsigned.
 * Copied VERBATIM from CONTRACTS §2. DO NOT substitute.
 * @param {string} str
 * @param {number} [seed=0]
 * @returns {number} 32-bit unsigned integer
 */
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
}

/**
 * Derive a 32-bit seed from any number of string/number parts joined by '|'.
 * Copied VERBATIM from CONTRACTS §2.
 * @param {...(string|number)} parts
 * @returns {number} 32-bit unsigned seed
 */
export function hashSeed(...parts) { return cyrb53(parts.join('|')); }
