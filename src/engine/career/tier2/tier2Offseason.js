/**
 * engine/career/tier2/tier2Offseason.js — the Tier-2 off-season + promotion pipeline.
 *
 * Runs after the T1 off-season each year, on the SEPARATE `world.tier2` namespace,
 * with its OWN injected rng (so it never perturbs the byte-identical T1 transition):
 *
 *   develop (age+1, attribute drift — reuses the T1 development curve)
 *     → retire (age/overall-gated; free the roster slot)
 *     → intake (mint young T2 free agents)
 *     → PROMOTION  : the strongest eligible T2 players rise into the T1 free-agent
 *                    pool (where the T1 market signs them next window); the weakest
 *                    surplus T1 free agents fall to T2 — a real two-way pipeline
 *     → fill (sign the best available T2 free agents into every hole)
 *     → safety net (mint emergency youth so every T2 roster is exactly ROSTER_SIZE)
 *     → reconcile (rostered ⇒ contract.teamId set, status 'active')
 *
 * Pure & rng-injected; inputs never mutated; outputs frozen. Constants from
 * BALANCE.CAREER.TIER2. Promotion eligibility/threshold tunables live there too.
 *
 * @typedef {Object} Tier2OffseasonReport
 * @property {number} season
 * @property {string[]} retired
 * @property {string[]} newgens
 * @property {string[]} promoted     // T2 player ids that rose into the T1 FA pool
 * @property {string[]} relegated    // T1 player ids that dropped into the T2 FA pool
 */

import { BALANCE } from '../../../config/balance.js';
import { overall, num, clamp } from '../playerStats.js';
import { developPlayer } from '../offseason/development.js';
import { decideRetirement } from '../offseason/retirement.js';
import { generateNewgens } from '../offseason/newgen.js';
import { salaryFor } from '../offseason/contracts.js';
import { REGION_ORDER } from '../qualification.js';

const T2 = BALANCE.CAREER.TIER2;

/* ------------------------------- valuation ------------------------------- */

/**
 * A simple T2 worth used to rank free agents for filling holes and to pick the
 * best promotion candidates: current ability plus youth-weighted upside (a 17-yo
 * with a high ceiling outranks a finished 26-yo of the same overall).
 * @param {object} p
 * @returns {number}
 */
function t2Value(p) {
  const o = overall(p);
  const upside = Math.max(0, num(p.potential, o) - o);
  const youth = clamp((T2.POT_HEADROOM_REF_AGE - num(p.age, 21)) / Math.max(1, T2.POT_HEADROOM_REF_AGE - T2.AGE_MIN), 0, 1);
  return o + 0.6 * upside * youth;
}

/** Is a T2 player good enough to be promotable to the T1 free-agent pool? */
function isPromotable(p) {
  return overall(p) >= T2.PROMOTE_OVERALL_MIN || num(p.potential, 0) >= T2.PROMOTE_POTENTIAL_MIN;
}

/* ------------------------------ freeze utils ----------------------------- */

function freezeTeams(teams) {
  /** @type {Record<string, object>} */
  const out = {};
  for (const id of Object.keys(teams)) {
    out[id] = Object.freeze({ ...teams[id], roster: Object.freeze(teams[id].roster.slice()) });
  }
  return Object.freeze(out);
}

function freezePlayers(players) {
  /** @type {Record<string, object>} */
  const out = {};
  for (const id of Object.keys(players)) {
    out[id] = Object.isFrozen(players[id]) ? players[id] : Object.freeze(players[id]);
  }
  return Object.freeze(out);
}

/**
 * Run one full Tier-2 off-season + the cross-tier promotion pipeline.
 *
 * @param {object} t1World     the POST-T1-offseason World { leagues, teamsById, playersById }
 * @param {object} tier2World  world.tier2 { leagues, teamsById, playersById }
 * @param {import('../../../core/rng.js').Rng} rng  a DEDICATED T2 rng (never the T1 stream)
 * @param {{ season?:number }} [opts]
 * @returns {{ t1World:object, tier2World:object, report:Tier2OffseasonReport }}
 */
