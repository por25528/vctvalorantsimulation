/**
 * engine/format/swiss.js — Buchholz-paired Swiss stage (CONTRACTS-FORMAT §4).
 *
 * A team advances once it reaches `winsToAdvance` series wins and is eliminated
 * once it reaches `lossesToEliminate` series losses. The classic 8-team Masters
 * Swiss uses 2/2: every team plays until it has either 2 wins (advance) or 2
 * losses (out), yielding exactly 4 advancers and 4 eliminated.
 *
 * Pairing each round (CONTRACTS-FORMAT §4):
 *   - only teams that are still active (not yet advanced/eliminated) are paired;
 *   - teams are grouped by identical record (wins, losses) — Swiss only pairs
 *     same-record teams;
 *   - within a record group, order by Buchholz DESC then seed ASC, and pair the
 *     standard Swiss way (strongest vs weakest-eligible) while AVOIDING rematches
 *     where possible (backtracking search over the group);
 *   - the injected `rng` is used ONLY for unavoidable tie-break shuffles (record
 *     groups whose Buchholz + seed are identical), never for series outcomes.
 *
 * Each series is a Bo3 simulated by `simSeries(teamA, teamB, players, 3,
 * makeSeed(matchId))` — the per-series seed comes from `makeSeed`, NOT from the
 * stage `rng`, so every series is independently reproducible.
 *
 * Pure functions, named exports, immutable outputs. No Math.random / Date.now /
 * window / document; all randomness flows through the injected `rng`.
 *
 * @typedef {import('../match/matchSim.js').Series} Series
 */

import { simSeries } from '../match/matchSim.js';
import { swissStandings, recordFromSeries, computeBuchholz } from './standings.js';

/** @typedef {{ teamId:string, w:number, l:number, seed:number, status:'active'|'advanced'|'eliminated' }} SwissTeam */

/**
 * Default Swiss thresholds when the stage omits them: classic 8-team Masters
 * Swiss (advance at 2 wins, out at 2 losses, 4 advance).
 */
const DEFAULT_WINS_TO_ADVANCE = 2;
const DEFAULT_LOSSES_TO_ELIMINATE = 2;

/**
 * Resolve the Team object for a teamId from ctx (teamsById), falling back to a
 * minimal { id } object so simSeries always has a usable identifier.
 * @param {string} teamId
 * @param {object} ctx
 * @returns {object}
 */
function teamObj(teamId, ctx) {
  const byId = ctx && ctx.teamsById;
  const t = byId && byId[teamId];
  return t || { id: teamId };
}

/**
 * Stable Fisher–Yates shuffle driven by the injected rng. Returns a new array;
 * the input is never mutated. Used only for unavoidable tie-break ordering.
 * @template T
 * @param {T[]} arr
 * @param {{int:(n:number)=>number}} rng
 * @returns {T[]}
 */
function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Build the round's pairings for one record group, avoiding rematches where
 * possible via backtracking. The group is assumed pre-sorted (strongest first).
 * Standard Swiss pairs index 0 with the first eligible later team (preferring a
 * non-rematch), then recurses on the rest.
 *
 * @param {SwissTeam[]} group  pre-ordered same-record teams
 * @param {Set<string>} played  set of "a|b" (sorted) pairs already played
 * @returns {Array<{a:string,b:string}>|null}  pairings, or null if impossible
 */
function pairGroup(group, played) {
  if (group.length === 0) return [];
  if (group.length === 1) return null; // odd leftover within a group cannot pair here
  const head = group[0];
  // Try to pair the head with each later team, preferring non-rematches first.
  const candidates = [];
  for (let i = 1; i < group.length; i++) candidates.push(i);
  // Prefer opponents we have NOT played yet, keeping Swiss strength order.
  candidates.sort((i, j) => {
    const ri = played.has(pairKey(head.teamId, group[i].teamId)) ? 1 : 0;
    const rj = played.has(pairKey(head.teamId, group[j].teamId)) ? 1 : 0;
    if (ri !== rj) return ri - rj; // non-rematch (0) before rematch (1)
    return i - j; // otherwise preserve Swiss order
  });
  for (const idx of candidates) {
    const opp = group[idx];
    const rest = group.filter((_, k) => k !== 0 && k !== idx);
    const sub = pairGroup(rest, played);
    if (sub !== null) {
      return [{ a: head.teamId, b: opp.teamId }, ...sub];
    }
  }
  return null;
}

/**
 * Canonical key for an unordered pair of team ids.
 * @param {string} x
 * @param {string} y
 * @returns {string}
 */
