/**
 * scripts/demo-match.mjs — human-readable Phase-1 engine demo.
 *
 * Simulates a single Bo3 between two Pacific seed teams and prints the series
 * result, per-map scoreline + side/economy summary, and a full box score for
 * map 1, sorted by ACS. Pure inspection tool — not part of the test suite.
 *
 *   node scripts/demo-match.mjs            # default PRX vs DRX, seed 2026
 *   node scripts/demo-match.mjs t1 geng 7  # custom: teamA teamB seed
 */

import { PACIFIC_SEED } from '../src/data/seed/pacific.js';
import { createPlayer } from '../src/domain/player.js';
import { createTeam } from '../src/domain/team.js';
import { simSeries } from '../src/engine/match/matchSim.js';

const playersById = {};
for (const p of PACIFIC_SEED.players) { const x = createPlayer(p); playersById[x.id] = x; }
const teamsById = {};
for (const t of PACIFIC_SEED.teams) { const x = createTeam(t); teamsById[x.id] = x; }

const [, , aArg, bArg, seedArg] = process.argv;
const aId = aArg || 'prx';
const bId = bArg || 'drx';
const seed = Number(seedArg || 2026);

const teamA = teamsById[aId] || Object.values(teamsById)[0];
const teamB = teamsById[bId] || Object.values(teamsById)[1];

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const handle = (id) => (playersById[id] ? playersById[id].handle : id);

const series = simSeries(teamA, teamB, playersById, 3, seed);

console.log(`\n==== ${teamA.name} vs ${teamB.name}  (Bo3, seed ${seed}) ====`);
console.log(`SERIES: ${teamA.tag} ${series.score.A}-${series.score.B} ${teamB.tag}  ->  winner: ${series.winnerId}`);
console.log(`Veto picks: ${series.veto.picks.map((p) => `${p.mapId}(${p.by})`).join(', ')}`);

series.maps.forEach((m, i) => {
  const w = m.winner === 'A' ? teamA.tag : teamB.tag;
  const conds = {};
  for (const r of m.rounds) conds[r.endCondition] = (conds[r.endCondition] || 0) + 1;
  const condStr = Object.entries(conds).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`  Map ${i + 1}  ${pad(m.mapId, 9)}  ${teamA.tag} ${m.score.A}-${m.score.B} ${teamB.tag}  (${w} win, startA=${m.sideStartA})  [${condStr}]`);
});

// Box score for map 1, both teams, sorted by ACS.
const m1 = series.maps[0];
console.log(`\n---- Box score: Map 1 (${m1.mapId}) ----`);
console.log(`  ${pad('PLAYER', 12)} ${lpad('ACS', 4)} ${lpad('K', 3)} ${lpad('D', 3)} ${lpad('A', 3)} ${lpad('FB', 3)} ${lpad('CL', 3)} ${lpad('KD', 5)}`);
const rows = (team, ids) => {
  console.log(`  -- ${team.name} --`);
  ids.filter((id) => m1.boxScore[id])
    .map((id) => ({ id, s: m1.boxScore[id] }))
    .sort((x, y) => y.s.acs - x.s.acs)
    .forEach(({ id, s }) => {
      const mvp = id === m1.mvpPlayerId ? ' *MVP' : '';
      console.log(`  ${pad(handle(id), 12)} ${lpad(Math.round(s.acs), 4)} ${lpad(s.kills, 3)} ${lpad(s.deaths, 3)} ${lpad(s.assists, 3)} ${lpad(s.firstBloods, 3)} ${lpad(s.clutches, 3)} ${lpad(s.kd.toFixed(2), 5)}${mvp}`);
    });
};
rows(teamA, teamA.roster.slice(0, 5));
rows(teamB, teamB.roster.slice(0, 5));
console.log('');
