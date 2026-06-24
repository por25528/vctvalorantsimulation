/**
 * tests/unit/duel.test.mjs — unit tests for engine/match/duel.js (CONTRACTS §9-11, §14).
 *
 * Over many seeded trials, asserts:
 *  - a clearly higher-rated player wins a gunfight >60% of the time;
 *  - the result is bounded by ratings (a vastly stronger player wins >>60%,
 *    and resolveDuel returns only 'A' or 'B');
 *  - the clutch modifier shifts win rate in the correct direction
 *    (high composure -> last-alive player wins more);
 *  - the econ modifier shifts win rate in the correct direction
 *    (a player on full buy beats an otherwise-equal player on eco);
 *  - duelRating is pure (does not mutate inputs) and deterministic.
 *
 * Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, assertClose, section } from '../_assert.mjs';
import { createRng } from '../../src/core/rng.js';
import { createPlayer } from '../../src/domain/player.js';
import { BALANCE } from '../../src/config/balance.js';
import { duelRating, resolveDuel } from '../../src/engine/match/duel.js';

/** A neutral full-buy context for a side. */
function ctxFull(side = 'atk') {
  return { side, econType: 'full', econFactor: BALANCE.ECON_FACTOR.full, isClutch: false };
}

/**
 * Run resolveDuel `trials` times across a deterministic rng and return the
 * fraction of wins for side 'A'.
 * @param {object} pA
 * @param {object} pB
 * @param {object} ctxA
 * @param {object} ctxB
 * @param {number} trials
 * @param {number} seed
 * @returns {number} A win rate in [0,1]
 */
function winRateA(pA, pB, ctxA, ctxB, trials, seed) {
  const rng = createRng(seed);
  let winsA = 0;
  for (let i = 0; i < trials; i++) {
    if (resolveDuel(pA, pB, ctxA, ctxB, rng) === 'A') winsA++;
  }
  return winsA / trials;
}

