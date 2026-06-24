# CONTRACTS-PERSIST — Phase 5 Persistence + Season UI (binding interface spec)

Builds on all prior contracts. Phase 5 does two things: (A) a **persistence layer** (named save slots, autosave, JSON export/import) and (B) wires the existing Phase-3 UI to the **full 4-league season** built in Phase 4 (browse all 20 events, the CP race, Masters/Champions, crown screen) instead of only the Pacific Kickoff.

Rules unchanged: engine/domain/config/format/career stay DOM-free and `Date`-free. **Exception:** `src/persistence/**` and `src/ui/**` and `src/main.js` MAY use `Date.now()` (save timestamps) and browser storage — but persistence logic is abstracted behind a `StorageAdapter` so it runs and is tested in Node with an in-memory adapter. Existing screens are PARAMETERIZED, not rewritten.

---

## 1. Storage abstraction — `src/persistence/adapter.js`, `db.js`

```js
/** @typedef StorageAdapter  — async KV over named stores ('saves','meta')
 *  get(store, key)    -> Promise<value|null>
 *  put(store, key, v) -> Promise<void>
 *  delete(store, key) -> Promise<void>
 *  list(store)        -> Promise<Array<{key, value}>>
 */
export function createMemoryAdapter()           // Map-backed, Promise-wrapped — for Node + tests
// db.js:
export function createIndexedDBAdapter(dbName='vct2026')  // browser; object stores 'saves' + 'meta'; same StorageAdapter shape
export function getDefaultAdapter()             // IndexedDBAdapter when indexedDB exists, else MemoryAdapter (so Node imports never crash)
```
All persistence APIs are async (Promise-returning) because IndexedDB is. `MemoryAdapter` makes the whole layer headlessly testable.

## 2. SaveGame & migrations — `src/persistence/migrations.js`

```js
/** @typedef SaveGame {
 *   meta:{ id, name, schemaVersion:number, seed:number|string, slotIndex:number, createdAt:number, lastPlayed:number },
 *   world: World,                 // teams/players/leagues — persisted (editable in later phases)
 *   season: SeasonState,          // §4 — calendar progress, completed events, CP ledger, champion
 *   settings:{ followedTeamId:string|null }
 * } */
export const SCHEMA_VERSION = 1;
export function migrate(saveGame)   // run ordered upgrades up to SCHEMA_VERSION; v1 is identity; throws on unknown future version
export function newSaveMeta(name, seed)  // build a fresh meta (id, timestamps via Date.now in this layer)
```

## 3. Save manager + serializer — `src/persistence/saveManager.js`, `serializer.js`

```js
// saveManager.js — adapter-injected, all async
export function createSaveManager(adapter=getDefaultAdapter()) // -> {
//   listSlots()                 -> Promise<Array<meta>>                 (from 'meta' store, sorted by lastPlayed desc)
//   saveSlot(saveGame)          -> Promise<meta>                        (write full SaveGame to 'saves', meta to 'meta')
//   loadSlot(id)                -> Promise<SaveGame|null>               (read + migrate)
//   deleteSlot(id)              -> Promise<void>
//   duplicateSlot(id, newName)  -> Promise<meta>
//   autosave(saveGame)          -> Promise<meta>                        (debounced write to a reserved 'autosave' slot id)
// }

// serializer.js — pure (no adapter)
export function exportSave(saveGame, { includeLogs=false }={})  // -> JSON string. When !includeLogs, STRIP every season.events[].result...maps[].rounds (the bulky round logs) — they regenerate from seeds. Keeps export small/shareable.
export function importSave(jsonString)   // -> SaveGame (JSON.parse + migrate). Absent rounds[] are left absent (rehydrate on demand, §4 hydrateSeries).
export function stripLogs(saveGame) / withLogs(...)   // helpers exportSave uses
```
Saves written to IndexedDB keep full logs (it handles tens of MB); **exports** default to the compact (log-stripped) form. This is the determinism payoff: a stripped save + `hydrateSeries` reproduces byte-identical round logs.

## 4. Steppable season — `src/engine/career/season.js` (extend, keep `simSeason`)

The UI advances the season one calendar slot at a time, so add a step API; refactor `simSeason` to use it so existing `season.test.mjs` stays byte-identical.

```js
/** @typedef SeasonState {
 *   seed, calendar:CalendarSlot[], slotIndex:number,
 *   events:Array<{slotId,type,scope,region?,result,cpAwards}>,   // completed, in order (== SeasonResult.events)
 *   ledger:CPLedger, masters:Record<slotId,{seedOrder}>, m2Winner:string|null,
 *   championsField:string[]|null, champion:string|null, complete:boolean
 * } */
export function initSeason(world, seed)          // -> SeasonState at slotIndex 0, nothing played
export function advanceSeason(state, world)      // -> new SeasonState: sim the slot at slotIndex (regional => 4 region events; international => 1), apply CP, compute qualifiers/seedOrder, set m2Winner/championsField/champion as reached, slotIndex++, complete when champions done. Immutable.
export function isSeasonComplete(state)          // -> boolean
export function simSeason(world, seed)           // -> SeasonResult (UNCHANGED output): initSeason then advanceSeason until complete, assemble SeasonResult
export function hydrateSeries(series, world)     // -> series with maps[].rounds restored by re-simSeries(...series.seed) when absent (deterministic). Used by the Match screen after loading a stripped save.
```
`advanceSeason` must derive identical per-slot seeds to today's `simSeason` (so results match). Provide `seasonToResult(state)` to build the legacy `SeasonResult` shape from a final state.

