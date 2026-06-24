/**
 * scripts/probe-determinism.mjs — ADVERSARIAL determinism + engine-backing probe.
 *
 * Independent of the repo's own tests/kickoff.test.mjs. For many seeds it:
 *   A) runs simEvent(KICKOFF, ctx, seed) TWICE and deep-compares (recursive,
 *      not just JSON) — must be byte-identical;
 *   B) runs seed vs seed+1 and confirms the bracket OUTCOME differs;
 *   C) confirms every Series has a non-empty maps[] with finalized box scores
 *      (kills/deaths/acs present, finite) AND that each map score is a VALID
 *      Valorant score: winner >= 13, win-by-2 in OT, rounds.length == A+B,
 *      and the named map winner matches the higher score;
 *   D) confirms placements are genuinely engine-produced (loss ladder matches the
 *      actual series the team lost), not faked.
 *
 * Exit non-zero (and print VIOLATION lines) on any counterexample.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createPlayer } from '../src/domain/player.js';
import { createTeam } from '../src/domain/team.js';
import { PACIFIC_SEED } from '../src/data/seed/pacific.js';
import { simEvent } from '../src/engine/format/formatEngine.js';
import { KICKOFF_FORMAT } from '../src/config/formats/kickoff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const violations = [];
function violation(msg) { violations.push(msg); console.error('VIOLATION: ' + msg); }

/* ---------------- world ---------------- */
function buildWorld() {
  const playersById = {};
  for (const p of PACIFIC_SEED.players) {
    const pl = createPlayer(p);
    playersById[pl.id] = pl;
  }
  const teamsById = {};
  const ids = [];
  for (const t of PACIFIC_SEED.teams) {
    const tm = createTeam(t);
    teamsById[tm.id] = tm;
    ids.push(tm.id);
  }
  return { teamsById, playersById, ids };
}

/* ---------------- recursive deep-equal (NaN-aware, order-sensitive) ---------------- */
function deepEqual(a, b, path = '$') {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    if (a !== b) { deepEqual._diff = `${path}: ${a} !== ${b}`; return false; }
    return true;
  }
  if (typeof a !== typeof b) { deepEqual._diff = `${path}: type ${typeof a} vs ${typeof b}`; return false; }
  if (a === null || b === null) { deepEqual._diff = `${path}: ${a} vs ${b}`; return false; }
  if (typeof a !== 'object') { deepEqual._diff = `${path}: ${a} vs ${b}`; return false; }
  if (Array.isArray(a) !== Array.isArray(b)) { deepEqual._diff = `${path}: array mismatch`; return false; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) { deepEqual._diff = `${path}.length: ${a.length} vs ${b.length}`; return false; }
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i], `${path}[${i}]`)) return false;
    return true;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) { deepEqual._diff = `${path}: key count ${ka.length} vs ${kb.length}`; return false; }
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) { deepEqual._diff = `${path}: key ${ka[i]} vs ${kb[i]}`; return false; }
    if (!deepEqual(a[ka[i]], b[ka[i]], `${path}.${ka[i]}`)) return false;
  }
  return true;
}

/* ---------------- bracket-outcome fingerprint ---------------- */
function fingerprint(ev) {
  return JSON.stringify({
    placements: ev.placements.map((p) => [p.rank, p.teamId, p.losses]),
    series: ev.series.map((s) => [s.stageId, s.matchId, s.winnerId, s.score.A, s.score.B])
  });
}