/** @returns {Promise<void>} */
export default async function run() {
  const TRIALS = 20000;

  section('duel.duelRating — weighted base & purity');
  {
    const p = createPlayer({ name: 'Base', role: 'Duelist', attributes: { aim: 80, reaction: 80, movement: 80, gameSense: 80 } });
    const ctx = ctxFull();

    // With all four weighted attributes at 80 and DUEL_WEIGHTS summing to 1.0,
    // the weighted base is ~80; the only other factor on a default player is the
    // dynamics multiplier (form 0, fatigue 0, morale 60 -> a small MORALE lift).
    const r = duelRating(p, ctx);
    const weightSum = Object.values(BALANCE.DUEL_WEIGHTS).reduce((a, b) => a + b, 0);
    const weightedBase = 80 * weightSum;
    const dynFactor = 1 + BALANCE.MORALE_WEIGHT * ((60 - 50) / 100); // form/fatigue are 0
    assertClose(r, weightedBase * dynFactor, 1e-9, 'rating = weighted base * dynamics factor');

    // Purity: inputs unchanged after rating.
    const snapshot = JSON.parse(JSON.stringify(p));
    duelRating(p, ctx);
    assertEqual(p, snapshot, 'duelRating does not mutate the player');

    // Determinism: same inputs -> same rating.
    assertEqual(duelRating(p, ctx), r, 'duelRating is deterministic');

    // resolveDuel only ever returns 'A' or 'B'.
    const rng = createRng(1);
    for (let i = 0; i < 100; i++) {
      const w = resolveDuel(p, p, ctx, ctx, rng);
      assert(w === 'A' || w === 'B', 'winner is A or B');
    }
  }

  section('duel.resolveDuel — equal players are a coin flip');
  {
    const a = createPlayer({ name: 'Eq A', role: 'Duelist' });
    const b = createPlayer({ name: 'Eq B', role: 'Duelist' });
    const wr = winRateA(a, b, ctxFull('atk'), ctxFull('def'), TRIALS, 42);
    assertClose(wr, 0.5, 0.03, 'equal ratings ~50% win rate');
  }

  section('duel.resolveDuel — clearly higher-rated player wins >60%');
  {
    // A solid star vs a clearly weaker role player. The aim/reaction/movement/
    // gameSense gap should push A comfortably past 60%.
    const strong = createPlayer({
      name: 'Star',
      role: 'Duelist',
      attributes: { aim: 88, reaction: 86, movement: 84, gameSense: 82 }
    });
    const weak = createPlayer({
      name: 'Sub',
      role: 'Duelist',
      attributes: { aim: 70, reaction: 68, movement: 68, gameSense: 66 }
    });

    const ratingStrong = duelRating(strong, ctxFull('atk'));
    const ratingWeak = duelRating(weak, ctxFull('def'));
    assert(ratingStrong > ratingWeak, 'stronger player has higher rating');

    const wr = winRateA(strong, weak, ctxFull('atk'), ctxFull('def'), TRIALS, 7);
    assert(wr > 0.6, `clearly higher-rated player wins >60% (got ${(wr * 100).toFixed(1)}%)`);

    // A massive gap should be near-dominant (sanity ceiling on the logistic).
    const elite = createPlayer({ name: 'Elite', role: 'Duelist', attributes: { aim: 99, reaction: 99, movement: 99, gameSense: 99 } });
    const scrub = createPlayer({ name: 'Scrub', role: 'Duelist', attributes: { aim: 40, reaction: 40, movement: 40, gameSense: 40 } });
    const wrHuge = winRateA(elite, scrub, ctxFull('atk'), ctxFull('def'), TRIALS, 99);
    assert(wrHuge > 0.9, `vast skill gap wins >90% (got ${(wrHuge * 100).toFixed(1)}%)`);
  }

  section('duel.duelRating — clutch modifier shifts win rate correctly');
  {
    // Two identical, high-composure players. Putting A "in the clutch" (last
    // alive) should raise A's win rate above the 50% baseline.
    const a = createPlayer({ name: 'Clutch A', role: 'Sentinel', attributes: { composure: 90 } });
    const b = createPlayer({ name: 'Clutch B', role: 'Sentinel', attributes: { composure: 90 } });

    const baseCtxA = ctxFull('atk');
    const clutchCtxA = { ...ctxFull('atk'), isClutch: true };
    const ctxB = ctxFull('def');

    // Rating increases with high composure when clutch.
    assert(
      duelRating(a, clutchCtxA) > duelRating(a, baseCtxA),
      'high-composure player rates higher in clutch'
    );

    const wrBase = winRateA(a, b, baseCtxA, ctxB, TRIALS, 11);
    const wrClutch = winRateA(a, b, clutchCtxA, ctxB, TRIALS, 11);
    assertClose(wrBase, 0.5, 0.03, 'non-clutch baseline ~50%');
    assert(wrClutch > wrBase + 0.02, `clutch raises high-composure win rate (${(wrBase * 100).toFixed(1)}% -> ${(wrClutch * 100).toFixed(1)}%)`);

    // Inverse direction: a LOW-composure player in the clutch should rate lower
    // and win less than their non-clutch baseline.
    const lowA = createPlayer({ name: 'Choke A', role: 'Duelist', attributes: { composure: 20, aim: 80, reaction: 80, movement: 80, gameSense: 80 } });
    const lowB = createPlayer({ name: 'Choke B', role: 'Duelist', attributes: { composure: 20, aim: 80, reaction: 80, movement: 80, gameSense: 80 } });
    const wrLowBase = winRateA(lowA, lowB, ctxFull('atk'), ctxFull('def'), TRIALS, 13);
    const wrLowClutch = winRateA(lowA, lowB, { ...ctxFull('atk'), isClutch: true }, ctxFull('def'), TRIALS, 13);
    assert(wrLowClutch < wrLowBase - 0.02, `clutch lowers low-composure win rate (${(wrLowBase * 100).toFixed(1)}% -> ${(wrLowClutch * 100).toFixed(1)}%)`);
  }

  section('duel.duelRating — econ modifier shifts win rate correctly');
  {
    // Identical players: A on full buy, B on eco. A should win clearly more.
    const a = createPlayer({ name: 'Buy A', role: 'Duelist' });
    const b = createPlayer({ name: 'Eco B', role: 'Duelist' });

    const ctxA = { side: 'atk', econType: 'full', econFactor: BALANCE.ECON_FACTOR.full, isClutch: false };
    const ctxBeco = { side: 'def', econType: 'eco', econFactor: BALANCE.ECON_FACTOR.eco, isClutch: false };
    const ctxBfull = { side: 'def', econType: 'full', econFactor: BALANCE.ECON_FACTOR.full, isClutch: false };

    assert(duelRating(a, ctxA) > duelRating(b, ctxBeco), 'full-buy rating exceeds eco rating');

    const wrVsEco = winRateA(a, b, ctxA, ctxBeco, TRIALS, 23);
    const wrVsFull = winRateA(a, b, ctxA, ctxBfull, TRIALS, 23);
    assertClose(wrVsFull, 0.5, 0.03, 'full vs full ~50%');
    assert(wrVsEco > wrVsFull + 0.05, `full buy beats eco more than mirror (${(wrVsFull * 100).toFixed(1)}% -> ${(wrVsEco * 100).toFixed(1)}%)`);
    assert(wrVsEco > 0.55, `full vs eco win rate clearly favors the buy (got ${(wrVsEco * 100).toFixed(1)}%)`);
  }

  section('duel.duelRating — pistol dampener compresses the spread');
  {
    // A skilled vs weak pairing rates further apart on full buy than on pistols,
    // because PISTOL_AIM_DAMPEN pulls both toward the neutral midpoint.
    const strong = createPlayer({ name: 'P Strong', role: 'Duelist', attributes: { aim: 90, reaction: 90, movement: 90, gameSense: 90 } });
    const weak = createPlayer({ name: 'P Weak', role: 'Duelist', attributes: { aim: 60, reaction: 60, movement: 60, gameSense: 60 } });

    const fullStrong = duelRating(strong, { side: 'atk', econType: 'full', econFactor: BALANCE.ECON_FACTOR.full, isClutch: false });
    const fullWeak = duelRating(weak, { side: 'def', econType: 'full', econFactor: BALANCE.ECON_FACTOR.full, isClutch: false });
    const pistolStrong = duelRating(strong, { side: 'atk', econType: 'pistol', econFactor: BALANCE.ECON_FACTOR.pistol, isClutch: false });
    const pistolWeak = duelRating(weak, { side: 'def', econType: 'pistol', econFactor: BALANCE.ECON_FACTOR.pistol, isClutch: false });

    const fullSpread = Math.abs(fullStrong - fullWeak);
    const pistolSpread = Math.abs(pistolStrong - pistolWeak);
    assert(pistolSpread < fullSpread, `pistol spread compressed (${pistolSpread.toFixed(2)} < ${fullSpread.toFixed(2)})`);

    // The compressed spread should translate to a lower (closer to 50%) win
    // rate for the strong player on pistols than on full buy.
    const wrFull = winRateA(strong, weak,
      { side: 'atk', econType: 'full', econFactor: BALANCE.ECON_FACTOR.full, isClutch: false },
      { side: 'def', econType: 'full', econFactor: BALANCE.ECON_FACTOR.full, isClutch: false },
      TRIALS, 31);
    const wrPistol = winRateA(strong, weak,
      { side: 'atk', econType: 'pistol', econFactor: BALANCE.ECON_FACTOR.pistol, isClutch: false },
      { side: 'def', econType: 'pistol', econFactor: BALANCE.ECON_FACTOR.pistol, isClutch: false },
      TRIALS, 31);
    assert(wrPistol < wrFull, `pistol win rate closer to even than full (${(wrPistol * 100).toFixed(1)}% < ${(wrFull * 100).toFixed(1)}%)`);
  }

  section('duel.duelRating — map/agent proficiency shifts rating');
  {
    // Same player; one context names a map/agent the player is proficient on.
    const p = createPlayer({
      name: 'Prof',
      role: 'Duelist',
      proficiency: { maps: { ascent: 95 }, agents: { jett: 95 } }
    });
    const plain = ctxFull('atk');
    const onMap = { ...ctxFull('atk'), mapId: 'ascent' };
    const onAgent = { ...ctxFull('atk'), agentId: 'jett' };
    const onBoth = { ...ctxFull('atk'), mapId: 'ascent', agentId: 'jett' };

    assert(duelRating(p, onMap) > duelRating(p, plain), 'map proficiency raises rating');
    assert(duelRating(p, onAgent) > duelRating(p, plain), 'agent proficiency raises rating');
    assert(duelRating(p, onBoth) > duelRating(p, onMap), 'both stack above map alone');

    // A low proficiency on an identified map should LOWER the rating below plain.
    const poor = createPlayer({ name: 'Poor', role: 'Duelist', proficiency: { maps: { bind: 10 } } });
    assert(
      duelRating(poor, { ...ctxFull('atk'), mapId: 'bind' }) < duelRating(poor, ctxFull('atk')),
      'low map proficiency lowers rating'
    );
  }

  section('duel.duelRating — robust to malformed input (no NaN)');
  {
    // Missing attributes / dynamics must never yield NaN or a negative rating.
    const r1 = duelRating({}, ctxFull());
    assert(Number.isFinite(r1) && r1 >= 0, 'empty player -> finite non-negative rating');
    const r2 = duelRating(null, ctxFull());
    assert(Number.isFinite(r2) && r2 >= 0, 'null player -> finite non-negative rating');
    const r3 = duelRating(createPlayer({ role: 'Duelist' }), {});
    assert(Number.isFinite(r3) && r3 >= 0, 'empty ctx -> finite non-negative rating');
  }
}
