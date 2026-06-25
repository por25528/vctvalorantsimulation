/**
 * engine/match/roundSim.js — THE per-round engagement loop (CONTRACTS §9, §11).
 *
 * `simRound(args, rng)` simulates one Valorant round: attackers vs defenders,
 * 5v5 alive, resolving sequential gunfights (duels) with trades, clutches, spike
 * plant/defuse, and a time/strength tiebreak, then returns a complete RoundLog
 * (CONTRACTS §9). The caller (mapSim) owns side assignment, economy carry-over,
 * and box-score accumulation; this module owns only the within-round flow.
 *
 * Pure & immutable: never mutates its inputs, returns a brand-new RoundLog
 * (CONTRACTS §15). All randomness flows through the injected Rng (CONTRACTS §1);
 * no Math.random / Date.now / window / document. Every tuning number comes from
 * config/balance.js. Runs unchanged in Node and the browser (ES modules, named
 * exports only).
 *
 * Algorithm (CONTRACTS §11, followed exactly):
 *  1. Resolve each side's econType/econFactor from its SideEcon (pistol on
 *     rounds 1 & 13). Pistol dampening is handled inside duelRating via econType.
 *  2. Loop engagements until a side is eliminated or ENGAGEMENT_CAP is hit:
 *     a. weightedPick one alive attacker and one alive defender by duelRating.
 *     b. Build a RoundContext per duelist (side, econ, isClutch when that side
 *        has exactly 1 alive).
 *     c. resolveDuel; loser dies -> DuelEvent (isFirstBlood for the first event,
 *        isClutchKill when the killer was clutching).
 *     d. Trade attempt: p = TRADE_BASE * (avgTrading(losingSideAlive)/100); on
 *        success a random alive teammate of the victim kills the killer
 *        (DuelEvent with isTrade:true).
 *  3. Outcome: a side at 0 alive -> 'elim'; cap reached -> higher aliveEnd wins,
 *     tie broken by a team round-strength logistic (ROUND_SCALE) -> 'time'.
 *  4. Spike: if attackers gained a man-advantage during the round, plant with
 *     PLANT_BASE_CHANCE; planted + attackers win -> 'spike', defenders win after
 *     a plant -> 'defuse'.
 *  5. clutchPlayerId: a player who won the round while last-alive vs >=1 enemy.
 */

import { BALANCE } from '../../config/balance.js';
import { duelRating, resolveDuel } from './duel.js';
import { compAbilityEffects } from './abilities.js';
import { momentumDuelFactor, momentumEcoBias, stakesAmplifier } from './momentum.js';

/**
 * @typedef {import('./duel.js').RoundContext} RoundContext
 * @typedef {import('./boxScore.js').DuelEvent} DuelEvent
 * @typedef {import('./boxScore.js').RoundLog} RoundLog
 * @typedef {import('../../domain/player.js').Player} Player
 */

/**
 * @typedef {{ credits:number, lossStreak:number }} SideEcon
 */

/**
 * @typedef SimRoundArgs
 * @property {number} n round number (1-indexed)
 * @property {'atk'|'def'} sideA side team A plays this round
 * @property {'atk'|'def'} sideB side team B plays this round
 * @property {{A:string[],B:string[]}} rostersAlive alive player ids per team at round start
 * @property {SideEcon} econA team A economy entering the round
 * @property {SideEcon} econB team B economy entering the round
 * @property {import('../../domain/team.js').Team} teamA
 * @property {import('../../domain/team.js').Team} teamB
 * @property {Record<string, Player>} players id -> Player lookup
 * @property {string} mapId
 * @property {number} [chemA] team A chemistry multiplier (default 1; P12.2)
 * @property {number} [chemB] team B chemistry multiplier (default 1; P12.2)
 * @property {string[]} [compA] team A agent composition (5 agentIds); drives ability effects
 * @property {string[]} [compB] team B agent composition (5 agentIds); drives ability effects
 * @property {boolean} [ultReadyA] whether team A's ult is charged this round
 * @property {boolean} [ultReadyB] whether team B's ult is charged this round
 * @property {number} [momentumA] team A momentum in [-1,+1] (default 0; match-momentum-b4)
 * @property {number} [momentumB] team B momentum in [-1,+1] (default 0)
 * @property {number} [scoreA] team A map score so far (for stakes detection; default 0)
 * @property {number} [scoreB] team B map score so far (default 0)
 */

