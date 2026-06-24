/**
 * scripts/demo-career.mjs — a multi-season career walkthrough (CONTRACTS-CAREER §5).
 *
 * Runs a few seasons of the career engine and narrates each year: the World
 * Champion, the brightest riser (development), notable retirements, the top
 * newgen, and the headline transfers. Pure presentation over the engine output.
 *
 * Run: node scripts/demo-career.mjs [seed] [seasons]
 */

import { initCareer, advanceCareer } from '../src/engine/career/career.js';
import { overall } from '../src/engine/career/playerStats.js';

const SEED = process.argv[2] != null ? process.argv[2] : 'demo-2026';
const SEASONS = process.argv[3] != null ? Number(process.argv[3]) : 3;

const line = (s = '') => console.log(s);
const rule = (c = '=') => line(c.repeat(72));

/** Display name for a player id against a given world. */
function pname(world, id) {
  const p = world.playersById[id];
  return p ? `${p.handle} (${p.role}, ${p.age}yo)` : id;
}
/** Display name for a team id. */
function tname(world, id) {
  const t = world.teamsById[id];
  return t ? `${t.name} [${t.leagueId || '?'}]` : id;
}

rule();
line(`VCT 2026 CAREER DEMO   seed=${JSON.stringify(SEED)}   seasons=${SEASONS}`);
rule();

let state = initCareer(SEED);
let guard = 0;
let injuryPeak = 0; // most players carrying a knock at once this season
// A unified career step plays one slot, OR (when the season has finished and the
// state is paused in 'offseason') resolves the off-season and rolls into the next
// season — which is the step that appends to history. ~9 steps/season.
while (state.history.length < SEASONS && guard < SEASONS * 18 + 16) {
  const before = state.history.length;
  state = advanceCareer(state);
  guard += 1;
  if (state.history.length === before) {
    // mid-season slot: sample the current injury load.
    let inj = 0;
    for (const id of Object.keys(state.world.playersById)) if (state.world.playersById[id].injury) inj += 1;
    injuryPeak = Math.max(injuryPeak, inj);
    continue;
  }

  // A season just rolled over: summary at history[before], report at state.offseason,
  // names resolved against the new (post-off-season) world which holds everyone.
  const summary = state.history[before];
  const report = state.offseason;
  const world = state.world;

  line();
  rule('-');
  line(`SEASON ${summary.seasonIndex}`);
  rule('-');
  line(`  World Champion:  ${tname(world, summary.champion)}`);

  const mvp = summary.awards && summary.awards.mvp;
  if (mvp) line(`  Season MVP:      ${mvp.handle} (${mvp.role}) — ${mvp.acs} ACS over ${mvp.maps} maps`);
  const finalsMvp = summary.awards && summary.awards.finalsMvp;
  if (finalsMvp) line(`  Finals MVP:      ${finalsMvp.handle} (${finalsMvp.role}) — ${finalsMvp.acs} ACS`);
  line(`  Injury load:     up to ${injuryPeak} players carrying a knock at once`);
  injuryPeak = 0;

  const riser = report.developed[0];
  if (riser) line(`  Brightest riser: ${pname(world, riser.id)}  (+${riser.trajectory.toFixed(1)} overall, now ${Math.round(overall(world.playersById[riser.id]))})`);

  if (report.retired.length) {
    const names = report.retired.slice(0, 4).map((id) => pname(world, id)).join(', ');
    line(`  Retirements (${report.retired.length}): ${names}${report.retired.length > 4 ? ', …' : ''}`);
  } else {
    line('  Retirements: none');
  }

  const topNewgen = report.newgens
    .map((id) => world.playersById[id])
    .filter(Boolean)
    .sort((a, b) => b.potential - a.potential)[0];
  if (topNewgen) line(`  Top newgen:      ${topNewgen.handle} (${topNewgen.role}, ${topNewgen.age}yo) — potential ${topNewgen.potential}`);

  const headline = report.transfers
    .filter((m) => m.toTeamId)
    .sort((a, b) => b.salary - a.salary)
    .slice(0, 3);
  if (headline.length) {
    line('  Headline signings:');
    for (const m of headline) {
      line(`     ${pname(world, m.playerId)} -> ${tname(world, m.toTeamId)}  ($${(m.salary / 1000).toFixed(0)}k${m.kind === 'transfer' ? ', upgrade' : ''})`);
    }
  }
}

line();
rule();
line(`Career ran ${state.history.length} season(s). Final world: ${Object.keys(state.world.playersById).length} players across ${Object.keys(state.world.teamsById).length} teams.`);
rule();
