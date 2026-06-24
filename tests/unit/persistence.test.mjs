/**
 * tests/unit/persistence.test.mjs — persistence layer over the MemoryAdapter
 * (CONTRACTS-PERSIST §7). Headless: createMemoryAdapter() makes the whole layer
 * runnable in Node.
 *
 * Covers:
 *  - adapter get/put/delete/list mechanics + clone isolation
 *  - getDefaultAdapter() falls back to Memory in Node
 *  - saveSlot -> listSlots -> loadSlot deep-equal round-trip (+ lastPlayed sort)
 *  - deleteSlot / duplicateSlot
 *  - autosave -> reserved slot id (+ coalesced rapid calls)
 *  - migrate identity at v1 (+ future-version rejection)
 *  - exportSave produces valid JSON with NO rounds[] anywhere; includeLogs keeps them
 *  - importSave(exportSave(s)) parses back to a migrated, stripped SaveGame
 *
 * Performance note: a full simSeason payload is ~190 MB of JSON, and the
 * MemoryAdapter deep-clones on every get/put (mirroring IndexedDB's structured-
 * clone boundary so callers can't mutate frozen engine outputs). So we build the
 * heavy season EXACTLY ONCE and reuse it; slot-mechanics cases that don't need
 * real round logs use tiny synthetic SaveGames, and the adapter round-trip uses
 * the log-STRIPPED (small) season. The hydrate round-trip (stripped save +
 * hydrateSeries reproduces identical maps) is exercised in seasonStep/integration.
 */

import { assert, assertEqual } from '../_assert.mjs';

import { createMemoryAdapter } from '../../src/persistence/adapter.js';
import { getDefaultAdapter } from '../../src/persistence/db.js';
import {
  SCHEMA_VERSION,
  migrate,
  newSaveMeta
} from '../../src/persistence/migrations.js';
import { createSaveManager } from '../../src/persistence/saveManager.js';
import {
  exportSave,
  importSave,
  stripLogs
} from '../../src/persistence/serializer.js';

import { buildWorld } from '../../src/data/seed/index.js';
import { simSeason } from '../../src/engine/career/season.js';

/** Recursively assert no `rounds` array anywhere carries entries. */
function assertNoRounds(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoRounds(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (k === 'rounds') {
        assert(
          Array.isArray(value[k]) && value[k].length === 0,
          `expected no round logs at ${path}.rounds, found ${Array.isArray(value[k]) ? value[k].length : typeof value[k]}`
        );
      }
      assertNoRounds(value[k], `${path}.${k}`);
    }
  }
}

/** Count total round logs anywhere under a value. */
function countRounds(value) {
  let n = 0;
  if (Array.isArray(value)) {
    for (const v of value) n += countRounds(v);
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (k === 'rounds' && Array.isArray(value[k])) n += value[k].length;
      else n += countRounds(value[k]);
    }
  }
  return n;
}

/**
 * A tiny synthetic SaveGame for slot-mechanics that don't need real round logs.
 * @param {string} name
 * @param {number} seed
 * @returns {object} SaveGame
 */
function tinySave(name, seed) {
  return {
    meta: newSaveMeta(name, seed),
    world: { leagues: {}, teamsById: {}, playersById: {} },
    season: { seed, slotIndex: 0, events: [], complete: false },
    settings: { followedTeamId: null }
  };
}