/** Rounds (1-indexed) that start a half — always pistol rounds (mirror economy.js). */
const PISTOL_ROUNDS = Object.freeze([1, 13]);

/** Neutral trading value used when a player record or attribute is missing. */
const DEFAULT_TRADING = 50;

/**
 * Resolve the econType for a side from its credits / round number. Mirrors the
 * tiering in economy.decideBuy but is rng-free (the buy decision itself is made
 * upstream; here we only need a stable type to pick the econFactor). Pistol
 * rounds are always 'pistol'.
 * An optional `creditBias` (from momentum) shifts the effective credits so a
 * team on a winning streak may stretch into the next buy tier and vice-versa.
 * @param {SideEcon} econ
 * @param {number} roundNo
 * @param {number} [creditBias] momentum-derived credit offset (default 0)
 * @returns {'pistol'|'eco'|'force'|'full'}
 */
function econTypeFor(econ, roundNo, creditBias) {
  if (PISTOL_ROUNDS.includes(roundNo)) return 'pistol';
  const base = econ && typeof econ.credits === 'number' ? econ.credits : 0;
  const credits = base + (typeof creditBias === 'number' && Number.isFinite(creditBias) ? creditBias : 0);
  if (credits >= BALANCE.BUY_FULL_MIN) return 'full';
  if (credits >= BALANCE.BUY_FORCE_MIN) return 'force';
  return 'eco';
}

/**
 * Map an econType to its rating multiplier (config/balance.js ECON_FACTOR).
 * @param {'pistol'|'eco'|'force'|'full'} econType
 * @returns {number}
 */
function econFactorFor(econType) {
  const f = BALANCE.ECON_FACTOR[econType];
  return typeof f === 'number' && Number.isFinite(f) ? f : 1;
}

/**
 * Read a player's trading attribute (0..100), defaulting when unavailable.
 * @param {Player|undefined} player
 * @returns {number}
 */
function tradingOf(player) {
  const v = player && player.attributes ? player.attributes.trading : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_TRADING;
}

/**
 * Average trading attribute across a set of alive player ids.
 * @param {string[]} aliveIds
 * @param {Record<string, Player>} players
 * @returns {number}
 */
function avgTrading(aliveIds, players) {
  if (!aliveIds || aliveIds.length === 0) return DEFAULT_TRADING;
  let sum = 0;
  for (const id of aliveIds) sum += tradingOf(players[id]);
  return sum / aliveIds.length;
}

/**
 * Build a RoundContext for one player on a given side.
 * @param {'atk'|'def'} side
 * @param {'pistol'|'eco'|'force'|'full'} econType
 * @param {number} econFactor
 * @param {boolean} isClutch this player's side has exactly 1 alive
 * @param {string} mapId
 * @param {number} teamFactor chemistry multiplier
 * @param {number} roundNo 1-indexed round number
 * @param {number} [momentumFactor] duel-rating multiplier from team momentum (default 1)
 * @param {number} [stakesAmp] trait-deviation amplifier for this round (default 1)
 * @returns {RoundContext}
 */
function buildContext(side, econType, econFactor, isClutch, mapId, teamFactor, roundNo, momentumFactor, stakesAmp) {
  return {
    side,
    econType,
    econFactor,
    isClutch,
    mapId,
    teamFactor: typeof teamFactor === 'number' ? teamFactor : 1,
    roundNo: typeof roundNo === 'number' ? roundNo : 0,
    momentumFactor: typeof momentumFactor === 'number' && Number.isFinite(momentumFactor) ? momentumFactor : 1,
    stakesAmplifier: typeof stakesAmp === 'number' && Number.isFinite(stakesAmp) ? stakesAmp : 1,
  };
}

