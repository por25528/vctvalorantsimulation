/**
 * scripts/probe-loss.mjs — ADVERSARIAL probe of the Kickoff triple-elim bracket.
 *
 * This script does NOT trust the engine's reported placement.losses. It runs
 * simEvent(KICKOFF, ctx, seed) over many seeds and INDEPENDENTLY reconstructs
 * each placed team's loss count by scanning the returned `series` array and
 * counting, per team, how many PLAYOFF series that team participated in and lost
 * (winnerId !== teamId). It then checks the §9 loss invariant against those
 * independently-derived counts:
 *
 *   placement 1 lost 0 series, 2 lost exactly 1, 3 lost exactly 2, 4 lost exactly 3;
 *   NO team in the bracket was eliminated before its 3rd loss;
 *   NO placed (top-8) team has > 3 losses.
 *
 *   node scripts/probe-loss.mjs          # default 300 seeds starting at 1
 *   node scripts/probe-loss.mjs 500      # 500 seeds
 *   node scripts/probe-loss.mjs 500 7000 # 500 seeds starting at 7000
 */

import { PACIFIC_SEED } from '../src/data/seed/pacific.js';
import { createPlayer } from '../src/domain/player.js';
import { createTeam } from '../src/domain/team.js';
import { KICKOFF_FORMAT } from '../src/config/formats/kickoff.js';
import { simEvent } from '../src/engine/format/formatEngine.js';

// --- build ctx from the Pacific seed (12 teams) -----------------------------
const playersById = {};
for (const p of PACIFIC_SEED.players) { const x = createPlayer(p); playersById[x.id] = x; }
const teamsById = {};
for (const t of PACIFIC_SEED.teams) { const x = createTeam(t); teamsById[x.id] = x; }

const teamCount = Object.keys(teamsById).length;
if (teamCount < 12) {
  console.error(`FATAL: need >=12 teams for Kickoff, have ${teamCount}`);
  process.exit(2);
}

const ctx = { eventId: 'kickoff-probe', teamsById, playersById };

const N = Number(process.argv[2] || 300);
const START = Number(process.argv[3] || 1);

/**
 * Independently count, per team, the number of PLAYOFF series that team lost.
 * A team "participated" in a series if it is teamAId or teamBId; it "lost" if
 * winnerId is the other team. We restrict to stageId === 'playoff' because the
 * 0/1/2/3 loss invariant is about the triple-elim bracket, not group losses.
 *
 * @param {object[]} series  every SeriesRef in the EventResult
 * @returns {Map<string, number>} teamId -> playoff series losses
 */
function reconstructPlayoffLosses(series) {
  const losses = new Map();
  for (const s of series) {
    if (s.stageId !== 'playoff') continue;
    const a = s.teamAId;
    const b = s.teamBId;
    // sanity: winner must be one of the two participants
    if (s.winnerId !== a && s.winnerId !== b) {
      return { error: `series ${s.matchId} winner ${s.winnerId} is neither ${a} nor ${b}` };
    }
    const loser = s.winnerId === a ? b : a;
    losses.set(loser, (losses.get(loser) || 0) + 1);
    // ensure both participants exist in the map (so winners get 0, not undefined)
    if (!losses.has(s.winnerId)) losses.set(s.winnerId, losses.get(s.winnerId) || 0);
    if (!losses.has(a)) losses.set(a, losses.get(a) || 0);
    if (!losses.has(b)) losses.set(b, losses.get(b) || 0);
  }
  return { losses };
}

/**
 * Count how many distinct PLAYOFF series each team participated in (to detect
 * "eliminated before 3rd loss": a team that lost and then never plays again, yet
 * has < 3 losses while ranked 5-8, would be an early elimination).
 */
function reconstructPlayoffParticipation(series) {
  const part = new Map();
  for (const s of series) {
    if (s.stageId !== 'playoff') continue;
    part.set(s.teamAId, (part.get(s.teamAId) || 0) + 1);
    part.set(s.teamBId, (part.get(s.teamBId) || 0) + 1);
  }
  return part;
}

const violations = [];
let checked = 0;
let firstSample = null;