export default async function run() {
  // Build the ONE heavy season payload up front (expensive — reuse everywhere).
  const world = buildWorld();
  const heavySeason = simSeason(world, 21);
  const heavySave = {
    meta: newSaveMeta('Test Career', 21),
    world,
    season: heavySeason,
    settings: { followedTeamId: null }
  };
  // A log-stripped (small) variant for adapter round-trips through the clone path.
  const lightSave = stripLogs(heavySave);

  // --- adapter mechanics + clone isolation ---
  {
    const a = createMemoryAdapter();
    assert((await a.get('saves', 'nope')) === null, 'missing key -> null');
    await a.put('saves', 'k', { n: 1, nested: { x: [1, 2] } });
    const got = await a.get('saves', 'k');
    assertEqual(got, { n: 1, nested: { x: [1, 2] } }, 'get returns stored value');

    // mutating the returned value must not affect the store (clone-out).
    got.n = 999;
    got.nested.x.push(3);
    assertEqual(
      await a.get('saves', 'k'),
      { n: 1, nested: { x: [1, 2] } },
      'stored value is isolated from caller mutation'
    );

    assertEqual(
      await a.list('saves'),
      [{ key: 'k', value: { n: 1, nested: { x: [1, 2] } } }],
      'list returns entries'
    );
    await a.delete('saves', 'k');
    assert((await a.get('saves', 'k')) === null, 'delete removes key');
    assertEqual(await a.list('saves'), [], 'list empty after delete');

    // two adapters are independent (no shared module state).
    const b = createMemoryAdapter();
    await b.put('meta', 'x', 1);
    assert((await a.get('meta', 'x')) === null, 'adapters are isolated');
  }

  // --- getDefaultAdapter in Node falls back to a Memory adapter (no crash) ---
  {
    const def = getDefaultAdapter();
    assert(def && typeof def.put === 'function', 'getDefaultAdapter returns a StorageAdapter in Node');
    await def.put('saves', 'probe', { ok: true });
    assertEqual(await def.get('saves', 'probe'), { ok: true }, 'default adapter works in Node');
  }

  // --- migrate identity at v1 + future-version rejection ---
  {
    const save = tinySave('Migrate', 7);
    assert(save.meta.schemaVersion === SCHEMA_VERSION, 'newSaveMeta stamps current schema');
    assertEqual(migrate(save), save, 'migrate is identity at v1');

    let threw = false;
    try {
      migrate({ ...save, meta: { ...save.meta, schemaVersion: SCHEMA_VERSION + 1 } });
    } catch {
      threw = true;
    }
    assert(threw, 'migrate rejects an unknown future schemaVersion');

    threw = false;
    try {
      migrate({ world: {} });
    } catch {
      threw = true;
    }
    assert(threw, 'migrate rejects a save with no meta');
  }

  // --- saveSlot -> listSlots -> loadSlot deep-equal round-trip (light payload) ---
  {
    const adapter = createMemoryAdapter();
    const mgr = createSaveManager(adapter);

    assertEqual(await mgr.listSlots(), [], 'no slots initially');

    const meta = await mgr.saveSlot(lightSave);
    assert(meta.id === lightSave.meta.id, 'saveSlot returns the slot meta');

    const slots = await mgr.listSlots();
    assert(slots.length === 1 && slots[0].id === meta.id, 'one slot listed with matching id');

    const loaded = await mgr.loadSlot(meta.id);
    // saveSlot restamps lastPlayed; compare against the persisted meta.
    assertEqual(loaded, { ...lightSave, meta }, 'loadSlot deep-equals the saved SaveGame');

    assert((await mgr.loadSlot('does-not-exist')) === null, 'loadSlot of missing id -> null');

    // listSlots sorts by lastPlayed desc — newest save first.
    const meta2 = await mgr.saveSlot({
      ...tinySave('Second', 12),
      meta: { ...newSaveMeta('Second', 12), lastPlayed: meta.lastPlayed + 1000 }
    });
    const ordered = await mgr.listSlots();
    assert(ordered.length === 2 && ordered[0].id === meta2.id, 'most-recently-played slot is first');
  }

  // --- deleteSlot ---
  {
    const mgr = createSaveManager(createMemoryAdapter());
    const meta = await mgr.saveSlot(tinySave('Del', 3));
    assert((await mgr.listSlots()).length === 1, 'slot present before delete');
    await mgr.deleteSlot(meta.id);
    assertEqual(await mgr.listSlots(), [], 'slot gone after delete');
    assert((await mgr.loadSlot(meta.id)) === null, 'payload gone after delete');
  }

  // --- duplicateSlot ---
  {
    const mgr = createSaveManager(createMemoryAdapter());
    const original = await mgr.saveSlot(tinySave('Orig', 5));
    const dup = await mgr.duplicateSlot(original.id, 'Copy Career');
    assert(dup.id !== original.id, 'duplicate gets a fresh id');
    assert(dup.name === 'Copy Career', 'duplicate uses the new name');

    const slots = await mgr.listSlots();
    assert(slots.length === 2, 'duplicate adds a second slot');

    const origGame = await mgr.loadSlot(original.id);
    const dupGame = await mgr.loadSlot(dup.id);
    assertEqual(dupGame.season, origGame.season, 'duplicate copies the season payload');
    assert(dupGame.meta.id === dup.id, 'duplicate payload carries the new id');

    let threw = false;
    try {
      await mgr.duplicateSlot('missing');
    } catch {
      threw = true;
    }
    assert(threw, 'duplicateSlot rejects a missing source');
  }

  // --- autosave writes to the reserved slot id (+ coalesced rapid calls) ---
  {
    const mgr = createSaveManager(createMemoryAdapter());
    const meta = await mgr.autosave(tinySave('Auto', 9));
    assert(meta.id === mgr.AUTOSAVE_ID, 'autosave writes the reserved slot id');
    const loaded = await mgr.loadSlot(mgr.AUTOSAVE_ID);
    assert(loaded && loaded.meta.id === mgr.AUTOSAVE_ID, 'autosave slot is loadable');

    const results = await Promise.all([
      mgr.autosave(tinySave('Auto', 9)),
      mgr.autosave(tinySave('Auto', 9)),
      mgr.autosave(tinySave('Auto', 9))
    ]);
    assert(
      results.every((m) => m.id === mgr.AUTOSAVE_ID),
      'coalesced autosaves all resolve to the reserved slot'
    );
    // Coalesced: still exactly one autosave slot in the index.
    const autosaveSlots = (await mgr.listSlots()).filter((m) => m.id === mgr.AUTOSAVE_ID);
    assert(autosaveSlots.length === 1, 'autosave occupies exactly one reserved slot');
  }

  // --- exportSave strips ALL rounds[] and is valid JSON (heavy season) ---
  {
    const sourceRounds = countRounds(heavySave.season.events);
    assert(sourceRounds > 0, 'source season has round logs to strip');

    const json = exportSave(heavySave); // default includeLogs:false
    assert(typeof json === 'string', 'exportSave returns a string');
    const parsed = JSON.parse(json); // valid JSON or throws
    assertNoRounds(parsed.season.events, '$.season.events');
    assert(countRounds(parsed.season.events) === 0, 'no round logs survive export');

    // stripLogs helper is pure — does not mutate the source.
    stripLogs(heavySave);
    assert(
      countRounds(heavySave.season.events) === sourceRounds,
      'stripLogs does not mutate the source'
    );

    // includeLogs:true keeps the logs.
    const full = JSON.parse(exportSave(heavySave, { includeLogs: true }));
    assert(countRounds(full.season.events) === sourceRounds, 'includeLogs:true preserves round logs');
  }

  // --- importSave(exportSave(s)) parses back to a migrated, stripped SaveGame ---
  {
    const reimported = importSave(exportSave(heavySave));
    assert(reimported && reimported.meta && reimported.meta.id === heavySave.meta.id, 'import preserves meta');
    assert(reimported.meta.schemaVersion === SCHEMA_VERSION, 'import migrates to current schema');
    assert(countRounds(reimported.season.events) === 0, 'imported (stripped) save has no round logs');
    // The re-imported save deep-equals the JSON-normalized, locally-stripped save.
    assertEqual(
      reimported,
      JSON.parse(JSON.stringify(stripLogs(heavySave))),
      'import round-trips the stripped save'
    );

    let threw = false;
    try {
      importSave('{not json');
    } catch {
      threw = true;
    }
    assert(threw, 'importSave rejects invalid JSON');
  }
}