/**
 * Team round-strength: average duelRating of the alive lineup (full-buy,
 * non-clutch context), lightly lifted by the IGL bonus. Used only to break a
 * cap-reached aliveEnd tie via a logistic on the difference (CONTRACTS §11.3).
 * @param {string[]} aliveIds
 * @param {Record<string, Player>} players
 * @param {'atk'|'def'} side
 * @param {'pistol'|'eco'|'force'|'full'} econType
 * @param {number} econFactor
 * @param {string} mapId
 * @param {number} teamFactor
 * @param {number} roundNo
 * @param {number} [momentumFactor]
 * @param {number} [stakesAmp]
 * @returns {number}
 */
function roundStrength(aliveIds, players, side, econType, econFactor, mapId, teamFactor, roundNo, momentumFactor, stakesAmp) {
  if (!aliveIds || aliveIds.length === 0) return 0;
  const ctx = buildContext(side, econType, econFactor, false, mapId, teamFactor, roundNo, momentumFactor, stakesAmp);
  let sum = 0;
  let bestIgl = 0;
  for (const id of aliveIds) {
    const p = players[id];
    sum += duelRating(p, ctx);
    const igl = p && p.attributes && typeof p.attributes.igl === 'number' ? p.attributes.igl : 0;
    if (igl > bestIgl) bestIgl = igl;
  }
  const avg = sum / aliveIds.length;
  return avg * (1 + BALANCE.IGL_TEAM_BONUS * (bestIgl / 100));
}

/**
 * Simulate one round and return a complete RoundLog (CONTRACTS §9).
 *
 * `args.sideA`/`args.sideB` are opposite sides ('atk'/'def'); the attacking team
 * is whichever has side 'atk'. Alive sets are copied (never mutated). Every kill
 * is recorded as a DuelEvent whose `killerSide` is the killer's side and whose
 * `assistIds` are the killer's alive teammates at the moment of the kill (the box
 * score assigns assists probabilistically from these candidates).
 *
 * @param {SimRoundArgs} args
 * @param {import('../../core/rng.js').Rng} rng
 * @returns {RoundLog}
 */
