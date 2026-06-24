/**
 * scripts/demo-kickoff.mjs — human-readable Kickoff (triple-elim) result.
 *
 * Runs a full VCT Pacific Kickoff via the format engine and prints the final
 * 1-12 standings with loss counts, Championship Points, and qualification, plus
 * a one-line check of the loss ladder. Inspection tool, not a test.
 *
 *   node scripts/demo-kickoff.mjs        # default seed 2026
 *   node scripts/demo-kickoff.mjs 7      # custom seed
 */

import { PACIFIC_SEED } from '../src/data/seed/pacific.js';
import { createPlayer } from '../src/domain/player.js';
import { createTeam } from '../src/domain/team.js';
import { KICKOFF_FORMAT } from '../src/config/formats/kickoff.js';
import { simEvent } from '../src/engine/format/formatEngine.js';
import { awardCP } from '../src/engine/career/championshipPoints.js';
import { kickoffQualifiers } from '../src/engine/career/qualification.js';
import { CP_TABLE } from '../src/config/cpTable.js';

const playersById = {};
for (const p of PACIFIC_SEED.players) { const x = createPlayer(p); playersById[x.id] = x; }
const teamsById = {};
for (const t of PACIFIC_SEED.teams) { const x = createTeam(t); teamsById[x.id] = x; }

const seed = Number(process.argv[2] || 2026);
const ctx = { eventId: 'pacific-kickoff-2026', teamsById, playersById };

const result = simEvent(KICKOFF_FORMAT, ctx, seed);
const cp = awardCP(result, CP_TABLE);
const quals = kickoffQualifiers(result);
const qualBy = {};
for (const q of quals) qualBy[q.teamId] = q.seedInto;

const name = (id) => (teamsById[id] ? teamsById[id].name : id);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

const qualLabel = (p) => {
  if (qualBy[p.teamId] === 'masters-playoff') return 'QUALIFIED -> Masters (playoff seed)';
  if (qualBy[p.teamId] === 'masters-swiss') return 'QUALIFIED -> Masters (Swiss)';
  if (p.rank === 4) return `eliminated (${p.eliminatedIn || 'Lower Final'})`;
  if (p.rank <= 8) return `eliminated (playoff${p.eliminatedIn ? ' ' + p.eliminatedIn : ''})`;
  return 'eliminated (group stage)';
};

console.log(`\n================  VCT Pacific Kickoff 2026  (seed ${seed})  ================`);
console.log(`  ${pad('#', 3)} ${pad('TEAM', 18)} ${lpad('LOSSES', 6)} ${lpad('CP', 3)}  RESULT`);
for (const p of result.placements) {
  console.log(`  ${pad(p.rank, 3)} ${pad(name(p.teamId), 18)} ${lpad(p.losses, 6)} ${lpad(cp[p.teamId] || 0, 3)}  ${qualLabel(p)}`);
}

// Loss-ladder sanity (the centerpiece invariant), shown inline.
const byRank = Object.fromEntries(result.placements.map((p) => [p.rank, p]));
const ladder = [1, 2, 3, 4].map((r) => `${r}:${byRank[r].losses}L`).join('  ');
const expected = byRank[1].losses === 0 && byRank[2].losses === 1 && byRank[3].losses === 2 && byRank[4].losses === 3;
console.log(`\n  Loss ladder (top 4): ${ladder}   ${expected ? 'OK (0/1/2/3 as designed)' : 'VIOLATION!'}`);
console.log(`  Series played: ${result.series.length}   Qualifiers to Masters: ${quals.length}\n`);
