/**
 * scripts/probe-newgen.mjs — newgen/talent-pool distribution probe (temporary).
 * Measures: seed-world demographics, a large newgen batch's quality/role/age
 * spread, and long-run pool health across many simulated seasons.
 *
 * Run: node scripts/probe-newgen.mjs [seed] [seasons]
 */

import { buildWorld } from '../src/data/seed/index.js';
import { generateNewgens } from '../src/engine/career/offseason/newgen.js';
import { initCareer, advanceCareer } from '../src/engine/career/career.js';
import { overall } from '../src/engine/career/playerStats.js';
import { createRng } from '../src/core/rng.js';

const SEED = process.argv[2] != null ? process.argv[2] : 'probe-2026';
const SEASONS = process.argv[3] != null ? Number(process.argv[3]) : 12;

const line = (s = '') => console.log(s);

function histogram(values, bins, lo, hi) {
  const counts = new Array(bins).fill(0);
  const w = (hi - lo) / bins;
  for (const v of values) {
    let idx = Math.floor((v - lo) / w);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx] += 1;
  }
  const max = Math.max(1, ...counts);
  for (let i = 0; i < bins; i += 1) {
    const a = (lo + i * w).toFixed(0).padStart(3);
    const b = (lo + (i + 1) * w).toFixed(0).padStart(3);
    const bar = '#'.repeat(Math.round((counts[i] / max) * 40));
    line(`  ${a}-${b} | ${String(counts[i]).padStart(5)} ${bar}`);
  }
}

function stats(values) {
  if (!values.length) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const sum = s.reduce((x, y) => x + y, 0);
  const mean = sum / s.length;
  const sd = Math.sqrt(s.reduce((x, y) => x + (y - mean) ** 2, 0) / s.length);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, mean, sd, min: s[0], p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: s[s.length - 1] };
}

function fmt(st) {
  if (!st.n) return '(empty)';
  return `n=${st.n} mean=${st.mean.toFixed(1)} sd=${st.sd.toFixed(1)} min=${st.min.toFixed(0)} p10=${st.p10.toFixed(0)} p50=${st.p50.toFixed(0)} p90=${st.p90.toFixed(0)} p99=${st.p99.toFixed(0)} max=${st.max.toFixed(0)}`;
}

function countBy(arr, keyFn) {
  const m = {};
  for (const x of arr) { const k = keyFn(x); m[k] = (m[k] || 0) + 1; }
  return m;
}

// ============================ 1. SEED WORLD ============================
line('='.repeat(72));
line('SEED WORLD');
line('='.repeat(72));
const w = buildWorld();
const seedPlayers = Object.values(w.playersById);
line(`players=${seedPlayers.length} teams=${Object.keys(w.teamsById).length} leagues=${Object.keys(w.leagues).length}`);
line(`overall:   ${fmt(stats(seedPlayers.map(overall)))}`);
line(`potential: ${fmt(stats(seedPlayers.map((p) => p.potential)))}`);
line(`age:       ${fmt(stats(seedPlayers.map((p) => p.age)))}`);
line(`roles:     ${JSON.stringify(countBy(seedPlayers, (p) => p.role))}`);
line(`nationalities (${new Set(seedPlayers.map((p) => p.nationality)).size}): ${JSON.stringify(countBy(seedPlayers, (p) => p.nationality))}`);

// ============================ 2. NEWGEN BATCH ============================
line('');
line('='.repeat(72));
line('NEWGEN BATCH (n=4000)');
line('='.repeat(72));
const natPool = [...new Set(seedPlayers.map((p) => p.nationality))];
const batch = generateNewgens(4000, createRng(12345), { season: 1, nationalityPool: natPool });
line(`potential: ${fmt(stats(batch.map((p) => p.potential)))}`);
line('potential histogram:');
histogram(batch.map((p) => p.potential), 12, 40, 100);
line(`current overall: ${fmt(stats(batch.map(overall)))}`);
line(`age:       ${fmt(stats(batch.map((p) => p.age)))}`);
line(`roles:     ${JSON.stringify(countBy(batch, (p) => p.role))}`);
line(`archetypes:${JSON.stringify(countBy(batch, (p) => p.development.archetype))}`);
const elite = batch.filter((p) => p.potential >= 88).length;
const solid = batch.filter((p) => p.potential >= 75 && p.potential < 88).length;
const journ = batch.filter((p) => p.potential < 75).length;
line(`tiers by potential: elite(>=88)=${elite} (${(100 * elite / batch.length).toFixed(1)}%)  solid(75-87)=${solid} (${(100 * solid / batch.length).toFixed(1)}%)  journeyman(<75)=${journ} (${(100 * journ / batch.length).toFixed(1)}%)`);

// ============================ 3. LONG-RUN POOL HEALTH ============================
line('');
line('='.repeat(72));
line(`LONG-RUN POOL HEALTH  seed=${JSON.stringify(SEED)}  seasons=${SEASONS}`);
line('='.repeat(72));
line('seas | players active rostered | ovr(rost) mean p90 max | top16 | retire newgen | roles(rostered)');
let state = initCareer(SEED);
let guard = 0;
let lastRetire = 0; let lastNewgen = 0;
while (state.history.length < SEASONS && guard < SEASONS * 20 + 20) {
  const before = state.history.length;
  state = advanceCareer(state);
  guard += 1;
  if (state.history.length === before) continue;
  const world = state.world;
  const players = Object.values(world.playersById);
  const active = players.filter((p) => p.contract.status !== 'retired');
  const rosteredIds = new Set();
  for (const t of Object.values(world.teamsById)) for (const id of t.roster) rosteredIds.add(id);
  const rostered = [...rosteredIds].map((id) => world.playersById[id]).filter(Boolean);
  const rostOvr = rostered.map(overall).sort((a, b) => b - a);
  const ovrStat = stats(rostOvr);
  const top16 = (rostOvr.slice(0, 16).reduce((a, b) => a + b, 0) / 16).toFixed(1);
  const rep = state.offseason || {};
  lastRetire = (rep.retired || []).length;
  lastNewgen = (rep.newgens || []).length;
  const roles = countBy(rostered, (p) => p.role);
  const roleStr = ['Duelist', 'Initiator', 'Controller', 'Sentinel'].map((r) => `${r[0]}:${roles[r] || 0}`).join(' ');
  line(
    `${String(before).padStart(4)} | ${String(players.length).padStart(7)} ${String(active.length).padStart(6)} ${String(rostered.length).padStart(8)} | `
    + `${ovrStat.mean.toFixed(1).padStart(8)} ${String(ovrStat.p90).padStart(3)} ${String(ovrStat.max).padStart(3)} | ${top16.padStart(5)} | `
    + `${String(lastRetire).padStart(6)} ${String(lastNewgen).padStart(6)} | ${roleStr}`
  );
}
line('');
line('Done.');
