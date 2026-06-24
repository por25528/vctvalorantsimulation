/**
 * engine/match/boxScore.js — per-map box-score tallying (CONTRACTS §9, §10, §11).
 *
 * Responsibility: turn a stream of RoundLogs into per-player PlayerMapStat
 * records, then finalize derived ratings (acs/kd/kast/adr) and pick the MVP.
 *
 * Pure & immutable: every exported function returns a brand-new box object and
 * never mutates its inputs (CONTRACTS §15). All randomness flows through the
 * injected Rng (CONTRACTS §1); no global RNG, wall-clock, or DOM. All tuning
 * numbers come from config/balance.js — no magic numbers here.
 *
 * Runs unchanged in Node and the browser (plain ES modules, named exports).
 */

import { BALANCE } from '../../config/balance.js';

/**
 * @typedef {import('../../config/balance.js').Balance} Balance
 */

/**
 * @typedef DuelEvent
 * @property {number} round
 * @property {string} killerId
 * @property {string} victimId
 * @property {'atk'|'def'} killerSide
 * @property {boolean} isFirstBlood
 * @property {boolean} isTrade
 * @property {boolean} isClutchKill
 * @property {string[]} assistIds   candidate alive teammates of the killer
 */

/**
 * @typedef RoundLog
 * @property {number} n
 * @property {'atk'|'def'} winnerSide
 * @property {'A'|'B'} winnerTeam
 * @property {'elim'|'spike'|'defuse'|'time'} endCondition
 * @property {{ A:{type:string,credits:number}, B:{type:string,credits:number} }} economy
 * @property {DuelEvent[]} events
 * @property {{A:number,B:number}} aliveEnd
 * @property {boolean} planted
 * @property {string|null} clutchPlayerId
 */

/**
 * @typedef PlayerMapStat
 * @property {string} playerId
 * @property {number} kills
 * @property {number} deaths
 * @property {number} assists
 * @property {number} firstBloods
 * @property {number} firstDeaths
 * @property {number} tradeKills
 * @property {number} clutches
 * @property {number} plants
 * @property {number} defuses
 * @property {number} roundsPlayed
 * @property {number} acs
 * @property {number} adr
 * @property {number} kast    fraction 0..1 of rounds with K/A/S/T impact
 * @property {number} kd
 */

/**
 * Assist-attribution tunables (sourced from config/balance.js — no magic numbers
 * here). Assists are RARE per kill: a kill grants AT MOST MAX_PER_KILL assists,
 * the first gated by a utility-lifted base chance and the (rarer) second by its
 * own chance. WHO is credited is utility-weighted among the alive teammates, but
 * every candidate stays eligible (no zero weights). This keeps per-player assists
 * realistic (~2-12 over a map) and team assists ~30-70% of team kills, instead of
 * the prior "every kill yields two assists" over-count.
 */
const ASSIST = Object.freeze({
  // Max distinct assists credited per kill (Valorant tops out around 2).
  MAX_PER_KILL: BALANCE.ASSIST_MAX_PER_KILL,
  // P(at least one assist) at neutral utility, before the utility lift.
  CHANCE_BASE: BALANCE.ASSIST_CHANCE_BASE,
  // *(bestUtility/100) added to the first-assist chance.
  CHANCE_UTILITY: BALANCE.ASSIST_CHANCE_UTILITY,
  // P(a second, distinct assist) once the first has landed.
  CHANCE_SECOND: BALANCE.ASSIST_CHANCE_SECOND,
  // Base pick weight so a 0-utility teammate is still a possible assister.
  WEIGHT_BASE: BALANCE.ASSIST_WEIGHT_BASE,
  // Utility (0..100) contribution to a candidate's pick weight.
  WEIGHT_UTILITY: BALANCE.ASSIST_WEIGHT_UTILITY
});

/**
 * Heuristics for finalize() approximations. ADR is reconstructed from kills,
 * KAST from per-round impact already tallied during accumulate.
 */
const FINALIZE = Object.freeze({
  // Approx average damage a kill represents (a downed enemy ~ full HP bar).
  ADR_PER_KILL: 130,
  // Assists imply meaningful chip damage toward a kill.
  ADR_PER_ASSIST: 40
});

