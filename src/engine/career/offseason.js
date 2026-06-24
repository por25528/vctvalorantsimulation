/**
 * engine/career/offseason.js — the off-season pipeline (CONTRACTS-CAREER §2).
 * Phase 6. Chains the pure mechanics into ONE world transition + a report:
 *
 *   develop (age+1 & attribute drift, all non-retired)
 *     → retire (age/morale/overall-gated; free the roster slot)
 *     → newgen (mint youth free agents, sized to cover the holes)
 *     → contracts (renew/release every expiring rostered player)
 *     → transfers (AI market fills holes + a bounded upgrade pass)
 *     → safety net (mint emergency youth so every roster is ≥ MIN_ROSTER)
 *     → reconcile (rostered ⇒ contract.teamId set, status 'active')
 *
 * Pure & rng-injected: the input World is never mutated; the next World and the
 * OffseasonReport are frozen; the same (world, seed, season) always reproduces the
 * same transition. The season/match engines are NOT involved — this only reshapes
 * the World handed to the next season. Constants from BALANCE.CAREER.MARKET.
 *
 * @typedef {import('./offseason/transfers.js').Move} Move
 * @typedef {Object} OffseasonReport
 * @property {number} season
 * @property {Array<{id:string, trajectory:number}>} developed  // notable movers (risers first)
 * @property {string[]} retired
 * @property {string[]} newgens
 * @property {{ renewed:string[], released:string[] }} contracts
 * @property {Move[]} transfers
 */

import { BALANCE } from '../../config/balance.js';
import { num } from './playerStats.js';
import { developPlayer } from './offseason/development.js';
import { decideRetirement } from './offseason/retirement.js';
import { generateNewgens } from './offseason/newgen.js';
import { resolveContract, salaryFor } from './offseason/contracts.js';
import { runTransferMarket } from './offseason/transfers.js';

const M = BALANCE.CAREER.MARKET;
const CH = BALANCE.CAREER.CHEMISTRY;

/** Sum of roster shortfalls across all teams (holes to fill to MIN_ROSTER). */
function totalHoles(teams) {
  let holes = 0;
  for (const t of Object.values(teams)) holes += Math.max(0, M.MIN_ROSTER - t.roster.length);
  return holes;
}

/** Unique nationalities present in the world (so newgens look regionally plausible). */
function nationalityPool(world) {
  const set = new Set();
  for (const id of Object.keys(world.playersById)) {
    const nat = world.playersById[id].nationality;
    if (typeof nat === 'string' && nat) set.add(nat);
  }
  return set.size > 0 ? [...set] : ['INT'];
}

/**
 * Run one full off-season, returning the next season's World + a report.
 *
 * @param {{leagues:object, teamsById:object, playersById:object}} world
 * @param {import('../../core/rng.js').Rng} rng
 * @param {{ season?:number, successOf?:(teamId:string)=>number, coachNegoOf?:(teamId:string)=>number, protectTeamId?:string|null }} [opts]
 * @returns {{ world:object, report:OffseasonReport }}
 */
