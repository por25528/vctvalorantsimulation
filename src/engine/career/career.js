/**
 * engine/career/career.js — multi-season career orchestration (CONTRACTS-CAREER §3).
 * Phase 6. Ties the pure season engine (P1–P4) and the off-season pipeline (P6b)
 * into a living, multi-season career, and is the place in-season DYNAMICS finally
 * MOVE: after each calendar slot resolves, every player's form/morale/fatigue is
 * evolved from how they actually performed, so the NEXT slot is played with the
 * updated world (the match engine already reads dynamics — see duel.js).
 *
 * DETERMINISM is preserved end-to-end: `simSeason`/`advanceSeason` stay pure over
 * the world handed to them; this layer only THREADS an evolving world between
 * slots/seasons. All career randomness flows from `hashSeed(seed, …)` →
 * `createRng`, so `simCareer(seed, n)` is fully reproducible.
 *
 * Flow per slot (advanceCareerSlot):
 *   advanceSeason ONE slot on state.world  →  evolve dynamics from the slot's box
 *   scores  →  next world. When the slot COMPLETES the season: summarize it, run
 *   runOffseason (aging/retire/newgen/contracts/transfers), rest the squads for the
 *   long break, init the next season on the reshaped world, seasonIndex++.
 *
 * @typedef {import('./offseason.js').OffseasonReport} OffseasonReport
 * @typedef {import('./awards.js').SeasonAwards} SeasonAwards
 * @typedef {Object} SeasonSummary
 * @property {number} seasonIndex
 * @property {number|string} seed
 * @property {string} champion
 * @property {string[]} championsField
 * @property {string[]} finalStandings
 * @property {SeasonAwards} awards
 *
 * @typedef {Object} CareerState
 * @property {number|string} seed
 * @property {number} seasonIndex
 * @property {object} world                 // engine World { leagues, teamsById, playersById }
 * @property {object} season                // the live SeasonState
 * @property {SeasonSummary[]} history       // completed seasons, in order
 * @property {OffseasonReport|null} offseason  // the most recent off-season report
 * @property {'inSeason'} phase
 */

import { buildWorld } from '../../data/seed/index.js';
import { hashSeed } from '../../core/hash.js';
import { createRng } from '../../core/rng.js';
import { BALANCE } from '../../config/balance.js';
import { clamp, num } from './playerStats.js';
import { initSeason, advanceSeason, seasonToResult } from './season.js';
import { runOffseason } from './offseason.js';
import { salaryFor } from './offseason/contracts.js';
import { updateDynamics, recoverBetweenEvents } from './dynamics.js';
import { computeSeasonAwards } from './awards.js';
import { tickInjury, rollInjury, injuredFatigue } from './injuries.js';
import { applySeasonEconomy } from './economy.js';
import { applySeasonReputation, seedInitialReputation } from './reputation.js';
import { seasonSuccessScore } from './attractiveness.js';
import { seedCoaches, runStaff, makeCoachNegoOf } from './staff.js';
import { driftChemistry } from './chemistry.js';

const D = BALANCE.CAREER.DYNAMICS;
const CL = BALANCE.CAREER.CONTRACT;

/* --------------------------- seed derivation ----------------------------- */

const seasonSeed = (seed, idx) => hashSeed(seed, 'season', idx);
const offseasonSeed = (seed, idx) => hashSeed(seed, 'offseason', idx);
const injurySeed = (seed, seasonIdx, slotIdx) => hashSeed(seed, 'injury', seasonIdx, slotIdx);

/* ------------------------------ lifecycle -------------------------------- */

/**
 * Start a fresh career: build the 48-team world, stagger seed contract expiries
 * (so they don't all come up at once — see CONTRACTS-CAREER §1.5 note), and init
 * the first season.
 *
 * @param {number|string} seed
 * @returns {CareerState}
 */
export function initCareer(seed) {
  let world = staggerContracts(buildWorld(), createRng(hashSeed(seed, 'contracts-init')));
  // P13: day-one prestige from roster strength, then a head coach for every club.
  world = seedInitialReputation(world);
  world = seedCoaches(world, createRng(hashSeed(seed, 'coaches-init')));
  const season = initSeason(world, seasonSeed(seed, 0));
  return Object.freeze({
    seed,
    seasonIndex: 0,
    world,
    season,
    history: Object.freeze([]),
    offseason: null,
    phase: 'inSeason'
  });
}

/**
 * Play exactly one calendar slot, evolving dynamics from the results. When the
 * slot completes the season, the state enters phase 'offseason' (the season is
 * left finished, champion crowned) WITHOUT rolling forward — the caller resolves
 * the break via {@link runCareerOffseason}. Immutable. A no-op while already in
 * the 'offseason' phase.
 *
 * @param {CareerState} state
 * @returns {CareerState}
 */