for (let i = 0; i < N; i++) {
  const seed = START + i;
  let result;
  try {
    result = simEvent(KICKOFF_FORMAT, ctx, seed);
  } catch (err) {
    // The engine itself throwing on its internal assertion still counts: it means
    // a real seed produced a bracket the engine rejected. Record it.
    violations.push({ seed, kind: 'engine-threw', detail: String(err && err.message || err) });
    continue;
  }
  checked++;

  const placements = result.placements;
  const recon = reconstructPlayoffLosses(result.series);
  if (recon.error) {
    violations.push({ seed, kind: 'winner-not-participant', detail: recon.error });
    continue;
  }
  const reconLosses = recon.losses;
  const participation = reconstructPlayoffParticipation(result.series);

  // The top 8 placements are the playoff teams.
  const top8 = placements.filter((p) => p.rank >= 1 && p.rank <= 8);
  if (top8.length !== 8) {
    violations.push({ seed, kind: 'not-8-playoff', detail: `top8 length = ${top8.length}` });
    continue;
  }

  const want = { 1: 0, 2: 1, 3: 2, 4: 3 };

  for (const p of top8) {
    const indepLoss = reconLosses.get(p.teamId);
    const indepDefined = indepLoss === undefined ? 0 : indepLoss;

    // (a) exact loss counts for ranks 1-4 vs INDEPENDENT reconstruction
    if (want[p.rank] !== undefined && indepDefined !== want[p.rank]) {
      violations.push({
        seed, kind: 'rank-loss-mismatch',
        detail: `rank ${p.rank} team ${p.teamId}: independent playoff losses = ${indepDefined}, expected ${want[p.rank]} (engine reported losses=${p.losses})`
      });
    }

    // (b) no placed team exceeds 3 losses
    if (indepDefined > 3) {
      violations.push({
        seed, kind: 'over-3-losses',
        detail: `rank ${p.rank} team ${p.teamId} has ${indepDefined} playoff losses (>3)`
      });
    }

    // (c) eliminated teams (ranks 5-8) must have exactly 3 losses
    if (p.rank >= 5 && indepDefined !== 3) {
      violations.push({
        seed, kind: 'eliminated-before-3',
        detail: `eliminated rank ${p.rank} team ${p.teamId} has only ${indepDefined} playoff losses (must be 3) — eliminated before 3rd loss`
      });
    }

    // (d) cross-check: engine's reported losses must match independent count
    if (p.losses !== indepDefined) {
      violations.push({
        seed, kind: 'engine-vs-independent',
        detail: `rank ${p.rank} team ${p.teamId}: engine losses=${p.losses} but independent count=${indepDefined}`
      });
    }
  }

  // (e) structural: ranks 1-12 unique, no team plays itself
  const ranks = placements.map((p) => p.rank).sort((x, y) => x - y);
  for (let r = 1; r <= 12; r++) {
    if (ranks[r - 1] !== r) {
      violations.push({ seed, kind: 'rank-gap', detail: `expected rank ${r}, got ${ranks[r - 1]}` });
      break;
    }
  }

  // (f) sum-of-losses sanity: in a triple-elim 8-team bracket every series
  //     produces exactly one loss; 18 series => 18 total losses among the 8.
  const playoffSeries = result.series.filter((s) => s.stageId === 'playoff');
  let totalLoss = 0;
  for (const v of reconLosses.values()) totalLoss += v;
  if (playoffSeries.length !== 18) {
    violations.push({ seed, kind: 'series-count', detail: `playoff has ${playoffSeries.length} series, expected 18` });
  }
  if (totalLoss !== playoffSeries.length) {
    violations.push({ seed, kind: 'loss-sum', detail: `total reconstructed losses ${totalLoss} != series count ${playoffSeries.length}` });
  }

  if (!firstSample) {
    firstSample = { seed, top8: top8.map((p) => ({ rank: p.rank, team: p.teamId, indepLosses: reconLosses.get(p.teamId) || 0, engineLosses: p.losses, plays: participation.get(p.teamId) || 0 })) };
  }
}

// --- report -----------------------------------------------------------------
console.log(`\n=== ADVERSARIAL LOSS PROBE — Kickoff triple-elim ===`);
console.log(`seeds: ${START}..${START + N - 1}  (${N} seeds, ${checked} simulated OK)`);
console.log(`teams in pool: ${teamCount}`);

if (firstSample) {
  console.log(`\nSample seed ${firstSample.seed} top-8 (independent reconstruction):`);
  for (const r of firstSample.top8) {
    console.log(`  rank ${r.rank}  ${r.team.padEnd(6)} indepLosses=${r.indepLosses} engineLosses=${r.engineLosses} playoffSeriesPlayed=${r.plays}`);
  }
}

if (violations.length === 0) {
  console.log(`\nRESULT: NO VIOLATIONS across ${checked} seeds.`);
  console.log(`  - rank 1/2/3/4 had exactly 0/1/2/3 independently-counted playoff losses every time`);
  console.log(`  - no team eliminated before its 3rd loss`);
  console.log(`  - no placed team exceeded 3 losses`);
  console.log(`  - engine-reported losses matched independent counts in all cases`);
  process.exit(0);
} else {
  console.log(`\nRESULT: ${violations.length} VIOLATION(S) FOUND.`);
  const byKind = {};
  for (const v of violations) byKind[v.kind] = (byKind[v.kind] || 0) + 1;
  console.log(`by kind: ${JSON.stringify(byKind)}`);
  console.log(`first 20:`);
  for (const v of violations.slice(0, 20)) {
    console.log(`  seed ${v.seed} [${v.kind}] ${v.detail}`);
  }
  process.exit(1);
}
