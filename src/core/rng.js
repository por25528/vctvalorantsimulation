/**
 * core/rng.js — deterministic PRNG (CONTRACTS §1).
 * Responsibility: a single seedable mulberry32 stream wrapped with helpers.
 * All engine randomness flows through an Rng built here; never Math.random.
 * Pure & dependency-free; runs unchanged in Node and the browser.
 *
 * @typedef {Object} Rng
 * @property {() => number} next                       float in [0,1)
 * @property {(maxExclusive:number) => number} int     int in [0,max)
 * @property {(min:number, maxInclusive:number) => number} range int in [min,max]
 * @property {(p:number) => boolean} chance            true with probability p
 * @property {<T>(array:T[]) => T} pick                uniform random element
 * @property {<T>(items:T[], weightFn:(item:T)=>number) => T} weightedPick element ∝ weight
 * @property {(mean:number, stdev:number) => number} gaussian Box–Muller draw
 */

/**
 * mulberry32: fast, seedable, 2^32 period PRNG.
 * Copied VERBATIM from CONTRACTS §1. DO NOT substitute another algorithm.
 * @param {number} seed
 * @returns {() => number} float generator in [0,1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wrap a raw mulberry32 float source with helpers. Every helper consumes the
 * single underlying stream in a fixed order so a given seed always yields the
 * same sequence (CONTRACTS §1).
 * @param {number} seed
 * @returns {Rng}
 */
export function createRng(seed) {
  const float = mulberry32(seed);

  /** @type {Rng['next']} */
  const next = () => float();

  /** @type {Rng['int']} */
  const int = (maxExclusive) => Math.floor(next() * maxExclusive);

  /** @type {Rng['range']} */
  const range = (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1));

  /** @type {Rng['chance']} */
  const chance = (p) => next() < p;

  /** @type {Rng['pick']} */
  const pick = (array) => array[Math.floor(next() * array.length)];

  /** @type {Rng['weightedPick']} */
  const weightedPick = (items, weightFn) => {
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      const w = weightFn(items[i]);
      total += w > 0 ? w : 0;
    }
    // Single draw consumes one stream value regardless of weights.
    let r = next() * total;
    if (total <= 0) return items[Math.floor(next() * items.length)];
    for (let i = 0; i < items.length; i++) {
      const w = weightFn(items[i]);
      r -= w > 0 ? w : 0;
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  };

  /** @type {Rng['gaussian']} */
  const gaussian = (mean, stdev) => {
    // Box–Muller; consumes two stream values in fixed order.
    let u1 = next();
    const u2 = next();
    if (u1 < 1e-12) u1 = 1e-12; // avoid log(0)
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    return mean + stdev * mag * Math.cos(2 * Math.PI * u2);
  };

  return { next, int, range, chance, pick, weightedPick, gaussian };
}