/**
 * Create a zeroed PlayerMapStat. Object shape is fixed (stable key order) so
 * deep-equality and serialization stay deterministic.
 * @param {string} playerId
 * @returns {PlayerMapStat}
 */
function zeroStat(playerId) {
  return {
    playerId,
    kills: 0,
    deaths: 0,
    assists: 0,
    firstBloods: 0,
    firstDeaths: 0,
    tradeKills: 0,
    clutches: 0,
    plants: 0,
    defuses: 0,
    roundsPlayed: 0,
    acs: 0,
    adr: 0,
    kast: 0,
    kd: 0
  };
}

/**
 * Build a fresh box score: one zeroed PlayerMapStat per roster id.
 * @param {string[]} rosterIds
 * @returns {Record<string, PlayerMapStat>}
 */
export function createBoxScore(rosterIds) {
  /** @type {Record<string, PlayerMapStat>} */
  const box = {};
  const ids = Array.isArray(rosterIds) ? rosterIds : [];
  for (const id of ids) {
    if (id != null && !(id in box)) box[id] = zeroStat(id);
  }
  return box;
}

/**
 * Shallow-clone a box into a fresh, independently-mutable working copy. The
 * input box and its stat objects are never mutated.
 * @param {Record<string, PlayerMapStat>} box
 * @returns {Record<string, PlayerMapStat>}
 */
function cloneBox(box) {
  /** @type {Record<string, PlayerMapStat>} */
  const out = {};
  for (const id of Object.keys(box)) out[id] = { ...box[id] };
  return out;
}

/**
 * Ensure a stat row exists for `id` in the working box (players that appear in
 * a round log but were absent from the initial roster still get tallied).
 * @param {Record<string, PlayerMapStat>} box
 * @param {string} id
 * @returns {PlayerMapStat}
 */
function ensureRow(box, id) {
  let row = box[id];
  if (!row) {
    row = zeroStat(id);
    box[id] = row;
  }
  return row;
}

/**
 * Pick the assisters for ONE kill from the killer's candidate teammates.
 *
 * Assists are deliberately RARE (CONTRACTS §11 calls them probabilistic, not
 * guaranteed): most kills produce 0 assists, some 1, and a few 2 — never more
 * than MAX_PER_KILL. The per-kill flow:
 *   1. Decide IF a first assist happens: P = CHANCE_BASE + CHANCE_UTILITY *
 *      (bestUtility/100), clamped to [0,1]. Higher-utility supporting teammates
 *      make an assist more likely (they threw the util that set up the kill).
 *   2. If yes, pick WHO via a utility-weighted draw (every candidate eligible).
 *   3. With probability CHANCE_SECOND, and only if another candidate remains,
 *      credit a second, distinct assist (also utility-weighted).
 *
 * Candidates may be plain id strings or `{ id, utility }` objects (roundSim
 * attaches utility); plain ids fall back to neutral utility. Each rng draw uses
 * the injected Rng in a fixed order so the result is fully deterministic.
 *
 * @param {Array<string|{id:string,utility?:number}>} candidates
 * @param {import('../../core/rng.js').Rng} rng
 * @returns {string[]} chosen assister ids (length 0..MAX_PER_KILL, distinct)
 */