export function advanceCareerSlot(state) {
  if (!state || !state.season) {
    throw new Error('advanceCareerSlot: a CareerState with a live season is required');
  }
  if (state.phase === 'offseason') return state; // resolve the off-season first

  const playedCount = state.season.events.length;
  const nextSeason = advanceSeason(state.season, state.world);
  const newEvents = nextSeason.events.slice(playedCount);

  // Evolve form/morale/fatigue from how players actually did this slot, and
  // resolve injuries (seeded per slot, so the same career is reproducible).
  const injRng = createRng(injurySeed(state.seed, state.seasonIndex, state.season.slotIndex));
  const evolvedWorld = applyInSeasonDynamics(state.world, newEvents, injRng);

  return Object.freeze({
    ...state,
    world: evolvedWorld,
    season: nextSeason,
    phase: nextSeason.complete ? 'offseason' : 'inSeason'
  });
}

/**
 * Resolve the off-season after a season has completed: summarize the year, run
 * the off-season pipeline (aging/retire/newgen/contracts/transfers), rest the
 * squads for the break, and init the next season. Immutable; requires the
 * 'offseason' phase.
 *
 * @param {CareerState} state
 * @param {{ protectTeamId?:string|null }} [opts]  protectTeamId: the user's club, shielded from AI buy/sell raids
 * @returns {CareerState}
 */
export function runCareerOffseason(state, opts = {}) {
  if (!state || state.phase !== 'offseason') {
    throw new Error('runCareerOffseason: the season must be complete (phase "offseason")');
  }
  const summary = summarizeSeason(state.season, state.seasonIndex, state.world);
  // P13: reputation MOVES with the season's results first, so the new prestige
  // feeds this off-season's sponsor income, the transfer pecking order, and the
  // pull a club exerts on talent. Deterministic (no rng); only `reputation` changes.
  const { world: repWorld } = applySeasonReputation(state.world, state.season);
  // Season P&L: prize money + (reputation-scaled) sponsor in, wages out, so the
  // new season's teams carry their updated reserves (now read by the AI market).
  const econWorld = applySeasonEconomy(repWorld, state.season);
  // P13 staff step: coachless clubs may hire, coaches are paid + lift chemistry —
  // BEFORE the market so their negotiation rating shapes the fees they pay.
  const staffRng = createRng(hashSeed(state.seed, 'staff', state.seasonIndex));
  const { world: staffedWorld } = runStaff(econWorld, staffRng);
  const coachNegoOf = makeCoachNegoOf(staffedWorld);
  const osRng = createRng(offseasonSeed(state.seed, state.seasonIndex));
  // Recent on-stage success feeds the market: last year's winners are more
  // attractive to talent (memoized per team over the just-finished season).
  const successCache = new Map();
  const successOf = (teamId) => {
    if (!successCache.has(teamId)) successCache.set(teamId, seasonSuccessScore(state.season, teamId));
    return successCache.get(teamId);
  };
  const { world: postWorld, report } = runOffseason(staffedWorld, osRng, {
    season: state.seasonIndex, successOf, coachNegoOf, protectTeamId: opts.protectTeamId || null
  });
  const restedWorld = restForNewSeason(postWorld);
  const nextIndex = state.seasonIndex + 1;

  return Object.freeze({
    seed: state.seed,
    seasonIndex: nextIndex,
    world: restedWorld,
    season: initSeason(restedWorld, seasonSeed(state.seed, nextIndex)),
    history: Object.freeze([...state.history, summary]),
    offseason: report,
    phase: 'inSeason'
  });
}

/**
 * One unified career step for a UI "Continue": resolve the pending off-season if
 * the season just ended, otherwise play the next slot.
 *
 * @param {CareerState} state
 * @returns {CareerState}
 */
export function advanceCareer(state, opts = {}) {
  return state && state.phase === 'offseason' ? runCareerOffseason(state, opts) : advanceCareerSlot(state);
}

/**
 * Run a whole career headlessly: N full seasons. Deterministic from `seed`.
 *
 * @param {number|string} seed
 * @param {number} nSeasons
 * @returns {{ history:SeasonSummary[], finalWorld:object, state:CareerState }}
 */
export function simCareer(seed, nSeasons) {
  const target = Math.max(0, Math.floor(num(nSeasons, 1)));
  let state = initCareer(seed);
  // Guard against pathological non-termination (8 slots + 1 off-season / season).
  let guard = 0;
  const cap = target * 18 + 16;
  while (state.history.length < target && guard < cap) {
    state = advanceCareer(state);
    guard += 1;
  }
  return { history: state.history, finalWorld: state.world, state };
}

/* ------------------------- in-season dynamics ---------------------------- */

