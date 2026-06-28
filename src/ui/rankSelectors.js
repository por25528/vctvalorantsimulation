/**
 * ui/rankSelectors.js — the competitive-core selector adapter.
 *
 * The engine half (r9) owns the canonical `selectGlobalRankings`, `selectLadder`
 * and `playerRankTier` and exposes them from `state/selectors.js`. This thin
 * adapter is what the Global Rankings / Ladder screens + the rank badge import:
 *   - if r9's selector is present, delegate to it (the real, paged data);
 *   - otherwise fall back to the pure local derivations so the screens still
 *     build and render headlessly.
 *
 * Because it reads the selector off the module namespace at call time, wiring to
 * r9's real data is ZERO-CHANGE: once r9 merges the named exports into
 * `selectors.js`, delegation kicks in automatically. Keeping the indirection in
 * one place means the screens never branch on "has r9 merged yet".
 */

import * as selectors from '../state/selectors.js';
import { fallbackGlobalRankings, fallbackLadder } from './rankDerive.js';
import { playerRankTier as fallbackPlayerRankTier } from './rankTier.js';

/**
 * Global rankings (pro teams or players) with climb/fall deltas.
 * @param {object} state
 * @param {{scope?:'teams'|'players'}} [opts]
 * @returns {Array<{rank:number,id:string,name:string,region:(string|null),rating:number,deltaRank:number}>}
 */
export function selectGlobalRankings(state, opts = {}) {
  if (typeof selectors.selectGlobalRankings === 'function') {
    return selectors.selectGlobalRankings(state, opts);
  }
  return fallbackGlobalRankings(state, opts);
}

/**
 * A PAGED window of the ranked ladder. Always returns `{ total, rows }` — the
 * caller renders only `rows` (a single page), never the whole ladder.
 * @param {object} state
 * @param {{tier?:string,region?:string,offset?:number,limit?:number}} [opts]
 * @returns {{total:number, rows:Array<object>}}
 */
export function selectLadder(state, opts = {}) {
  if (typeof selectors.selectLadder === 'function') {
    return selectors.selectLadder(state, opts);
  }
  return fallbackLadder(state, opts);
}

/**
 * A player's rank-tier `{ tier, rr? }` — pure, per-row safe.
 * @param {object|null} player
 * @returns {{tier:string, rr?:number}}
 */
export function playerRankTier(player) {
  if (typeof selectors.playerRankTier === 'function') {
    return selectors.playerRankTier(player);
  }
  return fallbackPlayerRankTier(player);
}