function chooseAssisters(candidates, rng) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  // Normalize to { id, utility } and drop blanks.
  /** @type {Array<{id:string,utility:number}>} */
  let pool = [];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'string') {
      pool.push({ id: c, utility: 0 });
    } else if (typeof c.id === 'string') {
      const u = typeof c.utility === 'number' && Number.isFinite(c.utility) ? c.utility : 0;
      pool.push({ id: c.id, utility: u });
    }
  }
  if (pool.length === 0) return [];

  // Best alive-teammate utility lifts the first-assist chance.
  let bestUtility = 0;
  for (const p of pool) if (p.utility > bestUtility) bestUtility = p.utility;
  const firstChance = clamp01(ASSIST.CHANCE_BASE + ASSIST.CHANCE_UTILITY * (bestUtility / 100));

  // Gate #1: does this kill produce ANY assist? (consumes one rng draw)
  if (!rng.chance(firstChance)) return [];

  const weightFn = (item) => ASSIST.WEIGHT_BASE + ASSIST.WEIGHT_UTILITY * (item.utility / 100);

  /** @type {string[]} */
  const chosen = [];
  const first = rng.weightedPick(pool, weightFn);
  if (!first) return [];
  chosen.push(first.id);
  pool = pool.filter((p) => p.id !== first.id);

  // Gate #2: a rare second, distinct assist (capped by MAX_PER_KILL).
  if (chosen.length < ASSIST.MAX_PER_KILL && pool.length > 0) {
    if (rng.chance(ASSIST.CHANCE_SECOND)) {
      const second = rng.weightedPick(pool, weightFn);
      if (second) chosen.push(second.id);
    }
  }

  return chosen;
}

/**
 * Apply one round's events to the box and return a NEW box (CONTRACTS §11):
 *  - tally kills/deaths/firstBloods/firstDeaths/tradeKills/clutches/plants/defuses,
 *  - assign assists probabilistically (utility-weighted) to alive teammates of
 *    the killer using the injected rng,
 *  - increment roundsPlayed for every tracked player,
 *  - record per-round KAST impact for finalize().
 *
 * @param {Record<string, PlayerMapStat>} box
 * @param {RoundLog} roundLog
 * @param {import('../../core/rng.js').Rng} rng
 * @returns {Record<string, PlayerMapStat>} new box
 */
export function accumulate(box, roundLog, rng) {
  const next = cloneBox(box);
  const events = roundLog && Array.isArray(roundLog.events) ? roundLog.events : [];

  // Track which players had a KAST-qualifying impact THIS round (kill, assist,
  // survived, or were traded). Survival is inferred: a player who died this
  // round but whose death was traded still counts toward KAST.
  /** @type {Set<string>} */
  const impacted = new Set();
  /** @type {Set<string>} */
  const diedThisRound = new Set();
  /** @type {Set<string>} */
  const tradedVictims = new Set();

  for (const ev of events) {
    if (!ev) continue;
    const killerId = ev.killerId;
    const victimId = ev.victimId;

    if (typeof killerId === 'string') {
      const k = ensureRow(next, killerId);
      k.kills += 1;
      if (ev.isFirstBlood) k.firstBloods += 1;
      if (ev.isTrade) k.tradeKills += 1;
      impacted.add(killerId);
    }

    if (typeof victimId === 'string') {
      const v = ensureRow(next, victimId);
      v.deaths += 1;
      if (ev.isFirstBlood) v.firstDeaths += 1;
      diedThisRound.add(victimId);
    }

    // A traded kill means the *prior* victim got avenged: the killer of THIS
    // trade event killed the player who killed someone. We mark the just-slain
    // killer's earlier victim as traded for KAST. Simpler robust rule: any
    // victim of a trade event is considered to have been part of a trade exchange.
    if (ev.isTrade && typeof victimId === 'string') {
      tradedVictims.add(victimId);
    }

    // Assist attribution: prefer explicit candidate metadata on the event;
    // assign probabilistically (utility-weighted) via rng.
    const candidates = Array.isArray(ev.assistIds) ? ev.assistIds : [];
    const assisters = chooseAssisters(candidates, rng);
    for (const aId of assisters) {
      if (aId === killerId) continue; // killer cannot assist itself
      const a = ensureRow(next, aId);
      a.assists += 1;
      impacted.add(aId);
    }
  }

  // Clutch credit: the round's clutch player (won while last-alive vs >=1 enemy).
  const clutchId = roundLog ? roundLog.clutchPlayerId : null;
  if (typeof clutchId === 'string') {
    ensureRow(next, clutchId).clutches += 1;
    impacted.add(clutchId);
  }

  // Plant / defuse credit. RoundLog carries planted + endCondition; CONTRACTS
  // does not pin the exact planter/defuser id, so credit the clutch/decisive
  // player when identifiable, otherwise leave plants/defuses for a richer log.
  if (roundLog && roundLog.planted && typeof roundLog.planterId === 'string') {
    ensureRow(next, roundLog.planterId).plants += 1;
  }
  if (roundLog && typeof roundLog.defuserId === 'string') {
    ensureRow(next, roundLog.defuserId).defuses += 1;
  }

  // roundsPlayed for every tracked player; KAST credit for survivors + impact.
  for (const id of Object.keys(next)) {
    const row = next[id];
    row.roundsPlayed += 1;

    const survived = !diedThisRound.has(id);
    const traded = tradedVictims.has(id);
    if (survived || traded || impacted.has(id)) {
      // Stash KAST hits on a transient field; finalize converts to a fraction.
      row.__kastHits = (row.__kastHits || 0) + 1;
    }
  }

  return next;
}

