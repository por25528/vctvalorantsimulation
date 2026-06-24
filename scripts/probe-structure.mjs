/**
 * scripts/probe-structure.mjs — ADVERSARIAL structural probe.
 *
 * Independent of tests/kickoff.test.mjs. Runs simEvent(KICKOFF, ctx, seed) over
 * 250 seeds and checks the STRUCTURE hard:
 *   - exactly 12 placements with ranks 1..12 each appearing once
 *   - exactly 8 distinct teams in the playoff stage; exactly 4 in 9-12
 *   - each group advanced exactly 4 (distinct, all real participants of that group)
 *   - no Series has the same team on both sides
 *   - every Series.winnerId is teamA or teamB of that series
 *   - awardCP gives exactly 4/3/2/1 to ranks 1-4 and 0 to 5-12
 *   - kickoffQualifiers returns exactly 3: rank1 -> masters-playoff,
 *     ranks 2,3 -> masters-swiss
 *   - playoff loss ladder 0/1/2/3 for ranks 1-4; ranks 5-8 exactly 3 losses
 *   - determinism: same seed deep-equals; seeds diverge
 *
 * Reports the FIRST violation found, with seed + offending data. Exits non-zero
 * on any violation.
 */

import { createPlayer } from '../src/domain/player.js';
import { createTeam } from '../src/domain/team.js';
import { PACIFIC_SEED } from '../src/data/seed/pacific.js';
import { simEvent } from '../src/engine/format/formatEngine.js';
import { KICKOFF_FORMAT } from '../src/config/formats/kickoff.js';
import { kickoffQualifiers } from '../src/engine/career/qualification.js';
import { awardCP } from '../src/engine/career/championshipPoints.js';
import { CP_TABLE } from '../src/config/cpTable.js';

const violations = [];
function bad(seed, msg, extra) {
  violations.push({ seed, msg, extra: extra === undefined ? null : extra });
}

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

const { teamsById, playersById, ids } = buildWorld();
if (ids.length !== 12) {
  console.error(`FATAL: expected 12 teams in PACIFIC_SEED, got ${ids.length}`);
  process.exit(2);
}
const ctx = { eventId: 'probe-kickoff', teamsById, playersById };

// 250 distinct seeds.
const seeds = [];
for (let i = 1; i <= 250; i++) seeds.push(i * 7 + 3); // spread them out a bit
if (new Set(seeds).size !== seeds.length) {
  console.error('FATAL: probe seed list not distinct');
  process.exit(2);
}

const fingerprints = new Set();
let checked = 0;

