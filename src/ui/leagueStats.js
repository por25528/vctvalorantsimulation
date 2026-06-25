/**
 * ui/leagueStats.js — pure analytics derivations for the Stats screen
 * (per-league / per-region aggregates). DOM-free and deterministic: turns the
 * live world state into render-ready view models (region strength table, player
 * rating + age histograms, tier split, nationality spread).
 *
 * Read-only — never mutates state or the engine. Every aggregate is guarded for
 * empty / early-career worlds so callers never divide by zero or crash.
 */

import { selectTeams, selectTeamRatings, selectRoster } from '../state/selectors.js';
import { overall } from '../engine/career/playerStats.js';
import { REGION_LABELS, REGION_ORDER } from './eventFormats.js';

/** OVR histogram window: mean-of-attributes lives in ~40..95 for real rosters. */
const OVR_LO = 40;
const OVR_HI = 95;
const OVR_WIDTH = 5;

/** Age buckets (label + inclusive bounds; `hi: null` means "and up"). */
const AGE_BUCKETS = Object.freeze([
  { label: '≤18', lo: 0, hi: 18 },
  { label: '19–21', lo: 19, hi: 21 },
  { label: '22–24', lo: 22, hi: 24 },
  { label: '25–27', lo: 25, hi: 27 },
  { label: '28–30', lo: 28, hi: 30 },
  { label: '31+', lo: 31, hi: null }
]);

/** How many nationalities to surface in the spread (rest folded into "Other"). */
const NATIONALITY_TOP_N = 8;

