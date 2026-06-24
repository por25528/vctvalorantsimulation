/**
 * engine/career/dynamics.js — in-season form/morale/fatigue evolution
 * (CONTRACTS-CAREER §1.1). Phase 6.
 *
 * The match engine already READS these (engine/match/duel.js applies
 * 1 + FORM_WEIGHT·form/100 − FATIGUE_WEIGHT·fatigue/100 + MORALE_WEIGHT·(morale−50)/100
 * to every duel rating). P6 makes them MOVE:
 *   - `updateDynamics` after a series: form chases match performance + a win/loss
 *     kick, morale swings on the result, fatigue accrues per map. DETERMINISTIC
 *     (no rng) — same outcome always yields the same shift.
 *   - `recoverBetweenEvents` between events: fatigue is shed, form mean-reverts
 *     toward 0, morale reverts toward its neutral base.
 *
 * Both return ONLY the dynamics sub-object { form, morale, fatigue }, each value
 * clamped to the domain ranges (form[−100,100], morale[0,100], fatigue[0,100]);
 * the caller splices it back onto the player. Pure; inputs never mutated.
 */

import { BALANCE } from '../../config/balance.js';
import { clamp, num } from './playerStats.js';

const D = BALANCE.CAREER.DYNAMICS;

/**
 * Read a player's current dynamics with domain-default fallbacks.
 * @param {object} player
 * @returns {{ form:number, morale:number, fatigue:number }}
 */
function readDynamics(player) {
  const dyn = (player && player.dynamics) || {};
  return {
    form: num(dyn.form, 0),
    morale: num(dyn.morale, D.MORALE_BASE),
    fatigue: num(dyn.fatigue, 0)
  };
}

/**
 * Evolve a player's dynamics after a played series.
 *
 * @param {object} player
 * @param {{ won:boolean, mapsPlayed:number, performance:number }} matchOutcome
 *   performance ≈ a normalized rating where PERF_BASELINE (1.0) is league-average.
 * @returns {{ form:number, morale:number, fatigue:number }} the new dynamics
 */
export function updateDynamics(player, matchOutcome) {
  const { form, morale, fatigue } = readDynamics(player);
  const o = matchOutcome || {};
  const won = !!o.won;
  const maps = Math.max(0, num(o.mapsPlayed, 0));
  const perfSignal = num(o.performance, D.PERF_BASELINE) - D.PERF_BASELINE;

  const formDelta = D.FORM_PERF_K * perfSignal + (won ? D.FORM_WIN : -D.FORM_LOSS);
  const moraleDelta = (won ? D.MORALE_WIN : -D.MORALE_LOSS) + D.MORALE_PERF_K * perfSignal;
  const fatigueDelta = D.FATIGUE_PER_MAP * maps;

  return {
    form: clamp(form + formDelta, -100, 100),
    morale: clamp(morale + moraleDelta, 0, 100),
    fatigue: clamp(fatigue + fatigueDelta, 0, 100)
  };
}

/**
 * Recover a player's dynamics between events: shed fatigue, mean-revert form
 * toward 0, drift morale toward its neutral base.
 *
 * @param {object} player
 * @returns {{ form:number, morale:number, fatigue:number }} the new dynamics
 */
export function recoverBetweenEvents(player) {
  const { form, morale, fatigue } = readDynamics(player);
  return {
    form: clamp(form * D.FORM_DECAY, -100, 100),
    morale: clamp(morale + D.MORALE_REVERT * (D.MORALE_BASE - morale), 0, 100),
    fatigue: clamp(fatigue - D.FATIGUE_RECOVERY, 0, 100)
  };
}