/**
 * Build per-player {won, mapsPlayed, performance} from a slot's events. `won` is a
 * winning map record across the slot; `performance` is the player's mean ACS
 * normalized to the slot's mean ACS (so ~1.0 is an average showing), clamped.
 *
 * @param {Array<object>} events  the SeasonEventEntry[] played this slot
 * @param {object} world          for roster→side lookup
 * @returns {Map<string, {won:boolean, mapsPlayed:number, performance:number}>}
 */
function computeSlotOutcomes(events, world) {
  /** @type {Map<string, {acsSum:number, maps:number, won:number, lost:number}>} */
  const acc = new Map();
  let acsSum = 0;
  let acsCount = 0;

  for (const ev of events) {
    const series = (ev && ev.result && ev.result.series) || [];
    for (const s of series) {
      const teamA = world.teamsById[s.teamAId];
      const teamB = world.teamsById[s.teamBId];
      const sideA = new Set((teamA && teamA.roster) || []);
      const sideB = new Set((teamB && teamB.roster) || []);
      for (const m of (s.maps || [])) {
        const box = m.boxScore || {};
        for (const pid of Object.keys(box)) {
          const side = sideA.has(pid) ? 'A' : sideB.has(pid) ? 'B' : null;
          if (!side) continue; // a sub / unknown — skip
          const stat = box[pid];
          const a = acc.get(pid) || { acsSum: 0, maps: 0, won: 0, lost: 0 };
          a.acsSum += num(stat.acs, 0);
          a.maps += 1;
          if (m.winner === side) a.won += 1;
          else a.lost += 1;
          acc.set(pid, a);
          acsSum += num(stat.acs, 0);
          acsCount += 1;
        }
      }
    }
  }

  const baseAcs = acsCount > 0 ? acsSum / acsCount : 1;
  /** @type {Map<string, {won:boolean, mapsPlayed:number, performance:number}>} */
  const out = new Map();
  for (const [pid, a] of acc) {
    const avgAcs = a.maps > 0 ? a.acsSum / a.maps : baseAcs;
    const performance = baseAcs > 0 ? clamp(avgAcs / baseAcs, D.PERF_ACS_MIN, D.PERF_ACS_MAX) : 1;
    out.set(pid, { won: a.won > a.lost, mapsPlayed: a.maps, performance });
  }
  return out;
}

/**
 * Per-team map record for a slot: did the team win more maps than it lost?
 * Drives team-chemistry drift (winning together gels a roster).
 * @param {Array<object>} events
 * @returns {Map<string, {won:boolean}>}
 */
function computeTeamOutcomes(events) {
  /** @type {Map<string, {w:number, l:number}>} */
  const acc = new Map();
  const bump = (id, won) => {
    if (!id) return;
    const a = acc.get(id) || { w: 0, l: 0 };
    if (won) a.w += 1; else a.l += 1;
    acc.set(id, a);
  };
  for (const ev of events) {
    const series = (ev && ev.result && ev.result.series) || [];
    for (const s of series) {
      for (const m of (s.maps || [])) {
        if (m.winner === 'A') { bump(s.teamAId, true); bump(s.teamBId, false); }
        else if (m.winner === 'B') { bump(s.teamBId, true); bump(s.teamAId, false); }
      }
    }
  }
  /** @type {Map<string, {won:boolean}>} */
  const out = new Map();
  for (const [id, a] of acc) out.set(id, { won: a.w >= a.l });
  return out;
}

/**
 * Apply one slot's dynamics evolution to the world: players who played get
 * `updateDynamics` (accumulate the slot's effect), then EVERYONE gets
 * `recoverBetweenEvents` (the rest before the next slot). Retired players are
 * left untouched. Teams that played this slot also drift their chemistry from the
 * slot's map record (P12.2). Returns a new frozen World.
 *
 * @param {object} world
 * @param {Array<object>} newEvents
 * @returns {object}
 */