for (const seed of seeds) {
  let ev;
  try {
    ev = simEvent(KICKOFF_FORMAT, ctx, seed);
  } catch (e) {
    bad(seed, 'simEvent threw', String(e && e.message || e));
    continue;
  }
  checked++;

  // ---- placements: 12, ranks 1..12 each once, distinct teams -------------
  if (ev.placements.length !== 12) {
    bad(seed, 'placements length != 12', ev.placements.length);
  }
  const ranks = ev.placements.map((p) => p.rank).slice().sort((a, b) => a - b);
  const wantRanks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  if (JSON.stringify(ranks) !== JSON.stringify(wantRanks)) {
    bad(seed, 'ranks are not exactly 1..12 each once', ranks);
  }
  const placedTeams = ev.placements.map((p) => p.teamId);
  if (new Set(placedTeams).size !== 12) {
    bad(seed, 'placements do not cover 12 distinct teams', placedTeams);
  }
  for (const id of ids) {
    if (!placedTeams.includes(id)) bad(seed, `participant ${id} missing from placements`);
  }

  const byRank = new Map(ev.placements.map((p) => [p.rank, p]));

  // ---- stages -------------------------------------------------------------
  if (ev.stages.length !== 3) bad(seed, 'expected 3 stages', ev.stages.length);
  const groupA = ev.stages.find((s) => s.stageId === 'groupA');
  const groupB = ev.stages.find((s) => s.stageId === 'groupB');
  const playoff = ev.stages.find((s) => s.stageId === 'playoff');
  if (!groupA || !groupB || !playoff) {
    bad(seed, 'missing one of groupA/groupB/playoff stages');
    continue;
  }

  // ---- each group advanced exactly 4 (distinct, real members) ------------
  for (const [label, g] of [['A', groupA], ['B', groupB]]) {
    const adv = g.advancers || [];
    if (adv.length !== 4) bad(seed, `group ${label} advancers != 4`, adv.length);
    if (new Set(adv).size !== adv.length) bad(seed, `group ${label} advancers not distinct`, adv);
    const members = new Set((g.standings || []).map((s) => s.teamId));
    if (members.size !== 6) bad(seed, `group ${label} did not have 6 members`, members.size);
    for (const a of adv) {
      if (!members.has(a)) bad(seed, `group ${label} advancer ${a} is not a member of that group`);
    }
  }
  const allAdv = [...(groupA.advancers || []), ...(groupB.advancers || [])];
  if (new Set(allAdv).size !== 8) bad(seed, '8 advancers not distinct across groups', allAdv);

  // groups must be disjoint and partition the 12 teams
  const aMembers = new Set((groupA.standings || []).map((s) => s.teamId));
  const bMembers = new Set((groupB.standings || []).map((s) => s.teamId));
  for (const t of aMembers) if (bMembers.has(t)) bad(seed, `team ${t} is in both groups`);
  if (aMembers.size + bMembers.size !== 12) {
    bad(seed, 'groups do not partition 12 teams', { a: aMembers.size, b: bMembers.size });
  }

  // ---- exactly 8 distinct teams in playoff; they ARE the 8 advancers -----
  const playoffTeams = new Set((playoff.standings || []).map((s) => s.teamId));
  if (playoffTeams.size !== 8) bad(seed, 'playoff stage does not have 8 distinct teams', playoffTeams.size);
  for (const a of allAdv) {
    if (!playoffTeams.has(a)) bad(seed, `advancer ${a} not present in playoff stage`);
  }

  // ---- exactly 4 teams in 9-12; they are non-advancers -------------------
  const lowFour = [9, 10, 11, 12].map((r) => byRank.get(r) && byRank.get(r).teamId);
  if (lowFour.some((t) => t === undefined)) bad(seed, 'ranks 9-12 not all present');
  if (new Set(lowFour).size !== 4) bad(seed, 'ranks 9-12 not 4 distinct teams', lowFour);
  for (const t of lowFour) {
    if (playoffTeams.has(t)) bad(seed, `rank 9-12 team ${t} is actually a playoff team`);
  }
  // ranks 1-8 are exactly the playoff teams
  for (let r = 1; r <= 8; r++) {
    const t = byRank.get(r) && byRank.get(r).teamId;
    if (!playoffTeams.has(t)) bad(seed, `rank ${r} (${t}) is not a playoff team`);
  }

  // ---- loss ladder --------------------------------------------------------
  const wantLoss = { 1: 0, 2: 1, 3: 2, 4: 3 };
  for (const r of [1, 2, 3, 4]) {
    const p = byRank.get(r);
    if (!p || p.losses !== wantLoss[r]) bad(seed, `rank ${r} losses != ${wantLoss[r]}`, p && p.losses);
  }
  for (let r = 5; r <= 8; r++) {
    const p = byRank.get(r);
    if (!p || p.losses !== 3) bad(seed, `eliminated rank ${r} losses != 3`, p && p.losses);
    if (!p || p.eliminatedIn === undefined) bad(seed, `eliminated rank ${r} missing eliminatedIn`);
  }
  for (const p of ev.placements) {
    if (p.losses > 3) bad(seed, `team ${p.teamId} rank ${p.rank} exceeds 3 losses`, p.losses);
  }

  // ---- series integrity ---------------------------------------------------
  // total = 7 + 7 + 18 = 32
  if (ev.series.length !== 32) bad(seed, 'total series != 32', ev.series.length);
  if ((groupA.series || []).length !== 7) bad(seed, 'groupA series != 7', groupA.series.length);
  if ((groupB.series || []).length !== 7) bad(seed, 'groupB series != 7', groupB.series.length);
  if ((playoff.series || []).length !== 18) bad(seed, 'playoff series != 18', playoff.series.length);

  for (const s of ev.series) {
    if (s.teamAId === s.teamBId) {
      bad(seed, `series ${s.stageId}/${s.matchId} same team both sides`, s.teamAId);
    }
    if (s.winnerId !== s.teamAId && s.winnerId !== s.teamBId) {
      bad(seed, `series ${s.stageId}/${s.matchId} winner not a participant`,
        { winner: s.winnerId, a: s.teamAId, b: s.teamBId });
    }
    if (!Array.isArray(s.maps) || s.maps.length === 0) {
      bad(seed, `series ${s.stageId}/${s.matchId} has no maps`);
    }
  }
  const keys = ev.series.map((s) => `${s.stageId}:${s.matchId}`);
  if (new Set(keys).size !== keys.length) bad(seed, 'duplicate (stage,match) series ids');

  // ---- awardCP ------------------------------------------------------------
  const cp = awardCP(ev, CP_TABLE);
  const wantCp = { 1: 4, 2: 3, 3: 2, 4: 1 };
  for (let r = 1; r <= 4; r++) {
    const t = byRank.get(r).teamId;
    if (cp[t] !== wantCp[r]) bad(seed, `CP for rank ${r} != ${wantCp[r]}`, cp[t]);
  }
  for (let r = 5; r <= 12; r++) {
    const t = byRank.get(r).teamId;
    if (cp[t] !== 0) bad(seed, `CP for rank ${r} != 0`, cp[t]);
  }
  // CP keys exactly cover the 12 teams.
  if (Object.keys(cp).length !== 12) bad(seed, 'awardCP did not cover 12 teams', Object.keys(cp).length);

  // ---- kickoffQualifiers --------------------------------------------------
  const quals = kickoffQualifiers(ev);
  if (quals.length !== 3) bad(seed, 'qualifiers length != 3', quals.length);
  if (quals[0] && (quals[0].teamId !== byRank.get(1).teamId || quals[0].seedInto !== 'masters-playoff')) {
    bad(seed, 'qualifier 1 wrong', quals[0]);
  }
  if (quals[1] && (quals[1].teamId !== byRank.get(2).teamId || quals[1].seedInto !== 'masters-swiss')) {
    bad(seed, 'qualifier 2 wrong', quals[1]);
  }
  if (quals[2] && (quals[2].teamId !== byRank.get(3).teamId || quals[2].seedInto !== 'masters-swiss')) {
    bad(seed, 'qualifier 3 wrong', quals[2]);
  }

  // ---- determinism: same seed -> deep equal ------------------------------
  const again = simEvent(KICKOFF_FORMAT, ctx, seed);
  if (JSON.stringify(again) !== JSON.stringify(ev)) {
    bad(seed, 'non-deterministic: re-sim with same seed differs');
  }

  // fingerprint for divergence check
  fingerprints.add(JSON.stringify(ev.series.map((s) => [s.stageId, s.matchId, s.winnerId, s.score.A, s.score.B])));
}

// divergence: different seeds should not all collapse to one outcome
if (fingerprints.size < seeds.length * 0.9) {
  bad('-', 'low divergence across seeds (possible seed-ignoring)', `${fingerprints.size}/${seeds.length} distinct`);
}

console.log(`probe-structure: checked ${checked}/${seeds.length} seeds; ` +
  `${fingerprints.size} distinct series-fingerprints.`);

if (violations.length) {
  console.error(`\nVIOLATIONS FOUND: ${violations.length}`);
  for (const v of violations.slice(0, 20)) {
    console.error(`  seed=${v.seed}  ${v.msg}` + (v.extra !== null ? `  | ${JSON.stringify(v.extra)}` : ''));
  }
  process.exit(1);
} else {
  console.log('NO VIOLATIONS: all structural invariants held across all seeds.');
}