/* ---------------- valid Valorant map score ---------------- */
function checkMapScore(seed, sId, mId, mp) {
  const a = mp.score && mp.score.A;
  const b = mp.score && mp.score.B;
  if (typeof a !== 'number' || typeof b !== 'number') {
    violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: non-numeric map score`); return;
  }
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  // winner must reach at least 13
  if (hi < 13) violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: winner score ${hi} < 13`);
  // if both >= 12 it's OT regime -> must win by exactly 2; else first-to-13 with loser <= 11
  if (a >= 12 && b >= 12) {
    if (hi - lo !== 2) violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: OT not win-by-2 (${a}-${b})`);
  } else {
    if (hi !== 13) violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: regulation winner ${hi} != 13 (${a}-${b})`);
    if (lo > 11) violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: regulation loser ${lo} > 11 (${a}-${b})`);
  }
  // rounds played == sum of scores
  const rounds = Array.isArray(mp.rounds) ? mp.rounds.length : -1;
  if (rounds !== a + b) {
    violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: rounds.length ${rounds} != score sum ${a + b}`);
  }
  // named winner matches the higher score
  const expectWinner = a > b ? 'A' : 'B';
  if (mp.winner !== expectWinner) {
    violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: winner '${mp.winner}' but score ${a}-${b}`);
  }
}

/* ---------------- engine-backed series check ---------------- */
function checkSeriesEngineBacked(seed, s) {
  const sId = s.stageId, mId = s.matchId;
  if (!Array.isArray(s.maps) || s.maps.length === 0) {
    violation(`seed ${seed} ${sId}/${mId}: empty/faked maps array`); return;
  }
  // series winner must be one of the two teams
  if (s.winnerId !== s.teamAId && s.winnerId !== s.teamBId) {
    violation(`seed ${seed} ${sId}/${mId}: winnerId not a participant`);
  }
  if (s.teamAId === s.teamBId) {
    violation(`seed ${seed} ${sId}/${mId}: same team on both sides`);
  }
  // map wins must equal series score and clinch bestOf
  let winsA = 0, winsB = 0;
  for (const mp of s.maps) {
    checkMapScore(seed, sId, mId, mp);
    if (mp.winner === 'A') winsA++; else if (mp.winner === 'B') winsB++;
    // finalized box score
    const box = mp.boxScore;
    if (!box || typeof box !== 'object') { violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: no boxScore`); continue; }
    const pids = Object.keys(box);
    if (pids.length < 10) violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: boxScore has ${pids.length} players (<10)`);
    let totalKills = 0, totalDeaths = 0;
    for (const pid of pids) {
      const st = box[pid];
      if (typeof st.kills !== 'number' || typeof st.deaths !== 'number') {
        violation(`seed ${seed} ${sId}/${mId} ${mp.mapId} ${pid}: missing kills/deaths`);
      }
      if (typeof st.acs !== 'number' || !Number.isFinite(st.acs)) {
        violation(`seed ${seed} ${sId}/${mId} ${mp.mapId} ${pid}: acs not finite (${st.acs})`);
      }
      totalKills += st.kills || 0;
      totalDeaths += st.deaths || 0;
    }
    if (totalKills <= 0) violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: zero total kills (faked)`);
    // sanity: kills and deaths should roughly balance (every kill is a death)
    if (totalKills !== totalDeaths) {
      // not necessarily a hard invariant but report large mismatch
      if (Math.abs(totalKills - totalDeaths) > 0) {
        violation(`seed ${seed} ${sId}/${mId} ${mp.mapId}: kills ${totalKills} != deaths ${totalDeaths}`);
      }
    }
  }
  if (winsA !== s.score.A || winsB !== s.score.B) {
    violation(`seed ${seed} ${sId}/${mId}: map-win tally (${winsA}-${winsB}) != series score (${s.score.A}-${s.score.B})`);
  }
  const need = Math.floor(s.bestOf / 2) + 1;
  if (Math.max(winsA, winsB) !== need) {
    violation(`seed ${seed} ${sId}/${mId}: clinch wins ${Math.max(winsA, winsB)} != ceil(bestOf/2) ${need} (bestOf ${s.bestOf})`);
  }
}

/* ---------------- loss-ladder genuineness (placements not faked) ---------------- */
function checkLossLadder(seed, ev) {
  const byRank = new Map(ev.placements.map((p) => [p.rank, p]));
  const expect = { 1: 0, 2: 1, 3: 2, 4: 3 };
  for (const r of [1, 2, 3, 4]) {
    const p = byRank.get(r);
    if (!p) { violation(`seed ${seed}: no placement at rank ${r}`); continue; }
    if (p.losses !== expect[r]) {
      violation(`seed ${seed}: rank ${r} losses ${p.losses} != ${expect[r]}`);
    }
    // cross-check: count actual series this team LOST IN THE PLAYOFF bracket.
    // The §9.1 loss ladder (0/1/2/3) is the triple-elim loss counter, which is
    // scoped to the playoff stage only (group-stage losses are separate).
    let playoffLosses = 0;
    let playoffPlayed = 0;
    for (const s of ev.series) {
      if (s.stageId !== 'playoff') continue;
      if (s.teamAId === p.teamId || s.teamBId === p.teamId) {
        playoffPlayed++;
        if (s.winnerId !== p.teamId) playoffLosses++;
      }
    }
    if (playoffPlayed === 0) {
      violation(`seed ${seed}: rank ${r} ${p.teamId} placed top-4 but played NO playoff series (FAKED placement)`);
    }
    if (playoffLosses !== p.losses) {
      violation(`seed ${seed}: rank ${r} ${p.teamId} recorded losses ${p.losses} but actually lost ${playoffLosses} PLAYOFF series (FAKED placement)`);
    }
  }
  // ranks 5..8 eliminated with exactly 3 playoff losses
  for (const r of [5, 6, 7, 8]) {
    const p = byRank.get(r);
    if (!p) continue;
    if (p.losses !== 3) violation(`seed ${seed}: eliminated rank ${r} losses ${p.losses} != 3`);
    let playoffLosses = 0;
    for (const s of ev.series) {
      if (s.stageId === 'playoff' && (s.teamAId === p.teamId || s.teamBId === p.teamId) && s.winnerId !== p.teamId) playoffLosses++;
    }
    if (playoffLosses !== 3) violation(`seed ${seed}: eliminated rank ${r} ${p.teamId} actual playoff losses ${playoffLosses} != 3 (FAKED)`);
  }
}