function applyInSeasonDynamics(world, newEvents, rng) {
  const outcomes = computeSlotOutcomes(newEvents, world);
  const teamOutcomes = computeTeamOutcomes(newEvents);
  /** @type {Record<string, object>} */
  const players = {};
  for (const id of Object.keys(world.playersById)) {
    const p = world.playersById[id];
    if (p.contract && p.contract.status === 'retired') {
      players[id] = p;
      continue;
    }
    let dyn = p.dynamics;
    const o = outcomes.get(id);
    if (o) dyn = updateDynamics({ dynamics: dyn }, o);
    dyn = recoverBetweenEvents({ dynamics: dyn });

    // Injuries: heal an existing one a step; then a player who FEATURED this slot
    // may pick up a new knock (seeded). While injured, pin fatigue high so the
    // match engine's dynamics read makes them play hurt (no roster change).
    let injury = tickInjury(p.injury || null);
    if (o && !injury && rng) {
      injury = rollInjury(p, dyn, o.mapsPlayed, rng);
    }
    if (injury) dyn = { ...dyn, fatigue: injuredFatigue(dyn.fatigue) };

    players[id] = Object.freeze({ ...p, dynamics: dyn, injury });
  }

  // Drift team chemistry from the slot's map record (only teams that played).
  /** @type {Record<string, object>} */
  let teamsById = world.teamsById;
  if (teamOutcomes.size > 0) {
    teamsById = {};
    for (const id of Object.keys(world.teamsById)) {
      const t = world.teamsById[id];
      const o = teamOutcomes.get(id);
      teamsById[id] = o
        ? Object.freeze({ ...t, chemistry: driftChemistry(t.chemistry, o) })
        : t;
    }
    teamsById = Object.freeze(teamsById);
  }

  return Object.freeze({
    leagues: world.leagues,
    teamsById,
    playersById: Object.freeze(players)
  });
}

/* ------------------------- season transitions ---------------------------- */

/**
 * Rest every (non-retired) player over the off-season: fatigue and form reset,
 * morale drifts toward its base. A fresh competitive slate for the new year.
 * @param {object} world
 * @returns {object}
 */
function restForNewSeason(world) {
  /** @type {Record<string, object>} */
  const players = {};
  for (const id of Object.keys(world.playersById)) {
    const p = world.playersById[id];
    if (p.contract && p.contract.status === 'retired') {
      players[id] = p;
      continue;
    }
    const morale = num(p.dynamics && p.dynamics.morale, D.MORALE_BASE);
    players[id] = Object.freeze({
      ...p,
      dynamics: { form: 0, morale: clamp(morale + D.OFFSEASON_MORALE_REVERT * (D.MORALE_BASE - morale), 0, 100), fatigue: 0 },
      injury: null // the long off-season break heals every knock
    });
  }
  return Object.freeze({
    leagues: world.leagues,
    teamsById: world.teamsById,
    playersById: Object.freeze(players)
  });
}

/**
 * Build a SeasonSummary from a completed SeasonState. Attaches the season's
 * awards (computed from its box scores against `world`) so completed seasons
 * carry their MVP/All-Pro/etc. in `history`. Pure & deterministic.
 * @param {object} season
 * @param {number} seasonIndex
 * @param {object} world  World { playersById, teamsById } (for award identity)
 * @returns {SeasonSummary}
 */
function summarizeSeason(season, seasonIndex, world) {
  const result = seasonToResult(season);
  return Object.freeze({
    seasonIndex,
    seed: season.seed,
    champion: result.champion,
    championsField: result.championsField,
    finalStandings: result.finalStandings,
    // Per-event winners (rank 1) so a team's trophy cabinet survives across
    // seasons (history is persisted; only round logs are stripped).
    eventWinners: Object.freeze((season.events || []).map((e) =>
      Object.freeze({
        slotId: e.slotId,
        region: e.region || null,
        type: e.type,
        eventId: (e.result && e.result.eventId) || e.slotId,
        winner: rank1Of(e.result)
      })
    )),
    awards: computeSeasonAwards(season, world || { playersById: {}, teamsById: {} })
  });
}

/** The rank-1 teamId of an EventResult, or null. */
function rank1Of(result) {
  const top = result && Array.isArray(result.placements) ? result.placements.find((p) => p.rank === 1) : null;
  return top ? top.teamId : null;
}

/* ----------------------------- seed contracts ---------------------------- */

/**
 * Give every rostered player a staggered contract expiry (1–LENGTH_MAX seasons
 * out) so renewals spread across future off-seasons instead of all firing in
 * off-season 0. Returns a new frozen World; the input is not mutated.
 *
 * @param {object} world
 * @param {import('../../core/rng.js').Rng} rng
 * @returns {object}
 */
function staggerContracts(world, rng) {
  /** @type {Record<string, object>} */
  const players = { ...world.playersById };
  for (const tId of Object.keys(world.teamsById)) {
    const team = world.teamsById[tId];
    for (const pid of team.roster) {
      const p = players[pid];
      if (!p) continue;
      const expires = 1 + rng.int(CL.LENGTH_MAX); // 1..LENGTH_MAX
      // Give seed players a market-rate salary too (deterministic, pure) so the
      // sponsor economy has real wage bills from season 0, not just after the
      // first off-season's contract renewals.
      const salary = p.contract && p.contract.salary > 0 ? p.contract.salary : salaryFor(p);
      players[pid] = Object.freeze({
        ...p,
        contract: { ...p.contract, teamId: tId, status: 'active', expires, salary }
      });
    }
  }
  return Object.freeze({
    leagues: world.leagues,
    teamsById: world.teamsById,
    playersById: Object.freeze(players)
  });
}