export function runTier2Offseason(t1World, tier2World, rng, opts = {}) {
  if (!tier2World || !tier2World.teamsById || !tier2World.playersById) {
    // No T2 attached — nothing to do.
    return { t1World, tier2World, report: emptyReport(num(opts.season, 0)) };
  }
  if (!rng || typeof rng.gaussian !== 'function') {
    throw new Error('runTier2Offseason: a dedicated Rng is required');
  }
  const season = num(opts.season, 0);

  // Mutable working copies.
  /** @type {Record<string, object>} */
  const t2Players = { ...tier2World.playersById };
  /** @type {Record<string, {id:string, roster:string[], region:string}>} */
  const t2Teams = {};
  for (const id of Object.keys(tier2World.teamsById)) {
    const t = tier2World.teamsById[id];
    t2Teams[id] = { ...t, roster: t.roster.slice() }; // `region` rides along from the Team
  }
  /** @type {Record<string, object>} */
  const t1Players = { ...t1World.playersById };

  const natPoolByRegion = nationalityByRegion(tier2World);

  /** Remove a player id from whichever T2 roster holds it; return that team id. */
  function removeFromT2Rosters(pid) {
    for (const t of Object.values(t2Teams)) {
      const i = t.roster.indexOf(pid);
      if (i >= 0) { t.roster.splice(i, 1); return t.id; }
    }
    return null;
  }

  // ---- 1. develop (age+1 & drift) ----------------------------------------
  for (const id of Object.keys(t2Players)) {
    const p = t2Players[id];
    if (p.contract && p.contract.status === 'retired') continue;
    t2Players[id] = developPlayer(p, rng);
  }

  // ---- 2. retire ----------------------------------------------------------
  const retired = [];
  for (const id of Object.keys(t2Players)) {
    const p = t2Players[id];
    if (p.contract.status === 'retired') continue;
    if (decideRetirement(p, rng)) {
      t2Players[id] = { ...p, contract: { teamId: null, salary: 0, expires: 0, status: 'retired' } };
      removeFromT2Rosters(id);
      retired.push(id);
    }
  }

  // ---- 3. intake (young T2 free agents) ----------------------------------
  const newgens = [];
  const holes = totalHoles(t2Teams);
  const intakeCount = Math.max(T2.NEWGEN_PER_OFFSEASON, holes + T2.NEWGEN_BUFFER);
  const allNats = uniqueNats(natPoolByRegion);
  for (const ng of generateNewgens(intakeCount, rng, { idPrefix: `t2ng-${season}`, season, nationalityPool: allNats })) {
    const tagged = Object.freeze({ ...ng, tier: 't2' });
    t2Players[ng.id] = tagged;
    newgens.push(ng.id);
  }

  // ---- 4. PROMOTION / RELEGATION -----------------------------------------
  const promoted = [];
  // Per region, promote the strongest eligible T2 players into the T1 FA pool.
  for (const region of REGION_ORDER) {
    const candidates = Object.keys(t2Players)
      .map((id) => t2Players[id])
      .filter((p) => p.contract.status === 'active' && p.tier === 't2' && playerRegion(p, t2Teams) === region && isPromotable(p))
      .sort((a, b) => t2Value(b) - t2Value(a) || (a.id < b.id ? -1 : 1));
    for (const p of candidates.slice(0, T2.PROMOTE_PER_REGION)) {
      removeFromT2Rosters(p.id);
      delete t2Players[p.id];
      // Enters the T1 world as a free agent (tier 't1') for the next T1 window.
      t1Players[p.id] = Object.freeze({
        ...p, tier: 't1', contract: { teamId: null, salary: 0, expires: 0, status: 'free_agent' }
      });
      promoted.push(p.id);
    }
  }

  // Relegate the weakest SURPLUS T1 free agents into the T2 free-agent pool.
  const relegated = [];
  const t1Rostered = new Set();
  for (const t of Object.values(t1World.teamsById)) for (const pid of t.roster) t1Rostered.add(pid);
  const relegationPool = Object.keys(t1Players)
    .map((id) => t1Players[id])
    .filter((p) => p.contract.status === 'free_agent' && !t1Rostered.has(p.id) && overall(p) <= T2.RELEGATE_OVERALL_MAX)
    .sort((a, b) => t2Value(a) - t2Value(b) || (a.id < b.id ? -1 : 1)); // weakest first
  const relegateCap = T2.RELEGATE_PER_REGION * REGION_ORDER.length;
  for (const p of relegationPool.slice(0, relegateCap)) {
    delete t1Players[p.id];
    t2Players[p.id] = Object.freeze({
      ...p, tier: 't2', contract: { teamId: null, salary: 0, expires: 0, status: 'free_agent' }
    });
    relegated.push(p.id);
  }

  // ---- 5. fill T2 rosters from the best available T2 free agents ---------
  fillTier2Rosters(t2Teams, t2Players, season);

  // ---- 6. safety net: mint emergency youth so every roster == ROSTER_SIZE -
  const remaining = totalHoles(t2Teams);
  if (remaining > 0) {
    const emg = generateNewgens(remaining, rng, { idPrefix: `t2emg-${season}`, season, nationalityPool: allNats });
    let k = 0;
    for (const tId of Object.keys(t2Teams)) {
      const t = t2Teams[tId];
      while (t.roster.length < T2.ROSTER_SIZE && k < emg.length) {
        const ng = emg[k]; k += 1;
        const signed = Object.freeze({ ...ng, tier: 't2', contract: { teamId: t.id, salary: salaryFor(ng), expires: season + 1, status: 'active' } });
        t2Players[ng.id] = signed;
        t.roster.push(ng.id);
        newgens.push(ng.id);
      }
    }
  }

  // ---- 6b. fade washed-out youth: drop UNSIGNED T2 free agents past FADE_AGE
  //     so the live pool stays bounded over a long career (academy players who
  //     never get signed leave the scene). Rostered & retired players are kept.
  {
    const rostered = new Set();
    for (const t of Object.values(t2Teams)) for (const pid of t.roster) rostered.add(pid);
    for (const id of Object.keys(t2Players)) {
      const p = t2Players[id];
      if (rostered.has(id)) continue;
      if (p.contract.status === 'retired') continue;
      if (num(p.age, 0) > T2.FADE_AGE) delete t2Players[id];
    }
  }

  // ---- 7. reconcile rostered ⇒ contract.teamId + active ------------------
  for (const tId of Object.keys(t2Teams)) {
    for (const pid of t2Teams[tId].roster) {
      const p = t2Players[pid];
      if (!p) continue;
      if (p.contract.teamId !== tId || p.contract.status !== 'active') {
        t2Players[pid] = Object.freeze({ ...p, contract: { ...p.contract, teamId: tId, status: 'active' } });
      }
    }
  }

  const nextTier2 = Object.freeze({
    leagues: tier2World.leagues,
    teamsById: freezeTeams(t2Teams),
    playersById: freezePlayers(t2Players)
  });
  const nextT1 = Object.freeze({ ...t1World, playersById: freezePlayers(t1Players) });

  return {
    t1World: nextT1,
    tier2World: nextTier2,
    report: Object.freeze({
      season,
      retired: Object.freeze(retired),
      newgens: Object.freeze(newgens),
      promoted: Object.freeze(promoted),
      relegated: Object.freeze(relegated)
    })
  };
}

