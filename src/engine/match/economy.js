/**
 * engine/match/economy.js — per-side credit economy (CONTRACTS §8, §10).
 * Responsibility: starting credits, buy-decision policy, and post-round credit
 * rewards (win/loss bonus/kill/plant), all immutable.
 *
 * Pure functions. All randomness flows through the injected Rng (never
 * Math.random). All tuning constants come from config/balance.js. Every
 * returned object is new — inputs are never mutated. Node + browser.
 */

import { BALANCE } from '../../config/balance.js';

const {
  CREDIT_START,
  CREDIT_MAX,
  WIN_REWARD,
  LOSS_BASE,
  LOSS_BONUS_STEP,
  LOSS_BONUS_MAX,
  KILL_REWARD,
  PLANT_BONUS,
  BUY_FULL_MIN,
  BUY_FORCE_MIN
} = BALANCE;

/**
 * @typedef {'pistol'|'eco'|'force'|'full'} EconType
 * @typedef {{ credits:number, lossStreak:number }} SideEcon
 * @typedef {{ A:SideEcon, B:SideEcon }} Economy
 */

/** Rounds (1-indexed) that start each half — always pistol rounds. */
const PISTOL_ROUNDS = Object.freeze([1, 13]);

/**
 * Buy jitter window (credits) around a threshold inside which a side may, by a
 * single rng draw, stretch up to the next buy tier. Keeps determinism: every
 * call consumes exactly one rng value on non-pistol rounds.
 */
const BUY_JITTER = 150;

/**
 * Create a fresh economy: both sides start at CREDIT_START with no loss streak.
 * @returns {Economy} a new economy object
 */
export function createEconomy() {
  return {
    A: { credits: CREDIT_START, lossStreak: 0 },
    B: { credits: CREDIT_START, lossStreak: 0 }
  };
}

/**
 * Decide a side's buy type for a round.
 * Rounds 1 and 13 are always 'pistol'. Otherwise: 'full' at/above BUY_FULL_MIN,
 * 'force' at/above BUY_FORCE_MIN, else 'eco'. A small rng jitter near a tier
 * threshold can nudge a side up to the next tier (must use the injected rng).
 * @param {SideEcon} sideEcon
 * @param {number} roundNo 1-indexed round number
 * @param {import('../../core/rng.js').Rng} rng
 * @returns {EconType}
 */
export function decideBuy(sideEcon, roundNo, rng) {
  if (PISTOL_ROUNDS.includes(roundNo)) return 'pistol';

  const credits = sideEcon.credits;
  // One deterministic draw in [0,1); jitter only ever upgrades a tier and only
  // when within BUY_JITTER of the next threshold.
  const jitter = rng.next() * BUY_JITTER;

  if (credits >= BUY_FULL_MIN) return 'full';
  if (credits + jitter >= BUY_FULL_MIN && credits >= BUY_FORCE_MIN) return 'full';
  if (credits >= BUY_FORCE_MIN) return 'force';
  if (credits + jitter >= BUY_FORCE_MIN) return 'force';
  return 'eco';
}

/**
 * Loss-bonus payout for a given pre-round loss streak: LOSS_BASE escalated by
 * LOSS_BONUS_STEP per consecutive loss (streak capped at 2 steps), the whole
 * payout capped at LOSS_BONUS_MAX.
 * @param {number} lossStreak streak BEFORE this round was lost
 * @returns {number}
 */
function lossPayout(lossStreak) {
  const steps = Math.min(lossStreak, 2);
  return Math.min(LOSS_BASE + LOSS_BONUS_STEP * steps, LOSS_BONUS_MAX);
}

/**
 * Clamp credits into [0, CREDIT_MAX].
 * @param {number} credits
 * @returns {number}
 */
function clampCredits(credits) {
  if (credits > CREDIT_MAX) return CREDIT_MAX;
  if (credits < 0) return 0;
  return credits;
}

/**
 * Apply a round result, returning a NEW economy (inputs untouched).
 * Winner += WIN_REWARD; loser += loss payout (escalating then capped).
 * Each side += KILL_REWARD per kill it scored. Attackers (assumed team A's
 * current side is handled by the caller's mapping — here `planted` credits the
 * winner's plant per round flow) get PLANT_BONUS if `planted`. Loss streaks
 * update (winner resets to 0, loser increments). All credits clamped to
 * [0, CREDIT_MAX].
 * @param {Economy} econ
 * @param {{ winnerTeam:'A'|'B', planted:boolean, killsA:number, killsB:number }} result
 * @returns {Economy} a new economy object
 */
export function applyRoundResult(econ, { winnerTeam, planted, killsA, killsB }) {
  const kills = { A: killsA, B: killsB };

  /**
   * Build a side's next state from its previous state.
   * @param {'A'|'B'} team
   * @returns {SideEcon}
   */
  const nextSide = (team) => {
    const prev = econ[team];
    const won = team === winnerTeam;
    let credits = prev.credits;
    credits += won ? WIN_REWARD : lossPayout(prev.lossStreak);
    credits += KILL_REWARD * (kills[team] || 0);
    if (planted) credits += PLANT_BONUS;
    return {
      credits: clampCredits(credits),
      lossStreak: won ? 0 : prev.lossStreak + 1
    };
  };

  // Stable A-before-B key order regardless of which side won.
  return {
    A: nextSide('A'),
    B: nextSide('B')
  };
}