/**
 * Compute derived ratings on a copy of the box and return a NEW box:
 *  - acs  = (ACS_KILL*kills + ACS_ASSIST*assists + ACS_PER_DUEL_BONUS*firstBloods)
 *           / roundsPlayed   (per-round Average Combat Score approximation)
 *  - kd   = kills / max(1, deaths)
 *  - kast = fraction of rounds with a Kill/Assist/Survive/Trade impact
 *  - adr  = approximate average damage per round from kills + assists
 *
 * `totalRounds` is the map's true round count, used as the KAST/ADR denominator
 * so a player benched mid-map (fewer roundsPlayed) isn't over-credited; it falls
 * back to the player's own roundsPlayed when not supplied.
 *
 * @param {Record<string, PlayerMapStat>} box
 * @param {number} totalRounds
 * @returns {Record<string, PlayerMapStat>} new box
 */
export function finalize(box, totalRounds) {
  const next = cloneBox(box);
  const tr = typeof totalRounds === 'number' && totalRounds > 0 ? totalRounds : 0;

  for (const id of Object.keys(next)) {
    const row = next[id];
    const kastHits = row.__kastHits || 0;
    delete row.__kastHits;

    const denom = tr > 0 ? tr : row.roundsPlayed;
    const rounds = denom > 0 ? denom : 1;

    row.acs = round2(
      (BALANCE.ACS_KILL * row.kills +
        BALANCE.ACS_ASSIST * row.assists +
        BALANCE.ACS_PER_DUEL_BONUS * row.firstBloods) /
        rounds
    );
    row.kd = round2(row.kills / Math.max(1, row.deaths));
    row.kast = round2(clamp01(kastHits / rounds));
    row.adr = round2(
      (FINALIZE.ADR_PER_KILL * row.kills + FINALIZE.ADR_PER_ASSIST * row.assists) / rounds
    );
  }

  return next;
}

/**
 * Pick the MVP: the player with the highest acs. Ties broken deterministically
 * by kills, then firstBloods, then playerId (lexicographic) so the result never
 * depends on object key order or randomness.
 * @param {Record<string, PlayerMapStat>} box
 * @returns {string|null} winning playerId, or null for an empty box
 */
export function pickMvp(box) {
  /** @type {PlayerMapStat|null} */
  let best = null;
  for (const id of Object.keys(box)) {
    const row = box[id];
    if (best === null || betterMvp(row, best)) best = row;
  }
  return best ? best.playerId : null;
}

/**
 * Deterministic MVP comparison: acs, then kills, then firstBloods, then id.
 * @param {PlayerMapStat} a
 * @param {PlayerMapStat} b
 * @returns {boolean} true if `a` outranks `b`
 */
function betterMvp(a, b) {
  if (a.acs !== b.acs) return a.acs > b.acs;
  if (a.kills !== b.kills) return a.kills > b.kills;
  if (a.firstBloods !== b.firstBloods) return a.firstBloods > b.firstBloods;
  return a.playerId < b.playerId;
}

/**
 * Clamp to [0,1].
 * @param {number} x
 * @returns {number}
 */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Round to 2 decimals (keeps ratings tidy & deep-equality stable).
 * @param {number} x
 * @returns {number}
 */
function round2(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}