/* ------------------------------ fill helpers ----------------------------- */

/**
 * Fill every short T2 roster from the pool of available T2 free agents, best
 * value first, biased toward the team's MISSING core roles so fives trend
 * role-complete. Mutates `teams` rosters and `players` contracts in place.
 * @param {Record<string, {id:string, roster:string[]}>} teams
 * @param {Record<string, object>} players
 * @param {number} season
 */
function fillTier2Rosters(teams, players, season) {
  const rostered = new Set();
  for (const t of Object.values(teams)) for (const pid of t.roster) rostered.add(pid);
  // Available free agents (not rostered, not retired).
  let pool = Object.keys(players)
    .map((id) => players[id])
    .filter((p) => !rostered.has(p.id) && p.contract.status !== 'retired')
    .sort((a, b) => t2Value(b) - t2Value(a) || (a.id < b.id ? -1 : 1));

  for (const tId of Object.keys(teams)) {
    const t = teams[tId];
    while (t.roster.length < T2.ROSTER_SIZE && pool.length > 0) {
      const have = new Set(t.roster.map((pid) => players[pid] && players[pid].role).filter(Boolean));
      // Prefer the best FA whose role the team is missing; else the best overall.
      let idx = pool.findIndex((p) => !have.has(p.role));
      if (idx < 0) idx = 0;
      const pick = pool.splice(idx, 1)[0];
      players[pick.id] = Object.freeze({
        ...pick, tier: 't2',
        contract: { teamId: tId, salary: salaryFor(pick), expires: season + 1, status: 'active' }
      });
      t.roster.push(pick.id);
    }
  }
}

/* ------------------------------ small utils ------------------------------ */

function totalHoles(teams) {
  let holes = 0;
  for (const t of Object.values(teams)) holes += Math.max(0, T2.ROSTER_SIZE - t.roster.length);
  return holes;
}

/** Map region → nationality pool present on its T2 clubs (for plausible intake). */
function nationalityByRegion(tier2World) {
  /** @type {Record<string, Set<string>>} */
  const byRegion = {};
  for (const region of REGION_ORDER) byRegion[region] = new Set();
  for (const id of Object.keys(tier2World.playersById)) {
    const p = tier2World.playersById[id];
    const region = playerRegionFromWorld(p, tier2World);
    if (region && p.nationality) byRegion[region].add(p.nationality);
  }
  return byRegion;
}

function uniqueNats(byRegion) {
  const set = new Set();
  for (const region of Object.keys(byRegion)) for (const nat of byRegion[region]) set.add(nat);
  return set.size > 0 ? [...set] : ['INT'];
}

/** Region of a player given the working teams map (by their rostered team). */
function playerRegion(player, teams) {
  const tId = player.contract && player.contract.teamId;
  const t = tId && teams[tId];
  return t ? t.region : null;
}

/** Region of a player given the frozen tier2World (by their team's region). */
function playerRegionFromWorld(player, tier2World) {
  const tId = player.contract && player.contract.teamId;
  const t = tId && tier2World.teamsById[tId];
  return t ? (t.region || null) : null;
}

function emptyReport(season) {
  return Object.freeze({ season, retired: Object.freeze([]), newgens: Object.freeze([]), promoted: Object.freeze([]), relegated: Object.freeze([]) });
}
