/**
 * scripts/probe-cp.mjs — ADVERSARIAL SKEPTIC: CP accounting.
 *
 * Runs simSeason(buildWorld(), seed) over many seeds and INDEPENDENTLY
 * recomputes every team's cumulative CP by calling awardCP on each event's
 * result and summing — then compares against ledger.totals. They must match
 * EXACTLY. Also asserts:
 *   - champions events award 0 CP
 *   - kickoff/stage/masters award per CP_TABLE (cross-checked vs awardCP)
 *   - no negative / NaN totals
 *   - cpStandings ordering is correct (CP desc, teamId asc tiebreak)
 *   - ledger.history sums also reconstruct totals
 *
 * Run:  node scripts/probe-cp.mjs [seedCount]
 */

import { buildWorld } from '../src/data/seed/index.js';
import { simSeason } from '../src/engine/career/season.js';
import { awardCP, cpStandings } from '../src/engine/career/championshipPoints.js';
import { CP_TABLE } from '../src/config/cpTable.js';

const SEED_COUNT = Number(process.argv[2]) || 120;

/** Collected violations across all seeds. */
const violations = [];
function fail(seed, kind, detail) {
  violations.push({ seed, kind, detail });
}

/**
 * Recompute cumulative CP from the season's event entries by independently
 * calling awardCP on each event's EventResult.
 * @returns {Record<string, number>}
 */
function recomputeTotals(season) {
  /** @type {Record<string, number>} */
  const totals = {};
  for (const ev of season.events) {
    const awards = awardCP(ev.result, CP_TABLE);
    for (const teamId of Object.keys(awards)) {
      totals[teamId] = (totals[teamId] || 0) + awards[teamId];
    }
  }
  return totals;
}

/** Compare two number maps for exact equality; returns array of diff strings. */
function diffTotals(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs = [];
  for (const k of keys) {
    const av = a[k] || 0;
    const bv = b[k] || 0;
    if (av !== bv) diffs.push(`${k}: ledger=${av} recomputed=${bv}`);
  }
  return diffs;
}

const world = buildWorld();
let seasonsRun = 0;
let totalEventEntries = 0;

for (let i = 0; i < SEED_COUNT; i++) {
  const seed = 1000 + i * 7; // spread seeds out a bit
  let season;
  try {
    season = simSeason(world, seed);
  } catch (e) {
    fail(seed, 'throw', `simSeason threw: ${e && e.message}`);
    continue;
  }
  seasonsRun++;
  totalEventEntries += season.events.length;

  const ledgerTotals = season.ledger.totals;

  // (1) Independent recomputation must match ledger.totals exactly.
  const recomputed = recomputeTotals(season);
  const diffs = diffTotals(ledgerTotals, recomputed);
  if (diffs.length) {
    fail(seed, 'totals-mismatch', diffs.slice(0, 8).join('; '));
  }

  // (2) ledger.history awards must also sum to ledger.totals exactly.
  const histTotals = {};
  for (const h of season.ledger.history) {
    for (const teamId of Object.keys(h.awards)) {
      histTotals[teamId] = (histTotals[teamId] || 0) + h.awards[teamId];
    }
  }
  const histDiffs = diffTotals(ledgerTotals, histTotals);
  if (histDiffs.length) {
    fail(seed, 'history-mismatch', histDiffs.slice(0, 8).join('; '));
  }

  // (3) Per-event checks: champions awards 0; others award per CP_TABLE.
  for (const ev of season.events) {
    const awards = awardCP(ev.result, CP_TABLE);
    const sumAwards = Object.values(awards).reduce((s, v) => s + v, 0);

    if (ev.type === 'champions') {
      if (sumAwards !== 0) {
        fail(seed, 'champions-awarded-cp', `slot=${ev.slotId} totalCP=${sumAwards}`);
      }
    } else {
      // Cross-check each placement against CP_TABLE directly.
      const typeTable = CP_TABLE[ev.type] || {};
      for (const p of ev.result.placements) {
        const expected = Number.isFinite(typeTable[p.rank]) ? typeTable[p.rank] : 0;
        if (awards[p.teamId] !== expected) {
          fail(seed, 'placement-cp-wrong',
            `slot=${ev.slotId} team=${p.teamId} rank=${p.rank} got=${awards[p.teamId]} expected=${expected}`);
        }
      }
      // A non-champions regional/international event should award SOME CP.
      if (sumAwards <= 0) {
        fail(seed, 'event-awarded-no-cp', `slot=${ev.slotId} type=${ev.type}`);
      }
    }

    // (3b) season's stored cpAwards entry must equal a fresh awardCP call.
    const storedDiffs = diffTotals(ev.cpAwards, awards);
    if (storedDiffs.length) {
      fail(seed, 'stored-cpAwards-mismatch', `slot=${ev.slotId} ${storedDiffs.slice(0, 4).join('; ')}`);
    }
  }

  // (4) No negative / NaN totals.
  for (const teamId of Object.keys(ledgerTotals)) {
    const v = ledgerTotals[teamId];
    if (!Number.isFinite(v)) fail(seed, 'nan-total', `team=${teamId} value=${v}`);
    if (v < 0) fail(seed, 'negative-total', `team=${teamId} value=${v}`);
  }

  // (5) cpStandings ordering: CP desc, then teamId asc.
  const standings = cpStandings(season.ledger);
  for (let k = 1; k < standings.length; k++) {
    const prev = standings[k - 1];
    const cur = standings[k];
    if (cur.cp > prev.cp) {
      fail(seed, 'standings-cp-order', `idx=${k} ${prev.teamId}(${prev.cp}) < ${cur.teamId}(${cur.cp})`);
    } else if (cur.cp === prev.cp && cur.teamId < prev.teamId) {
      fail(seed, 'standings-tie-order', `idx=${k} ${prev.teamId} should follow ${cur.teamId} at cp=${cur.cp}`);
    }
  }
  // standings cp values must equal ledger totals.
  for (const row of standings) {
    if (row.cp !== (ledgerTotals[row.teamId] || 0)) {
      fail(seed, 'standings-cp-value', `team=${row.teamId} standing=${row.cp} ledger=${ledgerTotals[row.teamId]}`);
    }
  }
  // standings must cover exactly the teams in totals.
  if (standings.length !== Object.keys(ledgerTotals).length) {
    fail(seed, 'standings-coverage', `standings=${standings.length} totals=${Object.keys(ledgerTotals).length}`);
  }
}

// ---- Report ----
const byKind = {};
for (const v of violations) byKind[v.kind] = (byKind[v.kind] || 0) + 1;

console.log('=== probe-cp report ===');
console.log(`seasons run: ${seasonsRun}/${SEED_COUNT}`);
console.log(`total event entries checked: ${totalEventEntries}`);
console.log(`violations: ${violations.length}`);
if (violations.length) {
  console.log('by kind:', JSON.stringify(byKind));
  console.log('first 20 violations:');
  for (const v of violations.slice(0, 20)) {
    console.log(`  [seed=${v.seed}] ${v.kind}: ${v.detail}`);
  }
  process.exitCode = 1;
} else {
  console.log('ALL CP ACCOUNTING INVARIANTS HOLD.');
}