/* ---------------- impurity grep on engine/format + engine/career ---------------- */
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
}
function grepImpurity() {
  const dirs = [join(ROOT, 'src/engine/format'), join(ROOT, 'src/engine/career')];
  const files = [];
  for (const d of dirs) { try { walk(d, files); } catch { /* ignore */ } }
  // Math.random / Date.now / new Date / window / document — but only in CODE,
  // not in comments or string literals (the files document that they avoid these).
  const bad = /Math\s*\.\s*random|Date\s*\.\s*now|new\s+Date\b|\bwindow\b|\bdocument\b/;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const code = stripCommentsAndStrings(src);
    const lines = code.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (bad.test(lines[i])) {
        violation(`impurity in ${f.replace(ROOT, '.')}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  return files.length;
}

/**
 * Remove block comments, line comments and string/template literals from JS
 * source while preserving newlines (so reported line numbers stay accurate).
 * Conservative single-pass scanner — good enough to keep prose/strings out of
 * the impurity grep.
 * @param {string} src
 * @returns {string}
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const keepNL = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const seg = src.slice(i, end === -1 ? n : end + 2);
      out += keepNL(seg);
      i += seg.length;
    } else if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      out += keepNL(src.slice(i, j));
      i = j;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        if (src[j] === '\n' && quote !== '`') { break; }
        j++;
      }
      const seg = src.slice(i, j);
      out += keepNL(seg);
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/* ---------------- main ---------------- */
function main() {
  const { teamsById, playersById, ids } = buildWorld();
  if (ids.length !== 12) violation(`expected 12 teams, got ${ids.length}`);
  const ctx = { eventId: 'kickoff-probe', teamsById, playersById };

  const seeds = [];
  for (let s = 1; s <= 40; s++) seeds.push(s);
  seeds.push(2026, 777, 31337, 999983, 123456789);

  const fps = new Map();
  let totalSeries = 0;
  let diffPairs = 0, samePairs = 0;

  for (const seed of seeds) {
    const ev1 = simEvent(KICKOFF_FORMAT, ctx, seed);
    const ev2 = simEvent(KICKOFF_FORMAT, ctx, seed);

    // A) determinism: deep-equal
    deepEqual._diff = '';
    if (!deepEqual(ev1, ev2)) {
      violation(`seed ${seed}: NONDETERMINISM re-sim differs at ${deepEqual._diff}`);
    }

    // structural sanity
    if (ev1.placements.length !== 12) violation(`seed ${seed}: ${ev1.placements.length} placements (!=12)`);
    const ranks = ev1.placements.map((p) => p.rank).sort((a, b) => a - b);
    for (let r = 1; r <= 12; r++) if (ranks[r - 1] !== r) { violation(`seed ${seed}: rank gap/dup at ${r}`); break; }

    // C) engine-backed series + valid scores
    let nSeries = 0;
    for (const s of ev1.series) { checkSeriesEngineBacked(seed, s); nSeries++; }
    totalSeries += nSeries;
    if (nSeries !== 32) violation(`seed ${seed}: ${nSeries} series (expected 32 = 7+7+18)`);

    // D) loss ladder genuineness
    checkLossLadder(seed, ev1);

    fps.set(seed, fingerprint(ev1));
  }

  // B) seed vs seed+1 differ
  for (let s = 1; s <= 39; s++) {
    const a = simEvent(KICKOFF_FORMAT, ctx, s);
    const b = simEvent(KICKOFF_FORMAT, ctx, s + 1);
    if (fingerprint(a) === fingerprint(b)) {
      samePairs++;
      violation(`seeds ${s} and ${s + 1} produce IDENTICAL bracket outcomes`);
    } else diffPairs++;
  }

  const distinct = new Set(fps.values());

  const nFiles = grepImpurity();

  console.log('--- PROBE SUMMARY ---');
  console.log(`seeds tested: ${seeds.length}`);
  console.log(`total series simulated: ${totalSeries}`);
  console.log(`distinct bracket fingerprints: ${distinct.size}/${seeds.length}`);
  console.log(`seed/seed+1 differing pairs: ${diffPairs}; identical pairs: ${samePairs}`);
  console.log(`engine/format+career .js files greped for impurity: ${nFiles}`);
  console.log(`VIOLATIONS: ${violations.length}`);

  if (violations.length > 0) {
    console.error(`\nFAIL: ${violations.length} violation(s).`);
    process.exit(1);
  } else {
    console.log('\nPASS: no determinism / faked-series / impurity violations found.');
  }
}

main();
