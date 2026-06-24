/**
 * scripts/demo-season.mjs — human-readable walkthrough of one full season.
 *
 * Builds the World, runs simSeason(world, seed), and prints:
 *   - the calendar progression (each slot + its winners),
 *   - each Masters' 12 qualifiers (4 direct / 8 swiss),
 *   - the CP top-10 after the season,
 *   - the 16-team Champions field,
 *   - the crowned champion.
 *
 * Pure presentation over the engine output — no simulation logic lives here.
 * Run: node scripts/demo-season.mjs [seed]
 */

import { buildWorld } from '../src/data/seed/index.js';
import { simSeason } from '../src/engine/career/season.js';
import { CALENDAR } from '../src/engine/career/calendar.js';
import { cpStandings } from '../src/engine/career/championshipPoints.js';

const SEED = process.argv[2] != null ? process.argv[2] : 'demo-2026';

const world = buildWorld();
const season = simSeason(world, SEED);

/** teamId -> display "Name (region)". */
const nameOf = (id) => {
  const t = world.teamsById[id];
  if (!t) return id;
  const region = t.leagueId || '?';
  return `${t.name} [${region}]`;
};

/** rank -> teamId for an EventResult. */
const winnerOf = (result, rank = 1) => {
  const p = result.placements.find((x) => x.rank === rank);
  return p ? p.teamId : undefined;
};

const line = (s = '') => console.log(s);
const rule = (c = '=') => line(c.repeat(72));

rule();
line(`VCT 2026 SEASON DEMO   seed=${JSON.stringify(SEED)}   seasonId=${season.seasonId}`);
rule();

/* ------------------------------------------------------------------ *
 *  Calendar progression
 * ------------------------------------------------------------------ */
line();
line('CALENDAR PROGRESSION');
rule('-');

for (const slot of CALENDAR) {
  if (slot.scope === 'regional') {
    line(`[${slot.index}] ${slot.id.toUpperCase()}  (${slot.type}, regional — 4 parallel events)`);
    const entries = season.events.filter((e) => e.slotId === slot.id);
    for (const e of entries) {
      const champ = nameOf(winnerOf(e.result, 1));
      const second = nameOf(winnerOf(e.result, 2));
      const third = nameOf(winnerOf(e.result, 3));
      line(`     ${e.region.padEnd(9)} winner: ${champ}`);
      line(`     ${' '.repeat(9)} 2nd/3rd: ${second}, ${third}`);
    }
  } else {
    const e = season.events.find((x) => x.slotId === slot.id);
    const champ = nameOf(winnerOf(e.result, 1));
    const second = nameOf(winnerOf(e.result, 2));
    const tag = slot.finalMasters ? ' (final Masters — winner takes Champions direct slot)' : '';
    line(`[${slot.index}] ${slot.id.toUpperCase()}  (${slot.type}, international)${tag}`);
    line(`     winner: ${champ}`);
    line(`     runner-up: ${second}`);
  }
  line();
}

/* ------------------------------------------------------------------ *
 *  Each Masters' 12 qualifiers (4 direct / 8 swiss)
 * ------------------------------------------------------------------ */
line('MASTERS QUALIFIERS  (seeds 1-4 = direct to playoff, seeds 5-12 = Swiss)');
rule('-');

for (const slotId of Object.keys(season.masters)) {
  const { seedOrder } = season.masters[slotId];
  const feedsFrom = CALENDAR.find((s) => s.id === slotId).feedsFrom;
  line(`${slotId.toUpperCase()}  (fed from ${feedsFrom})`);
  line('  DIRECT (seeds 1-4):');
  seedOrder.slice(0, 4).forEach((id, i) => line(`    ${i + 1}. ${nameOf(id)}`));
  line('  SWISS (seeds 5-12):');
  seedOrder.slice(4).forEach((id, i) => line(`    ${i + 5}. ${nameOf(id)}`));
  line();
}

/* ------------------------------------------------------------------ *
 *  CP top-10 after the season
 * ------------------------------------------------------------------ */
line('CHAMPIONSHIP POINTS — TOP 10 (cumulative, end of season)');
rule('-');
cpStandings(season.ledger).slice(0, 10).forEach((row, i) => {
  line(`  ${String(i + 1).padStart(2)}. ${nameOf(row.teamId).padEnd(34)} ${row.cp} CP`);
});
line();

/* ------------------------------------------------------------------ *
 *  The 16-team Champions field
 * ------------------------------------------------------------------ */
line('CHAMPIONS FIELD (16 teams — seed 1 = m2 direct slot, 2-16 by cumulative CP)');
rule('-');
season.championsField.forEach((id, i) => {
  const tag = i === 0 ? '  <- m2 winner (direct)' : '';
  line(`  ${String(i + 1).padStart(2)}. ${nameOf(id)}${tag}`);
});
line();

/* ------------------------------------------------------------------ *
 *  The crowned champion
 * ------------------------------------------------------------------ */
rule();
line(`WORLD CHAMPION 2026:  ${nameOf(season.champion)}`);
rule();
