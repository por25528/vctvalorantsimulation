/**
 * tests/unit/economy.test.mjs — engine/match/economy.js (CONTRACTS §8, §10, §14).
 * Verifies: createEconomy defaults; pistol-round detection; buy thresholds;
 * loss bonus escalates then caps; kill/plant rewards; credits never exceed
 * CREDIT_MAX; outputs are new objects (inputs never mutated).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createRng } from '../../src/core/rng.js';
import { BALANCE } from '../../src/config/balance.js';
import { createEconomy, decideBuy, applyRoundResult } from '../../src/engine/match/economy.js';

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

export default async function economyTest() {
  section('engine/match/economy');

  // createEconomy: both sides start at CREDIT_START, lossStreak 0.
  {
    const econ = createEconomy();
    assertEqual(
      econ,
      { A: { credits: CREDIT_START, lossStreak: 0 }, B: { credits: CREDIT_START, lossStreak: 0 } },
      'createEconomy defaults'
    );
    // Independent instances (no shared references).
    const econ2 = createEconomy();
    assert(econ !== econ2 && econ.A !== econ2.A, 'createEconomy returns fresh objects');
  }

  // Pistol detection: rounds 1 and 13 are always pistol regardless of credits.
  {
    const rng = createRng(1);
    assertEqual(decideBuy({ credits: 9000, lossStreak: 0 }, 1, rng), 'pistol', 'round 1 pistol');
    assertEqual(decideBuy({ credits: 0, lossStreak: 0 }, 13, rng), 'pistol', 'round 13 pistol');
    // A mid-half round with full credits is NOT pistol.
    assertEqual(decideBuy({ credits: 9000, lossStreak: 0 }, 7, rng), 'full', 'round 7 not pistol');
  }

  // Thresholds: full at/above BUY_FULL_MIN, force at/above BUY_FORCE_MIN, else eco.
  {
    const rng = createRng(42);
    // Use values comfortably away from jitter window so the rng draw can't change tier.
    assertEqual(decideBuy({ credits: BUY_FULL_MIN + 1000, lossStreak: 0 }, 4, rng), 'full', 'full tier');
    assertEqual(decideBuy({ credits: BUY_FORCE_MIN + 500, lossStreak: 0 }, 4, rng), 'force', 'force tier');
    assertEqual(decideBuy({ credits: 0, lossStreak: 0 }, 4, rng), 'eco', 'eco tier');
    // Exact threshold boundaries are inclusive.
    assertEqual(decideBuy({ credits: BUY_FULL_MIN, lossStreak: 0 }, 4, rng), 'full', 'full boundary inclusive');
    assertEqual(decideBuy({ credits: BUY_FORCE_MIN, lossStreak: 0 }, 4, rng), 'force', 'force boundary inclusive');
  }

  // decideBuy is deterministic for a given rng stream and never throws on jitter.
  {
    const a = createRng(7);
    const b = createRng(7);
    for (let r = 2; r <= 12; r++) {
      const side = { credits: 1950 + r * 10, lossStreak: 0 };
      assertEqual(decideBuy(side, r, a), decideBuy(side, r, b), `deterministic buy r${r}`);
    }
  }

  // Loss bonus escalates per consecutive loss, then caps.
  {
    // Side B keeps losing; A keeps winning. Track B's loss payout each round.
    // Pre-round streak 0 -> LOSS_BASE; 1 -> +1 step; 2 -> +2 steps; 3 -> still +2 (cap on steps);
    // and the whole thing is capped at LOSS_BONUS_MAX.
    const expectedPayout = [
      Math.min(LOSS_BASE, LOSS_BONUS_MAX), // streak 0
      Math.min(LOSS_BASE + LOSS_BONUS_STEP, LOSS_BONUS_MAX), // streak 1
      Math.min(LOSS_BASE + LOSS_BONUS_STEP * 2, LOSS_BONUS_MAX), // streak 2
      Math.min(LOSS_BASE + LOSS_BONUS_STEP * 2, LOSS_BONUS_MAX) // streak 3 -> step capped at 2
    ];

    for (let prevStreak = 0; prevStreak < expectedPayout.length; prevStreak++) {
      // Isolate each streak level with a low, non-clamping starting balance so
      // the measured delta is exactly the loss payout (no CREDIT_MAX clamp).
      const econ = {
        A: { credits: CREDIT_START, lossStreak: 0 },
        B: { credits: CREDIT_START, lossStreak: prevStreak }
      };
      const out = applyRoundResult(econ, { winnerTeam: 'A', planted: false, killsA: 0, killsB: 0 });
      const gained = out.B.credits - econ.B.credits;
      assertEqual(gained, expectedPayout[prevStreak], `loss payout at streak ${prevStreak}`);
      assertEqual(out.B.lossStreak, prevStreak + 1, 'loser streak increments');
      assertEqual(out.A.lossStreak, 0, 'winner streak stays 0');
    }

    // The escalation actually moved (step 1 paid more than step 0) and then capped flat.
    assert(expectedPayout[1] > expectedPayout[0], 'bonus escalated');
    assertEqual(expectedPayout[2], expectedPayout[3], 'bonus capped flat at >=2 streak');
  }

  // Winner reward + kill rewards + plant bonus; loser streak resets on a win.
  {
    let econ = createEconomy();
    // Build B a loss streak first.
    econ = applyRoundResult(econ, { winnerTeam: 'A', planted: false, killsA: 0, killsB: 0 });
    assertEqual(econ.B.lossStreak, 1, 'B has a loss streak');

    const beforeB = econ.B.credits;
    const beforeA = econ.A.credits;
    // Now B wins with 5 kills and a plant; A loses with 3 kills.
    econ = applyRoundResult(econ, { winnerTeam: 'B', planted: true, killsA: 3, killsB: 5 });

    assertEqual(
      econ.B.credits - beforeB,
      WIN_REWARD + KILL_REWARD * 5 + PLANT_BONUS,
      'winner gets win reward + kills + plant'
    );
    assertEqual(
      econ.A.credits - beforeA,
      LOSS_BASE + KILL_REWARD * 3 + PLANT_BONUS,
      'loser gets loss payout + kills + plant'
    );
    assertEqual(econ.B.lossStreak, 0, 'winner loss streak resets');
    assertEqual(econ.A.lossStreak, 1, 'loser loss streak increments');
  }

  // Credits never exceed CREDIT_MAX even after large rewards.
  {
    let econ = {
      A: { credits: CREDIT_MAX - 100, lossStreak: 0 },
      B: { credits: CREDIT_MAX - 100, lossStreak: 0 }
    };
    econ = applyRoundResult(econ, { winnerTeam: 'A', planted: true, killsA: 5, killsB: 5 });
    assert(econ.A.credits <= CREDIT_MAX, 'winner clamped to CREDIT_MAX');
    assert(econ.B.credits <= CREDIT_MAX, 'loser clamped to CREDIT_MAX');
    assertEqual(econ.A.credits, CREDIT_MAX, 'winner hit exactly CREDIT_MAX');
  }

  // Immutability: applyRoundResult returns a new object, never mutating input.
  {
    const econ = createEconomy();
    const snapshot = JSON.stringify(econ);
    const out = applyRoundResult(econ, { winnerTeam: 'A', planted: false, killsA: 2, killsB: 1 });
    assert(out !== econ, 'returns new economy');
    assert(out.A !== econ.A && out.B !== econ.B, 'returns new side objects');
    assertEqual(JSON.stringify(econ), snapshot, 'input economy never mutated');
    // Stable A-before-B key ordering regardless of winner.
    const keyed = applyRoundResult(econ, { winnerTeam: 'B', planted: false, killsA: 0, killsB: 0 });
    assertEqual(Object.keys(keyed), ['A', 'B'], 'stable A,B key order');
  }
}