## 5. State — `src/state/slices/season.js`, updated `commands.js`, `selectors.js`

```js
// slices/season.js -> holds SeasonState. actions: season/init {state}, season/advance {state}, season/load {state}.
// (events slice from Phase 3 may be folded into season or kept for the legacy single-Kickoff path — prefer season as the source of truth.)
```
`commands.js` (async where persistence is involved):
```js
bootstrap(store)            // buildWorld() (48 teams) -> world; initSeason(world, DEFAULT_SEED) -> season/init; followed default; route 'home'. Try to load the autosave slot first; if present, hydrate from it instead.
continueSeason(store)       // if !complete: advanceSeason -> season/advance; autosave (await, fire-and-forget ok); toast the slot just played; navigate 'calendar' (or the followed team's event). if complete: toast the champion.
openEvent(store, slotId, region)   // navigate 'event' (or standings/bracket) with params {slotId, region}
openSeries(store, seriesId) // (exists) ensure the series is hydrated (hydrateSeries) before showing the Match screen
saveCurrent(store, name)    // build SaveGame from state -> saveManager.saveSlot; toast
loadSlot(store, id)         // saveManager.loadSlot -> dispatch world+season+settings; toast; navigate home
deleteSlot/duplicateSlot/exportCurrent(store)->download JSON / importSave(store, json)
```
Selectors (add): `selectSeason, selectCalendar, selectSlot(state,slotIndex), selectEvent(state,slotId,region), selectCPStandings(state), selectChampionsField(state), selectChampion(state), selectSlotsPlayed(state)`. Keep prior selectors working by defaulting event lookups to the latest played event.

## 6. Screens & navigation

PARAMETERIZE existing screens by `ui.route.params` (`{slotId, region, eventId, seriesId, teamId, playerId}`); default to the latest played event when absent. Add new screens; extend the Sidebar.

| id | file | shows |
|----|------|-------|
| `home` | HomeInbox.js (update) | season progress (slot X/8), next event, followed team's path, champion banner if complete |
| `calendar` | Calendar.js (update) | the full 20-event timeline grouped by the 8 slots; regional slots list 4 leagues with winners/status; click an event → standings/bracket for it |
| `standings` | Standings.js (update) | the selected event's group standings + placements (params {slotId,region}) |
| `bracket` | Bracket.js (update) | the selected event's bracket (triple for kickoff, double for stage/masters/champions playoff; region/event switcher) |
| `match` | Match.js (update) | a series (hydrated via hydrateSeries) — ticker + box score |
| `cp` | CPStandings.js (NEW) | cumulative Championship-Points table (all teams, region filter) — the season-long race |
| `champions` | Champions.js (NEW) | the 16-team Champions field, its bracket, and the crowned World Champion banner |
| `saves` | SaveLoad.js (NEW) | slot list (load/delete/duplicate), save-current (name via Modal), export (download), import (paste/file) |
| `team`/`player`/`leaders` | (update) | event/season-scoped via params |

Sidebar adds: Calendar, CP, Champions, Saves. Async command results surface via toasts.

## 7. Testing — headless

- `tests/unit/persistence.test.mjs` (MemoryAdapter): saveSlot→listSlots→loadSlot round-trips deep-equal; deleteSlot/duplicateSlot; migrate is identity at v1; `exportSave` strips all `rounds[]` (assert none present) and is valid JSON; `importSave(exportSave(s))` then `hydrateSeries` on a series reproduces the SAME maps as the original (determinism payoff — deep-equal rounds).
- `tests/unit/seasonStep.test.mjs`: `initSeason`+`advanceSeason`×until-complete yields a `SeasonResult` deep-equal to `simSeason(world, seed)` for several seeds; `isSeasonComplete` transitions correctly.
- `tests/ui/season-smoke.test.mjs`: build the real store, `bootstrap` (4 leagues, 48 teams), loop `continueSeason` to season end, then render EVERY screen via `RouterOutlet -> toHtml` without throwing, with params covering multiple events/regions: Calendar shows 20 events; CP shows a populated table; Champions shows 16 teams + a champion; Standings/Bracket render for a regional event AND an international event; Match (after hydrate) shows ticker cells + box score; SaveLoad renders. Also exercise saveCurrent→loadSlot through the MemoryAdapter and assert state restored.
- No regressions: all prior suites (now 48) stay green. `node tests/run.mjs`. Add a `scripts/demo-save.mjs` that runs a season, saves+exports+imports+hydrates, and prints that the round-trip reproduced the champion + a sample match identically.

## 8. Scope boundary

IN: persistence (slots/autosave/export/import via the adapter), steppable season, full-season UI (calendar, CP race, Champions, all events browsable, save/load UI), headless tests + a save round-trip demo. OUT (later): the worker (still sync; fast enough), god-mode re-sim/editing UI (P6/P7), career dynamics/off-season/transfers (P6), inbox/news depth & awards (P7). The app must let the user start a season, hit Continue through all 20 events to a champion, browse any event's bracket/standings/box scores, watch the CP race, and save/load/export the career.
