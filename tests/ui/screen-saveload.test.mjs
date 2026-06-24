/**
 * tests/ui/screen-saveload.test.mjs — the SaveLoad screen, headless via toHtml
 * (CONTRACTS-PERSIST §6, §7). Default-exported async fn that throws on failure
 * (tests/run.mjs convention).
 *
 * Covers:
 *   1. The screen renders all four controls (Save Current, slot list, Export,
 *      Import paste textarea + file input) without throwing — headlessly via
 *      toHtml (no DOM).
 *   2. After saveCurrent through the real commands (Node's MemoryAdapter-backed
 *      module saveManager), the ui-held slot list (state.ui.saveSlots) is
 *      populated and the screen renders the slot's name + Load/Delete/Duplicate.
 *   3. The serializer round-trip importSave(exportSave(state)) reproduces the
 *      SaveGame through a MemoryAdapter-backed saveManager: save -> export ->
 *      import -> saveSlot -> loadSlot yields a deep-equal SaveGame (and the
 *      compact export carries no rounds[]).
 *   4. The importSave COMMAND restores state: export the current career, mutate
 *      the store (clear it), then importSave(store, json) re-hydrates the season
 *      + champion identically.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import {
  bootstrap,
  continueSeason,
  saveCurrent,
  exportCurrent,
  importSave,
  refreshSlots,
  clearAutosave
} from '../../src/state/commands.js';
import { selectSaveSlots, selectSeason, selectChampion } from '../../src/state/selectors.js';
import { SaveLoadScreen } from '../../src/ui/screens/SaveLoad.js';

import { createMemoryAdapter } from '../../src/persistence/adapter.js';
import { createSaveManager } from '../../src/persistence/saveManager.js';
import { newSaveMeta } from '../../src/persistence/migrations.js';
import { exportSave, importSave as deserialize } from '../../src/persistence/serializer.js';

/** Count non-overlapping occurrences of a substring. */
function countOf(haystack, needle) {
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

/** True if any series under any season event still has a non-empty rounds[]. */
function anyRounds(saveGame) {
  const events = (saveGame.season && saveGame.season.events) || [];
  for (const entry of events) {
    const result = entry.result || {};
    const lists = [result.series || [], ...((result.stages || []).map((s) => s.series || []))];
    for (const list of lists) {
      for (const series of list) {
        for (const map of (series && series.maps) || []) {
          if (Array.isArray(map.rounds) && map.rounds.length > 0) return true;
        }
      }
    }
  }
  return false;
}

export default async function run() {
  // Clean the rolling autosave so the module saveManager (a process singleton)
  // doesn't leak a prior suite's slots into our listing assertions.
  await clearAutosave();

  const store = buildStore();
  await bootstrap(store, { fresh: true });
  // Advance a couple of slots so the season has real events to serialize.
  continueSeason(store, { simEvent: true });
  continueSeason(store, { simEvent: true });

  const dispatch = (a) => store.dispatch(a);

  section('controls render headlessly');
  {
    const html = toHtml(SaveLoadScreen(store.getState(), dispatch, store));
    assert(html.includes('id="screen-saves"'), 'saves screen root present');
    assert(html.includes('saves__save-btn'), 'Save Current button present');
    assert(html.includes('saves__export-btn'), 'Export button present');
    assert(html.includes('saves__import-text'), 'Import paste textarea present');
    assert(html.includes('type="file"'), 'Import file input present');
    assert(html.includes('saves__slots'), 'slot-list panel present');
  }

  section('slot list reflects a saved career');
  {
    const meta = await saveCurrent(store, 'Round Trip Save');
    assert(meta && meta.id, 'saveCurrent returned a meta with an id');
    // saveCurrent awaits refreshSlots, so the ui-held list is populated.
    const slots = selectSaveSlots(store.getState());
    assert(slots.length >= 1, 'ui-held save-slot list is populated');
    assert(slots.some((m) => m.name === 'Round Trip Save'), 'the saved slot is listed');

    const html = toHtml(SaveLoadScreen(store.getState(), dispatch, store));
    assert(html.includes('Round Trip Save'), 'slot name rendered');
    assert(countOf(html, 'saves__load') >= 1, 'a Load button rendered');
    assert(countOf(html, 'saves__delete') >= 1, 'a Delete button rendered');
    assert(countOf(html, 'saves__dup') >= 1, 'a Duplicate button rendered');
  }

  section('serializer round-trip through a MemoryAdapter-backed saveManager');
  {
    // Build an ISOLATED MemoryAdapter-backed manager (per the contract).
    const manager = createSaveManager(createMemoryAdapter());

    const state = store.getState();
    const season = selectSeason(state);
    const saveGame = {
      meta: newSaveMeta('Export Source', season.seed, 0),
      world: state.world,
      season,
      settings: { followedTeamId: state.ui.followedTeamId || null }
    };

    // export (compact) -> import -> persist -> load.
    const json = exportSave(saveGame);
    const compact = deserialize(json);
    assert(!anyRounds(compact), 'compact export carries no round logs');

    const writtenMeta = await manager.saveSlot(compact);
    const loaded = await manager.loadSlot(writtenMeta.id);
    assert(loaded, 'loadSlot returned the persisted save');

    // The season survives the export->import->save->load round-trip.
    assertEqual(loaded.season.champion, compact.season.champion, 'champion preserved');
    assertEqual(loaded.season.slotIndex, season.slotIndex, 'slotIndex preserved');
    assertEqual(
      loaded.season.events.map((e) => e.slotId),
      compact.season.events.map((e) => e.slotId),
      'event slot ids preserved'
    );
    assertEqual(loaded.settings, compact.settings, 'settings preserved');
  }

  section('importSave command restores store state');
  {
    const before = store.getState();
    const champBefore = selectChampion(before);
    const slotBefore = selectSeason(before).slotIndex;

    const json = exportCurrent(store);

    // Tear the live season down to prove the import re-installs it.
    const fresh = buildStore();
    await bootstrap(fresh, { fresh: true });   // a different, unadvanced season
    assertEqual(selectSeason(fresh.getState()).slotIndex, 0, 'fresh store is unadvanced');

    importSave(fresh, json);
    const after = fresh.getState();
    assertEqual(selectSeason(after).slotIndex, slotBefore, 'imported slotIndex restored');
    assertEqual(selectChampion(after), champBefore, 'imported champion restored');
    assert(
      toHtml(SaveLoadScreen(after, fresh.dispatch, fresh)).includes('id="screen-saves"'),
      'SaveLoad renders against the imported state'
    );
  }
}