/** Arithmetic mean of finite numbers; empty -> 0. */
function mean(values) {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Round to `dp` decimals, returning a finite number. */
function round(n, dp = 0) {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Bucket numeric `values` into fixed-width bins over [lo, hi). Values below `lo`
 * fall into the first bucket and values >= `hi` into the last, so the histogram
 * is robust to outliers and never drops a sample.
 * @returns {{buckets:Array<{lo:number,hi:number,label:string,count:number}>, total:number, min:number, max:number, mean:number, peak:number}}
 */
function histogram(values, lo, hi, width) {
  const buckets = [];
  for (let b = lo; b < hi; b += width) {
    buckets.push({ lo: b, hi: b + width, label: `${b}–${b + width - 1}`, count: 0 });
  }
  // Degenerate guard: at least one bucket so downstream indexing is safe.
  if (buckets.length === 0) buckets.push({ lo, hi, label: `${lo}–${hi}`, count: 0 });

  let min = Infinity;
  let max = -Infinity;
  const finite = [];
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    finite.push(v);
    if (v < min) min = v;
    if (v > max) max = v;
    let idx = Math.floor((v - lo) / width);
    if (idx < 0) idx = 0;
    if (idx >= buckets.length) idx = buckets.length - 1;
    buckets[idx].count += 1;
  }
  const peak = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  return {
    buckets,
    total: finite.length,
    min: finite.length ? min : 0,
    max: finite.length ? max : 0,
    mean: round(mean(finite), 1),
    peak
  };
}

/** Bucket ages into the named {@link AGE_BUCKETS}. */
function ageHistogram(ages) {
  const buckets = AGE_BUCKETS.map((b) => ({ ...b, count: 0 }));
  const finite = [];
  for (const a of ages) {
    if (!Number.isFinite(a)) continue;
    finite.push(a);
    const idx = buckets.findIndex((b) => a >= b.lo && (b.hi === null || a <= b.hi));
    if (idx >= 0) buckets[idx].count += 1;
    else buckets[buckets.length - 1].count += 1;
  }
  const peak = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  return { buckets, total: finite.length, mean: round(mean(finite), 1), peak };
}

/** All players in the world as an array (safe on partial state). */
function allPlayers(state) {
  const map = (state && state.world && state.world.players) || {};
  return Object.values(map);
}

/**
 * Per-league / per-region analytics for the whole world.
 *
 * @param {object} state  the full store state
 * @returns {{
 *   empty: boolean,
 *   totals: {teams:number, players:number, rostered:number, t1Teams:number, t2Teams:number, regions:number},
 *   regions: Array<object>,
 *   ratingHistogram: object,
 *   ageHistogram: object,
 *   tierSplit: {t1:object, t2:object, prospect:object},
 *   nationalities: Array<{code:string, count:number}>
 * }}
 */
export function deriveLeagueStats(state) {
  const teams = selectTeams(state);
  const ratings = selectTeamRatings(state);
  const ratingByTeam = new Map(ratings.map((r) => [r.teamId, r.rating]));

  // Group rostered players by their team's region, carrying the team meta we need.
  /** @type {Map<string, {teams:object[], players:object[]}>} */
  const byRegion = new Map();
  for (const region of REGION_ORDER) byRegion.set(region, { teams: [], players: [] });

  let rosteredCount = 0;
  for (const team of teams) {
    const region = team && team.region;
    if (!region) continue;
    if (!byRegion.has(region)) byRegion.set(region, { teams: [], players: [] });
    const bucket = byRegion.get(region);
    bucket.teams.push(team);
    const roster = selectRoster(state, team.id);
    for (const p of roster) {
      bucket.players.push(p);
      rosteredCount += 1;
    }
  }

  // Region strength rows — only regions that actually have teams.
  const regions = [];
  for (const [region, bucket] of byRegion) {
    if (bucket.teams.length === 0) continue;
    const teamRatings = bucket.teams
      .map((t) => ratingByTeam.get(t.id))
      .filter((v) => Number.isFinite(v));
    const ovrs = bucket.players.map(overall);
    const ages = bucket.players.map((p) => p && p.age);

    let topTeam = null;
    for (const t of bucket.teams) {
      const r = ratingByTeam.get(t.id);
      if (!Number.isFinite(r)) continue;
      if (!topTeam || r > topTeam.rating) topTeam = { teamId: t.id, name: t.name || t.id, rating: r };
    }

    regions.push({
      region,
      label: REGION_LABELS[region] || region,
      rank: 0, // filled after sort
      teamCount: bucket.teams.length,
      playerCount: bucket.players.length,
      avgTeamRating: round(mean(teamRatings), 0),
      avgPlayerOvr: round(mean(ovrs), 1),
      avgAge: round(mean(ages), 1),
      t1Teams: bucket.teams.filter((t) => t.tier === 't1').length,
      t2Teams: bucket.teams.filter((t) => t.tier === 't2').length,
      topTeam,
      ratingHistogram: histogram(ovrs, OVR_LO, OVR_HI, OVR_WIDTH),
      ageHistogram: ageHistogram(ages)
    });
  }
  // Rank regions by average team rating (strongest first), deterministic tie-break.
  regions.sort((a, b) => b.avgTeamRating - a.avgTeamRating || a.label.localeCompare(b.label));
  regions.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Overall (all-region) player distributions, over the full world population.
  const players = allPlayers(state);
  const allOvrs = players.map(overall);
  const allAges = players.map((p) => p && p.age);

  // Tier split: teams by team.tier, players by player.tier (incl. prospects).
  const tierSplit = {
    t1: tierBucket(teams.filter((t) => t.tier === 't1'), players.filter((p) => p && p.tier === 't1')),
    t2: tierBucket(teams.filter((t) => t.tier === 't2'), players.filter((p) => p && p.tier === 't2')),
    prospect: tierBucket([], players.filter((p) => p && p.tier === 'prospect'))
  };

  // Nationality spread (top N, remainder folded into "Other").
  const natCounts = new Map();
  for (const p of players) {
    const code = (p && p.nationality) || 'INT';
    natCounts.set(code, (natCounts.get(code) || 0) + 1);
  }
  const sortedNats = [...natCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const nationalities = sortedNats.slice(0, NATIONALITY_TOP_N);
  const restCount = sortedNats.slice(NATIONALITY_TOP_N).reduce((s, n) => s + n.count, 0);
  if (restCount > 0) nationalities.push({ code: 'Other', count: restCount });

  return {
    empty: teams.length === 0,
    totals: {
      teams: teams.length,
      players: players.length,
      rostered: rosteredCount,
      t1Teams: teams.filter((t) => t.tier === 't1').length,
      t2Teams: teams.filter((t) => t.tier === 't2').length,
      regions: regions.length
    },
    regions,
    ratingHistogram: histogram(allOvrs, OVR_LO, OVR_HI, OVR_WIDTH),
    ageHistogram: ageHistogram(allAges),
    tierSplit,
    nationalities
  };
}

/** One tier's team + player rollup. */
function tierBucket(teams, players) {
  const ovrs = players.map(overall);
  return {
    teams: teams.length,
    players: players.length,
    avgOvr: round(mean(ovrs), 1)
  };
}

export const __test__ = { mean, histogram, ageHistogram, OVR_LO, OVR_HI, OVR_WIDTH, AGE_BUCKETS };