export function runOffseason(world, rng, opts = {}) {
  if (!world || typeof world !== 'object' || !world.teamsById || !world.playersById) {
    throw new Error('runOffseason: a World { leagues, teamsById, playersById } is required');
  }
  if (!rng || typeof rng.gaussian !== 'function') {
    throw new Error('runOffseason: an Rng is required');
  }
  const season = num(opts.season, 0);
  const natPool = nationalityPool(world);

  /** @type {Record<string, object>} */
  const players = { ...world.playersById };
  /** @type {Record<string, {id:string, roster:string[]}>} */
  const teams = {};
  for (const id of Object.keys(world.teamsById)) {
    const t = world.teamsById[id];
    teams[id] = { ...t, roster: t.roster.slice() };
  }

  /** Remove a player id from whichever roster holds it; return that team id. */
  function removeFromRosters(pid) {
    for (const t of Object.values(teams)) {
      const i = t.roster.indexOf(pid);
      if (i >= 0) {
        t.roster.splice(i, 1);
        return t.id;
      }
    }
    return null;
  }

  // ---- 1. develop ---------------------------------------------------------
  const developed = [];
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (p.contract && p.contract.status === 'retired') continue;
    const np = developPlayer(p, rng);
    players[id] = np;
    if (Math.abs(np.development.trajectory) >= M.REPORT_NOTABLE_TRAJECTORY) {
      developed.push({ id, trajectory: np.development.trajectory });
    }
  }

  // ---- 2. retire ----------------------------------------------------------
  const retired = [];
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (p.contract.status === 'retired') continue;
    if (decideRetirement(p, rng)) {
      players[id] = { ...p, contract: { teamId: null, salary: 0, expires: 0, status: 'retired' } };
      removeFromRosters(id);
      retired.push(id);
    }
  }

  // ---- 3. newgen (sized to comfortably cover the holes) -------------------
  const count = Math.max(M.NEWGEN_PER_OFFSEASON, totalHoles(teams) + M.NEWGEN_BUFFER);
  const newgenIds = [];
  for (const ng of generateNewgens(count, rng, { idPrefix: 'ng', season, nationalityPool: natPool })) {
    players[ng.id] = ng;
    newgenIds.push(ng.id);
  }

  // ---- 4. contracts (renew/release expiring rostered players) ------------
  const renewed = [];
  const released = [];
  for (const tId of Object.keys(teams)) {
    const team = teams[tId];
    for (const pid of team.roster.slice()) {
      const p = players[pid];
      if (!p || p.contract.status !== 'active') continue;
      if (num(p.contract.expires, 0) > season) continue; // not up yet
      const outcome = resolveContract(p, team, rng, { season });
      players[pid] = { ...p, contract: outcome };
      if (outcome.status === 'active') {
        renewed.push(pid);
      } else {
        removeFromRosters(pid);
        released.push(pid);
      }
    }
  }

  // ---- 5. transfer market -------------------------------------------------
  const interWorld = Object.freeze({
    leagues: world.leagues,
    teamsById: freezeTeams(teams),
    playersById: freezePlayers(players)
  });
  const { world: afterMarket, moves } = runTransferMarket(interWorld, rng, {
    season,
    successOf: opts.successOf,
    coachNegoOf: opts.coachNegoOf,
    protectTeamId: opts.protectTeamId
  });

  // ---- 6. safety net: guarantee every roster ≥ MIN_ROSTER ----------------
  /** @type {Record<string, object>} */
  const finalPlayers = { ...afterMarket.playersById };
  /** @type {Record<string, {id:string, roster:string[]}>} */
  const finalTeams = {};
  for (const id of Object.keys(afterMarket.teamsById)) {
    const t = afterMarket.teamsById[id];
    finalTeams[id] = { ...t, roster: t.roster.slice() };
  }

  const remaining = totalHoles(finalTeams);
  const emergencyMoves = [];
  if (remaining > 0) {
    const emg = generateNewgens(remaining, rng, { idPrefix: 'emg', season, nationalityPool: natPool });
    let k = 0;
    for (const tId of Object.keys(finalTeams)) {
      const t = finalTeams[tId];
      while (t.roster.length < M.MIN_ROSTER && k < emg.length) {
        const ng = emg[k];
        k += 1;
        const salary = salaryFor(ng);
        const signed = Object.freeze({ ...ng, contract: { teamId: t.id, salary, expires: season + 1, status: 'active' } });
        finalPlayers[ng.id] = signed;
        t.roster.push(ng.id);
        newgenIds.push(ng.id);
        emergencyMoves.push({ playerId: ng.id, fromTeamId: null, toTeamId: t.id, fee: 0, salary, kind: 'signing' });
      }
    }
  }

  // ---- 7. reconcile rostered ⇒ contract.teamId + active ------------------
  for (const tId of Object.keys(finalTeams)) {
    for (const pid of finalTeams[tId].roster) {
      const p = finalPlayers[pid];
      if (!p) continue;
      if (p.contract.teamId !== tId || p.contract.status !== 'active') {
        finalPlayers[pid] = Object.freeze({ ...p, contract: { ...p.contract, teamId: tId, status: 'active' } });
      }
    }
  }

  // ---- 7b. chemistry continuity (P12.2): carry the season's chemistry but
  //     dock NEW_SIGNING_PENALTY for each fresh face — a churned roster has to
  //     re-gel, a stable core keeps its edge.
  for (const tId of Object.keys(finalTeams)) {
    const prev = world.teamsById[tId];
    const prevRoster = new Set((prev && prev.roster) || []);
    const prevChem = prev && typeof prev.chemistry === 'number' ? prev.chemistry : CH.CHEM_BASE;
    let newcomers = 0;
    for (const pid of finalTeams[tId].roster) if (!prevRoster.has(pid)) newcomers += 1;
    finalTeams[tId].chemistry = Math.max(0, Math.min(100, prevChem - CH.NEW_SIGNING_PENALTY * newcomers));
  }

  const nextWorld = Object.freeze({
    leagues: world.leagues,
    teamsById: freezeTeams(finalTeams),
    playersById: freezePlayers(finalPlayers)
  });

  const report = Object.freeze({
    season,
    developed: Object.freeze(developed.sort((a, b) => b.trajectory - a.trajectory)),
    retired: Object.freeze(retired),
    newgens: Object.freeze(newgenIds),
    contracts: Object.freeze({ renewed: Object.freeze(renewed), released: Object.freeze(released) }),
    transfers: Object.freeze([...moves, ...emergencyMoves])
  });

  return { world: nextWorld, report };
}

/** Freeze a working team map into frozen Teams (rosters frozen too). */
function freezeTeams(teams) {
  /** @type {Record<string, object>} */
  const out = {};
  for (const id of Object.keys(teams)) {
    out[id] = Object.freeze({ ...teams[id], roster: Object.freeze(teams[id].roster.slice()) });
  }
  return Object.freeze(out);
}

/** Freeze a working player map (already-frozen entries pass through). */
function freezePlayers(players) {
  /** @type {Record<string, object>} */
  const out = {};
  for (const id of Object.keys(players)) {
    out[id] = Object.isFrozen(players[id]) ? players[id] : Object.freeze(players[id]);
  }
  return Object.freeze(out);
}