function pairKey(x, y) {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

/**
 * Compute pairings for a full Swiss round across all active teams.
 *
 * Teams are bucketed by (wins, losses); within a bucket they are ordered by
 * Buchholz DESC then seed ASC, with the injected rng breaking only fully-equal
 * ties. Each bucket is paired internally (rematch-avoiding). If a bucket has an
 * odd team, it floats down into the next (lower) bucket — a standard Swiss
 * "down-float" — so the round always pairs everyone.
 *
 * @param {SwissTeam[]} active  active teams
 * @param {Record<string, number>} buchholz  teamId -> Buchholz score
 * @param {Set<string>} played  prior "a|b" pairs
 * @param {{int:(n:number)=>number}} rng
 * @returns {Array<{a:string,b:string}>}
 */
function pairRound(active, buchholz, played, rng) {
  // Bucket by record.
  /** @type {Map<string, SwissTeam[]>} */
  const buckets = new Map();
  for (const t of active) {
    const key = `${t.w}-${t.l}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  // Process buckets best-record first (more wins, then fewer losses).
  const keys = [...buckets.keys()].sort((ka, kb) => {
    const [wa, la] = ka.split('-').map(Number);
    const [wb, lb] = kb.split('-').map(Number);
    if (wb !== wa) return wb - wa;
    return la - lb;
  });

  /** @type {Array<{a:string,b:string}>} */
  const pairings = [];
  /** @type {SwissTeam[]} */
  let carry = []; // odd team floated down from the previous bucket

  for (let k = 0; k < keys.length; k++) {
    let members = [...carry, ...buckets.get(keys[k])];
    carry = [];

    // Order within the bucket: Buchholz DESC, seed ASC, rng for full ties.
    members = orderBucket(members, buchholz, rng);

    // If odd, float the weakest team down to the next bucket.
    if (members.length % 2 === 1) {
      const floater = members.pop();
      carry = [floater];
    }

    const sub = pairGroup(members, played);
    if (sub) {
      pairings.push(...sub);
    } else {
      // Rematch-free pairing impossible for this bucket: fall back to the plain
      // Swiss split (strongest-half vs weakest-half), allowing rematches.
      for (let i = 0; i < members.length; i += 2) {
        pairings.push({ a: members[i].teamId, b: members[i + 1].teamId });
      }
    }
  }
  // Any final carry (shouldn't happen with an even active count) pairs itself.
  if (carry.length === 2) {
    pairings.push({ a: carry[0].teamId, b: carry[1].teamId });
  }
  return pairings;
}

/**
 * Order a bucket of same-record teams: Buchholz DESC, then seed ASC; teams that
 * are fully tied (equal Buchholz AND equal seed — only possible if seeds were
 * pre-shuffled identically, i.e. effectively never) keep a stable order. The rng
 * is consumed to shuffle any run of fully-Buchholz-tied teams so that unavoidable
 * tie-breaks are randomized rather than seed-locked.
 *
 * @param {SwissTeam[]} members
 * @param {Record<string, number>} buchholz
 * @param {{int:(n:number)=>number}} rng
 * @returns {SwissTeam[]}
 */
function orderBucket(members, buchholz, rng) {
  // First group by Buchholz so we can rng-shuffle equal-Buchholz runs, then
  // order those runs by seed ASC (seed is the deterministic final tiebreak).
  const byBuchholz = new Map();
  for (const t of members) {
    const b = buchholz[t.teamId] || 0;
    if (!byBuchholz.has(b)) byBuchholz.set(b, []);
    byBuchholz.get(b).push(t);
  }
  const buchholzKeys = [...byBuchholz.keys()].sort((a, b) => b - a); // DESC
  const ordered = [];
  for (const bk of buchholzKeys) {
    const run = byBuchholz.get(bk);
    // Shuffle the equal-Buchholz run with rng (the unavoidable tie-break), then
    // apply the deterministic seed-ASC ordering on top. Shuffling first keeps the
    // rng stream consumed consistently; seed sort makes the visible order stable
    // while still consuming rng identically for a given seed.
    const shuffled = shuffle(run, rng);
    shuffled.sort((a, b) => a.seed - b.seed);
    ordered.push(...shuffled);
  }
  return ordered;
}

/**
 * Run a Buchholz-paired Swiss stage (CONTRACTS-FORMAT §4).
 *
 * @param {object} stage  StageDescriptor; reads winsToAdvance / lossesToEliminate.
 * @param {string[]} entrants  seeded teamIds (index 0 => seed 1).
 * @param {object} ctx  { teamsById, playersById, ... }.
 * @param {(matchId:string)=>number} makeSeed  deterministic per-series seed factory.
 * @param {{int:(n:number)=>number}} rng  in-stage rng (pairing tie-breaks only).
 * @returns {object} StageResult { stageId, kind:'swiss', standings, advancers, series }
 */
export function run(stage, entrants, ctx, makeSeed, rng) {
  const teamIds = Array.isArray(entrants) ? entrants.slice() : [];
  const winsToAdvance = positiveIntOr(stage && stage.winsToAdvance, DEFAULT_WINS_TO_ADVANCE);
  const lossesToEliminate = positiveIntOr(stage && stage.lossesToEliminate, DEFAULT_LOSSES_TO_ELIMINATE);
  const players = (ctx && ctx.playersById) || {};
  const stageId = (stage && stage.id) || 'swiss';
  const seriesLen = (stage && stage.seriesLen && stage.seriesLen.default) || 3;

  /** @type {Map<string, SwissTeam>} */
  const state = new Map();
  teamIds.forEach((teamId, i) => {
    state.set(teamId, { teamId, w: 0, l: 0, seed: i + 1, status: 'active' });
  });

  /** @type {object[]} */ // SeriesRef[]
  const seriesRefs = [];
  /** @type {string[]} */
  const advancers = []; // in clinch order
  const played = new Set(); // "a|b" pairs already contested

  // Round loop: continue while any team is still active. With an even entrant
  // count and 2/2 thresholds this terminates in at most ~ (entrants) rounds.
  let roundNo = 0;
  const maxRounds = teamIds.length * 4 + 8; // generous safety cap
  while (roundNo < maxRounds) {
    const active = [...state.values()].filter((t) => t.status === 'active');
    if (active.length < 2) break;

    roundNo += 1;

    // Buchholz from series played so far (sum of opponents' series wins).
    const records = recordFromSeries(seriesRefs);
    const buchholz = computeBuchholz(teamIds, seriesRefs, records);

    const pairings = pairRound(active, buchholz, played, rng);
    if (pairings.length === 0) break;

    pairings.forEach((pair, idx) => {
      const matchId = `${stageId}-r${roundNo}-m${idx + 1}`;
      const teamA = teamObj(pair.a, ctx);
      const teamB = teamObj(pair.b, ctx);
      /** @type {Series} */
      const series = simSeries(teamA, teamB, players, seriesLen, makeSeed(matchId));
      seriesRefs.push({ ...series, stageId, matchId });
      played.add(pairKey(pair.a, pair.b));

      const winnerId = series.winnerId === pair.a ? pair.a : (series.winnerId === pair.b ? pair.b : pair.a);
      const loserId = winnerId === pair.a ? pair.b : pair.a;

      const wt = state.get(winnerId);
      const lt = state.get(loserId);
      wt.w += 1;
      lt.l += 1;

      if (wt.status === 'active' && wt.w >= winsToAdvance) {
        wt.status = 'advanced';
        advancers.push(wt.teamId);
      }
      if (lt.status === 'active' && lt.l >= lossesToEliminate) {
        lt.status = 'eliminated';
      }
    });
  }

  // Final standings over all entrants (Buchholz-aware via swissStandings).
  const standings = swissStandings(teamIds, seriesRefs);

  return {
    stageId,
    kind: 'swiss',
    standings,
    advancers,
    series: seriesRefs
  };
}

/**
 * Coerce to a positive integer or return the fallback.
 * @param {*} v
 * @param {number} fallback
 * @returns {number}
 */
function positiveIntOr(v, fallback) {
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

/**
 * Compute the next round's Buchholz-balanced pairings for an in-progress Swiss
 * state (helper retained from the Phase-1 scaffold; the engine uses `run`).
 *
 * @param {{ teams:SwissTeam[], series?:object[] }} swiss
 *   teams: active SwissTeam[]; series: prior SeriesRef[] (for Buchholz/rematch).
 * @param {{int:(n:number)=>number}} [rng]  optional tie-break rng.
 * @returns {Array<{a:string,b:string}>}
 */
export function pairSwissRound(swiss, rng) {
  const teams = (swiss && swiss.teams) || [];
  const series = (swiss && swiss.series) || [];
  const teamIds = teams.map((t) => t.teamId);
  const records = recordFromSeries(series);
  const buchholz = computeBuchholz(teamIds, series, records);
  const played = new Set();
  for (const s of series) {
    if (s && s.teamAId && s.teamBId) played.add(pairKey(s.teamAId, s.teamBId));
  }
  const safeRng = rng || { int: () => 0 };
  return pairRound(teams.filter((t) => (t.status || 'active') === 'active'), buchholz, played, safeRng);
}

/**
 * Build an initial Swiss state from seeded team ids (helper retained from the
 * Phase-1 scaffold). The engine drives Swiss through `run`; this is a thin
 * constructor for callers/tests that want to inspect or step pairings manually.
 *
 * @param {string[]} seededTeamIds
 * @param {{ advanceAt?:number, eliminateAt?:number }} [opts]
 * @returns {{ teams:SwissTeam[], advanceAt:number, eliminateAt:number, series:object[] }}
 */
export function createSwiss(seededTeamIds, opts) {
  const ids = Array.isArray(seededTeamIds) ? seededTeamIds : [];
  return {
    teams: ids.map((teamId, i) => ({ teamId, w: 0, l: 0, seed: i + 1, status: 'active' })),
    advanceAt: positiveIntOr(opts && opts.advanceAt, DEFAULT_WINS_TO_ADVANCE),
    eliminateAt: positiveIntOr(opts && opts.eliminateAt, DEFAULT_LOSSES_TO_ELIMINATE),
    series: []
  };
}
