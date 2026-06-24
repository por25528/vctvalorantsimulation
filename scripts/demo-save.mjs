/**
 * scripts/demo-save.mjs — the persistence round-trip demo (CONTRACTS-PERSIST §7).
 *
 * Runs a full season, then proves the two persistence guarantees end-to-end:
 *   1. SLOT round-trip — saveSlot -> loadSlot through a MemoryAdapter-backed save
 *      manager reproduces the SAME crowned champion.
 *   2. EXPORT determinism — exportSave strips every round log (small, shareable);
 *      importSave + hydrateSeries then rebuild a sample series' maps BYTE-IDENTICAL
 *      to the originals, straight from the series seed.
 *
 * Pure presentation over the engine + persistence layers — no new sim logic here.
 * Run: node scripts/demo-save.mjs [seed]
 */

import { buildWorld } from '../src/data/seed/index.js';
import {
  initSeason,
  advanceSeason,
  isSeasonComplete,
  hydrateSeries
} from '../src/engine/career/season.js';
import { createMemoryAdapter } from '../src/persistence/adapter.js';
import { createSaveManager } from '../src/persistence/saveManager.js';
import { newSaveMeta } from '../src/persistence/migrations.js';
import { exportSave, importSave } from '../src/persistence/serializer.js';

const SEED = process.argv[2] != null ? process.argv[2] : 'demo-2026';

const line = (s = '') => console.log(s);
const rule = (c = '=') => line(c.repeat(72));

/** teamId -> display "Name [region]". */
const world = buildWorld();
const nameOf = (id) => {
  const t = world.teamsById[id];
  return t ? `${t.name} [${t.leagueId || '?'}]` : id;
};

/** Adapt the engine World to the world-slice shape a SaveGame carries. */
function worldToSlice(w) {
  return { leagues: w.leagues, teams: w.teamsById, players: w.playersById };
}

/** Find the first played series (with non-empty round logs) across a season. */
function firstPlayedSeries(season) {
  for (const entry of season.events) {
    const series = (entry.result && entry.result.series) || [];
    for (const s of series) {
      const maps = (s && s.maps) || [];
      if (maps.some((m) => Array.isArray(m.rounds) && m.rounds.length > 0)) {
        return { eventId: (entry.result && entry.result.eventId) || entry.slotId, series: s };
      }
    }
  }
  return null;
}

/** Locate a series by id inside a (loaded/imported) season. */
function findSeriesById(season, id) {
  for (const entry of season.events) {
    const series = (entry.result && entry.result.series) || [];
    const hit = series.find((s) => s && s.id === id);
    if (hit) return hit;
  }
  return null;
}

rule();
line(`VCT 2026 PERSISTENCE DEMO   seed=${JSON.stringify(SEED)}`);
rule();

/* ------------------------------------------------------------------ *
 *  1. Run a full season (stepped, so we hold the live SeasonState).
 * ------------------------------------------------------------------ */
let season = initSeason(world, SEED);
while (!isSeasonComplete(season)) season = advanceSeason(season, world);

const champion = season.champion;
line();
line(`Ran a full season — ${season.events.length} events played.`);
line(`World Champion: ${nameOf(champion)}`);

// Capture a sample series (with its original logs) BEFORE any stripping.
const sample = firstPlayedSeries(season);
if (!sample) throw new Error('demo-save: no played series found in the season');
const originalMapsJson = JSON.stringify(sample.series.maps);
line(`Sample series: ${sample.series.id} (${sample.eventId}) — ${sample.series.maps.length} map(s).`);

/* ------------------------------------------------------------------ *
 *  2. SLOT round-trip through a MemoryAdapter-backed save manager.
 * ------------------------------------------------------------------ */
const manager = createSaveManager(createMemoryAdapter());
const saveGame = {
  meta: newSaveMeta('Demo Career', SEED, season.slotIndex),
  world: worldToSlice(world),
  season,
  settings: { followedTeamId: null }
};

const meta = await manager.saveSlot(saveGame);
const loaded = await manager.loadSlot(meta.id);

line();
rule('-');
line('1. SLOT ROUND-TRIP  (saveSlot -> loadSlot via MemoryAdapter)');
rule('-');
const slotOk = loaded && loaded.season && loaded.season.champion === champion;
line(`   loaded champion: ${nameOf(loaded && loaded.season && loaded.season.champion)}`);
line(`   ${slotOk ? 'PASS' : 'FAIL'} — loaded save reproduces the same champion.`);

/* ------------------------------------------------------------------ *
 *  3. EXPORT (log-stripped) -> IMPORT -> hydrate -> byte-identical maps.
 * ------------------------------------------------------------------ */
const json = exportSave(saveGame); // default: strip every rounds[]
const exportHasLogs = json.includes('"rounds":[{');
const imported = importSave(json);

const strippedSeries = findSeriesById(imported.season, sample.series.id);
if (!strippedSeries) throw new Error('demo-save: sample series missing after import');
const strippedRounds = (strippedSeries.maps || []).reduce(
  (n, m) => n + ((m.rounds && m.rounds.length) || 0),
  0
);
const hydrated = hydrateSeries(strippedSeries, world);
const hydratedMapsJson = JSON.stringify(hydrated.maps);
const exportOk = !exportHasLogs && strippedRounds === 0 && hydratedMapsJson === originalMapsJson;

line();
rule('-');
line('2. EXPORT DETERMINISM  (exportSave strips logs; hydrateSeries rebuilds them)');
rule('-');
line(`   export size: ${json.length} chars; embedded round logs: ${exportHasLogs ? 'YES' : 'none'}`);
line(`   imported sample series rounds before hydrate: ${strippedRounds}`);
line(`   ${exportOk ? 'PASS' : 'FAIL'} — rehydrated maps are byte-identical to the originals.`);

rule();
const allOk = slotOk && exportOk;
line(allOk ? 'ALL GOOD — persistence round-trip is deterministic.' : 'FAILURE — see above.');
rule();

if (!allOk) process.exitCode = 1;