export function simRound(args, rng) {
  const { n, sideA, sideB, rostersAlive, econA, econB, players, mapId } = args;
  // P12.2 — per-team chemistry multipliers (default 1 = no-op).
  const chemA = typeof args.chemA === 'number' && args.chemA > 0 ? args.chemA : 1;
  const chemB = typeof args.chemB === 'number' && args.chemB > 0 ? args.chemB : 1;

  // Momentum scalars in [-1,+1] (default 0 = no streak effect).
  const rawMomA = typeof args.momentumA === 'number' && Number.isFinite(args.momentumA) ? args.momentumA : 0;
  const rawMomB = typeof args.momentumB === 'number' && Number.isFinite(args.momentumB) ? args.momentumB : 0;

  // --- Identify which TEAM is attacker vs defender this round. ---------------
  // The attacker is the team whose side === 'atk'. We carry the team letter so
  // the final RoundLog can report winnerTeam alongside winnerSide.
  const atkTeam = sideA === 'atk' ? 'A' : 'B';
  const defTeam = atkTeam === 'A' ? 'B' : 'A';
  const atkFactor = atkTeam === 'A' ? chemA : chemB;
  const defFactor = defTeam === 'A' ? chemA : chemB;

  const econByTeam = { A: econA, B: econB };
  const sideByTeam = { A: sideA, B: sideB };

  // Working alive lists (copies — inputs never mutated). Keyed by side role.
  const aliveAtk = (rostersAlive[atkTeam] || []).slice();
  const aliveDef = (rostersAlive[defTeam] || []).slice();

  const startAtk = aliveAtk.length;
  const startDef = aliveDef.length;

  // --- Per-side momentum factors and stakes amplifier. -----------------------
  // Momentum is per-TEAM; map to per-SIDE depending on who is atk/def this round.
  const atkMomRaw = atkTeam === 'A' ? rawMomA : rawMomB;
  const defMomRaw = defTeam === 'A' ? rawMomA : rawMomB;
  const atkMomFactor = momentumDuelFactor(atkMomRaw);
  const defMomFactor = momentumDuelFactor(defMomRaw);

  // Momentum-biased credit for buy-tier (shifts aggression without extra rng).
  const atkCreditBias = momentumEcoBias(atkMomRaw);
  const defCreditBias = momentumEcoBias(defMomRaw);

  // --- Per-side econ type / factor (pistol handled inside duelRating). -------
  const atkEconType = econTypeFor(econByTeam[atkTeam], n, atkCreditBias);
  const defEconType = econTypeFor(econByTeam[defTeam], n, defCreditBias);
  const baseAtkEconFactor = econFactorFor(atkEconType);
  const baseDefEconFactor = econFactorFor(defEconType);

  // --- Ability effects: map comp archetypes to bounded round multipliers. ----
  const compAtk = atkTeam === 'A' ? args.compA : args.compB;
  const compDef = defTeam === 'A' ? args.compA : args.compB;
  const ultReadyAtk = atkTeam === 'A' ? (args.ultReadyA || false) : (args.ultReadyB || false);
  const ultReadyDef = defTeam === 'A' ? (args.ultReadyA || false) : (args.ultReadyB || false);
  const abilityAtk = compAbilityEffects(compAtk, ultReadyAtk);
  const abilityDef = compAbilityEffects(compDef, ultReadyDef);

  const atkEconFactor = baseAtkEconFactor * abilityAtk.atkFactor * (1 + abilityAtk.ultBonus);
  const defEconFactor = baseDefEconFactor * abilityDef.defFactor * (1 + abilityDef.ultBonus);

  // Stakes amplifier for trait deviations this round.
  const scoreA = typeof args.scoreA === 'number' ? args.scoreA : 0;
  const scoreB = typeof args.scoreB === 'number' ? args.scoreB : 0;
  const amp = stakesAmplifier({ scoreA, scoreB, roundNo: n, atkEconType, defEconType });

  /** @type {DuelEvent[]} */
  const events = [];

  // Track whether attackers ever held a strictly numeric man-advantage during
  // the round (CONTRACTS §11.4 — gates whether a plant can happen).
  let attackersGainedAdvantage = startAtk > startDef;

  // Whoever wins while last-alive vs >=1 enemy is the clutch player (§11.5).
  /** @type {string|null} */
  let clutchPlayerId = null;

  /**
   * Record a kill as a DuelEvent, removing the victim from their alive list.
   * Assist candidates are the killer's CURRENTLY-alive teammates (excluding the
   * killer). Updates the man-advantage flag after the kill.
   * @param {string} killerId
   * @param {string} victimId
   * @param {'atk'|'def'} killerSide
   * @param {string[]} killerAlive killer's side alive list (killer still in it)
   * @param {string[]} victimAlive victim's side alive list (victim still in it)
   * @param {boolean} isFirstBlood
   * @param {boolean} isTrade
   * @param {boolean} isClutchKill
   */
  function recordKill(killerId, victimId, killerSide, killerAlive, victimAlive, isFirstBlood, isTrade, isClutchKill) {
    // Assist candidates: killer's alive teammates with their utility (boxScore
    // weights assist attribution by utility) — exclude the killer itself.
    const assistIds = [];
    for (const id of killerAlive) {
      if (id === killerId) continue;
      const teammate = players[id];
      const utility = teammate && teammate.attributes && typeof teammate.attributes.utility === 'number'
        ? teammate.attributes.utility
        : 0;
      assistIds.push({ id, utility });
    }

    events.push({
      round: n,
      killerId,
      victimId,
      killerSide,
      isFirstBlood,
      isTrade,
      isClutchKill,
      assistIds
    });

    // Remove the victim from their alive list (mutates the local copy only).
    const vi = victimAlive.indexOf(victimId);
    if (vi >= 0) victimAlive.splice(vi, 1);

    if (aliveAtk.length > aliveDef.length) attackersGainedAdvantage = true;
  }

  // --- Engagement loop (§11.2) ----------------------------------------------
  let engagements = 0;
  while (aliveAtk.length > 0 && aliveDef.length > 0 && engagements < BALANCE.ENGAGEMENT_CAP) {
    engagements += 1;

    const atkClutch = aliveAtk.length === 1;
    const defClutch = aliveDef.length === 1;

    const ctxAtk = buildContext('atk', atkEconType, atkEconFactor, atkClutch, mapId, atkFactor, n, atkMomFactor, amp);
    const ctxDef = buildContext('def', defEconType, defEconFactor, defClutch, mapId, defFactor, n, defMomFactor, amp);

    // weightedPick a participant from each side, weight = its duelRating.
    const atkId = rng.weightedPick(aliveAtk, (id) => {
      const r = duelRating(players[id], ctxAtk);
      return r > 0 ? r : 0;
    });
    const defId = rng.weightedPick(aliveDef, (id) => {
      const r = duelRating(players[id], ctxDef);
      return r > 0 ? r : 0;
    });

    // Resolve the gunfight: 'A' means atk participant wins, 'B' means def wins.
    const winner = resolveDuel(players[atkId], players[defId], ctxAtk, ctxDef, rng);

    const isFirstBlood = events.length === 0;

    let killerId;
    let victimId;
    let killerSide;
    let killerAlive;
    let victimAlive;
    let killerWasClutch;

    if (winner === 'A') {
      killerId = atkId;
      victimId = defId;
      killerSide = 'atk';
      killerAlive = aliveAtk;
      victimAlive = aliveDef;
      killerWasClutch = atkClutch;
    } else {
      killerId = defId;
      victimId = atkId;
      killerSide = 'def';
      killerAlive = aliveDef;
      victimAlive = aliveAtk;
      killerWasClutch = defClutch;
    }

    recordKill(killerId, victimId, killerSide, killerAlive, victimAlive, isFirstBlood, false, killerWasClutch);

    // --- Trade attempt (§11.2d) ---------------------------------------------
    // The LOSING side is the victim's side. Its remaining alive players are the
    // potential traders. p = (TRADE_BASE + infoBonus) * (avgTrading(losingSideAlive)/100).
    // Info/recon agents on the victim's side raise trade odds (they see the killer).
    if (victimAlive.length > 0) {
      const infoTradeBonus = killerSide === 'atk' ? abilityDef.tradeBonus : abilityAtk.tradeBonus;
      const tradeP = (BALANCE.TRADE_BASE + infoTradeBonus) * (avgTrading(victimAlive, players) / 100);
      if (rng.chance(tradeP)) {
        // A random alive teammate of the victim kills the killer.
        const traderId = rng.pick(victimAlive);
        const traderSide = killerSide === 'atk' ? 'def' : 'atk';
        // The trade kill: trader (victim's side) kills the original killer.
        // killerAlive is the original killer's side list; the trader's alive list
        // is victimAlive. A trade is never a first blood (a kill already exists).
        recordKill(traderId, killerId, traderSide, victimAlive, killerAlive, false, true, false);
      }
    }
  }

  // --- Outcome resolution (§11.3) -------------------------------------------
  const aliveEndAtk = aliveAtk.length;
  const aliveEndDef = aliveDef.length;

  /** @type {'atk'|'def'} */
  let winnerSide;
  /** @type {'elim'|'spike'|'defuse'|'time'} */
  let endCondition;

  if (aliveEndAtk === 0 && aliveEndDef === 0) {
    // Pathological mutual elimination (e.g. final trade). Treat as elim won by
    // the side that ended with the last standing kill; fall back to defenders
    // (defenders win when the spike is not planted). Deterministic, no rng.
    winnerSide = 'def';
    endCondition = 'elim';
  } else if (aliveEndDef === 0) {
    winnerSide = 'atk';
    endCondition = 'elim';
  } else if (aliveEndAtk === 0) {
    winnerSide = 'def';
    endCondition = 'elim';
  } else {
    // Cap reached with both sides alive: higher aliveEnd wins; tie broken by a
    // team round-strength logistic (ROUND_SCALE). endCondition = 'time'.
    if (aliveEndAtk > aliveEndDef) {
      winnerSide = 'atk';
    } else if (aliveEndDef > aliveEndAtk) {
      winnerSide = 'def';
    } else {
      const atkStrength = roundStrength(aliveAtk, players, 'atk', atkEconType, atkEconFactor, mapId, atkFactor, n, atkMomFactor, amp);
      const defStrength = roundStrength(aliveDef, players, 'def', defEconType, defEconFactor, mapId, defFactor, n, defMomFactor, amp);
      const pAtk = 1 / (1 + Math.exp(-(atkStrength - defStrength) / BALANCE.ROUND_SCALE));
      winnerSide = rng.next() < pAtk ? 'atk' : 'def';
    }
    endCondition = 'time';
  }

  // --- Spike plant / defuse (§11.4) -----------------------------------------
  // A plant is possible only if attackers held a man-advantage at some point.
  let planted = false;
  if (attackersGainedAdvantage) {
    planted = rng.chance(BALANCE.PLANT_BASE_CHANCE);
  }

  if (planted) {
    if (winnerSide === 'atk') {
      endCondition = 'spike';
    } else {
      endCondition = 'defuse';
    }
  }

  // --- Clutch player (§11.5): last-alive winner vs >=1 enemy -----------------
  // The winning side won while reduced to a single survivor, and the losing side
  // still had at least one player when that last duel began. We detect it from
  // the final alive counts plus the final winning event's killer being the lone
  // survivor on the winning side.
  const winnerAlive = winnerSide === 'atk' ? aliveAtk : aliveDef;
  const loserStartCount = winnerSide === 'atk' ? startDef : startAtk;
  if (winnerAlive.length === 1 && events.length > 0 && loserStartCount >= 1) {
    // The last kill by the winning side identifies the clutcher. Find the last
    // event whose killerSide === winnerSide and whose killer is the lone survivor.
    const survivor = winnerAlive[0];
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.killerSide === winnerSide && ev.killerId === survivor) {
        clutchPlayerId = survivor;
        break;
      }
    }
  }

  // --- Map sides back to teams for the RoundLog -----------------------------
  const winnerTeam = winnerSide === sideByTeam.A ? 'A' : 'B';

  const killsByTeam = { A: 0, B: 0 };
  for (const ev of events) {
    const team = ev.killerSide === sideByTeam.A ? 'A' : 'B';
    killsByTeam[team] += 1;
  }

  const aliveEnd = {
    A: sideByTeam.A === 'atk' ? aliveEndAtk : aliveEndDef,
    B: sideByTeam.B === 'atk' ? aliveEndAtk : aliveEndDef
  };

  const econTypeByTeam = {
    A: sideByTeam.A === 'atk' ? atkEconType : defEconType,
    B: sideByTeam.B === 'atk' ? atkEconType : defEconType
  };

  return {
    n,
    winnerSide,
    winnerTeam,
    endCondition,
    economy: {
      A: { type: econTypeByTeam.A, credits: econByTeam.A ? econByTeam.A.credits : 0 },
      B: { type: econTypeByTeam.B, credits: econByTeam.B ? econByTeam.B.credits : 0 }
    },
    events,
    aliveEnd,
    planted,
    clutchPlayerId
  };
}
