# CONTRACTS-SEASON — Phase 4 Season Engine (binding interface spec)

Builds on `CONTRACTS.md`, `CONTRACTS-FORMAT.md`, `CONTRACTS-UI.md`. Phase 4 connects the whole 2026 cycle: 4 leagues running in parallel through 8 events, qualification feeds between them, cumulative Championship Points, the international Masters/Champions, and a crowned world champion. **Headless & deterministic** — no DOM. Reuses `formatEngine.simEvent` for every event; the season layer only schedules events and threads qualifiers + CP between them.

Hard rules unchanged: pure, named exports, no `Math.random`/`Date.now`/DOM in engine/config/domain, all randomness via seeds (`hashSeed`), immutable outputs. Existing Phase-2 stage/masters/champions descriptors were drafted — Phase 4 makes them run end-to-end.

---

## 1. The four leagues & the world

```js
// data/seed/{pacific,americas,emea,china}.js  each export <REGION>_SEED = { league, teams:[12], players:[60] }
// Real team names per region (approx, editable):
//   americas: Sentinels, NRG, LOUD, 100 Thieves, Cloud9, Evil Geniuses, Leviatán, KRÜ, MIBR, FURIA, G2 Esports, 2Game
//   emea:     Fnatic, Team Liquid, Team Heretics, Karmine Corp, Team Vitality, NAVI, FUT, KOI, BBL, Gentle Mates, Apeks, GIANTX
//   china:    EDG, Bilibili Gaming, FPX, Trace, Wolves, Dragon Ranger, Nova, Titan, Xi Lai, All Gamers, TYLOO, JDG
// All normalize through createTeam/createPlayer. Attribute spreads vary by region strength (no region uniform).
```

```js
/** @typedef World { leagues:Record<region,League>, teamsById:Record<id,Team>, playersById:Record<id,Player> } */
export function buildWorld()  // data/seed/index.js — merge all four REGION_SEEDs into one World (48 teams, 240 players)
```
`region` ∈ `'pacific'|'americas'|'emea'|'china'`. Team ids must be globally unique across regions (the existing pacific ids stay; new regions prefix-namespace, e.g. `na-sen`, `eu-fnc`, `cn-edg`).

## 2. The calendar — `engine/career/calendar.js`

Eight calendar slots; regional slots expand to one event PER league (4 parallel), international slots are single events.

```js
/** @typedef CalendarSlot
 *  id:string, type:'kickoff'|'stage'|'masters'|'champions',
 *  scope:'regional'|'international',
 *  formatId:string,                 // KICKOFF_FORMAT / STAGE_FORMAT / MASTERS_FORMAT / CHAMPIONS_FORMAT
 *  feedsFrom?:string,               // for masters: the regional slot whose qualifiers seed it
 *  index:number
 */
export const CALENDAR = [
  { id:'kickoff', type:'kickoff', scope:'regional',     formatId:'kickoff' },
  { id:'m0',      type:'masters', scope:'international', formatId:'masters',  feedsFrom:'kickoff' },
  { id:'stage1',  type:'stage',   scope:'regional',     formatId:'stage' },
  { id:'m1',      type:'masters', scope:'international', formatId:'masters',  feedsFrom:'stage1' },
  { id:'stage2',  type:'stage',   scope:'regional',     formatId:'stage' },
  { id:'m2',      type:'masters', scope:'international', formatId:'masters',  feedsFrom:'stage2', finalMasters:true },
  { id:'stage3',  type:'stage',   scope:'regional',     formatId:'stage' },   // CP-only (feeds Champions via points)
  { id:'champions', type:'champions', scope:'international', formatId:'champions' },
]
```
Feeds: `m0`←`kickoff`, `m1`←`stage1`, `m2`←`stage2` (its winner gets the Champions direct slot). `stage3` awards CP only. `champions` = 1 direct (m2 winner) + 15 by cumulative CP.

## 3. Format descriptors (finalize so they RUN end-to-end)

- `config/formats/stage.js` STAGE_FORMAT (regional, 12 teams): two `roundRobin` groups of 6 (`rounds:1`, Bo3) → top 4 each → `bracket` `double`/8 playoff (`seriesLen {default:3, final:5}`). Placements 1..8; non-advancers 9..12 (mirror kickoff assembly).
- `config/formats/masters.js` MASTERS_FORMAT (international, 12): stage `swiss` entrants = seeds 5..12 (`winsToAdvance:2,lossesToEliminate:2` → 4 advance); stage `bracket` `double`/8 entrants = `[{from:'seed',seed:1..4}, {from:'swiss',slot:'advance:1..4'}]`. Placements 1..8 (the 4 swiss-eliminated rank 9..12).
- `config/formats/champions.js` CHAMPIONS_FORMAT (international, 16): stage `swiss` entrants = seeds 1..16 (`winsToAdvance:3,lossesToEliminate:3` → 8 advance); stage `bracket` `double`/8 entrants = `{from:'swiss',slot:'advance:1..8'}`. Placements 1..16.

Each must return a complete `EventResult` from `simEvent(FORMAT, ctx, seed)` and get a smoke test.

## 4. Qualification — `engine/career/qualification.js` (extend)

```js
export function regionQualifiers(eventResult)   // generic Kickoff/Stage -> [{teamId,seedInto:'masters-playoff'} (placement 1), {teamId,'masters-swiss'} (placements 2 & 3)]. (kickoffQualifiers stays as an alias.)
export function mastersSeedOrder(regionResultsByRegion)  // input: { region: EventResult } for the 4 feeding regional events.
//   -> string[12] seedOrder: seeds 1..4 = the four regions' direct (placement-1) teams; seeds 5..12 = the eight swiss (placements 2 & 3) teams.
//   Deterministic order: directs ordered by FIXED region order [pacific,americas,emea,china]; swiss ordered by (placement asc, region order).
export function championsField(cpLedger, directSlotTeamId)  // -> string[16] seedOrder: index0 = directSlotTeamId; indices 1..15 = top-15 teams by cumulative CP (excluding the direct team), ties broken by teamId. Seeds the Champions swiss.
```

## 5. Championship Points — `engine/career/championshipPoints.js` (extend)

```js
export function awardCP(eventResult, cpTable)   // (exists) per-event CP by placement/type
/** @typedef CPLedger { totals:Record<teamId,number>, history:Array<{eventId,region?,awards:Record<teamId,number>}> } */
export function createLedger()                  // -> empty CPLedger
export function applyCP(ledger, eventId, region, eventResult, cpTable)  // -> new ledger (immutable): add this event's awards to totals + push history
export function cpStandings(ledger)             // -> [{teamId, cp}] sorted desc (teamId tiebreak)
```
`CP_TABLE` (config/cpTable.js) must have entries for `kickoff` (4/3/2/1), `stage`, `masters`; `champions` awards none (the finale). Stage/Masters defaults per ARCHITECTURE §12 (Stage 1st=5↓; Masters champion=8↓) — adjust in config only.

## 6. The season runner — `engine/career/season.js`

```js
/** @typedef SeasonResult
 *  seasonId, seed,
 *  events:Array<{ slotId, type, scope, region?:string, result:EventResult, cpAwards:Record<teamId,number> }>,  // in calendar order; regional slots expand to 4 region-tagged entries
 *  ledger:CPLedger,
 *  masters:Record<slotId,{ seedOrder:string[12] }>,    // how each Masters was seeded
 *  championsField:string[16], champion:string, finalStandings:string[]   // champion = Champions placement 1
 */
export function simSeason(world, seed)  // -> SeasonResult
```
`simSeason` walks `CALENDAR`:
- **regional slot:** for each of the 4 leagues, `simEvent(<format>, { eventId:`${slotId}-${region}`, teamsById:<league teams>, playersById }, hashSeed(seed, slotId, region))`; apply CP to the ledger (region-tagged); cache results by region.
- **masters slot:** `seedOrder = mastersSeedOrder(<the feedsFrom regional results by region>)`; `simEvent(MASTERS_FORMAT, { eventId:slotId, teamsById, playersById, seedOrder }, hashSeed(seed, slotId))`; apply CP. If `finalMasters`, remember `champion-direct = placement 1`.
- **champions slot:** `seedOrder = championsField(ledger, m2Winner)`; `simEvent(CHAMPIONS_FORMAT, ...)`; champion = placement 1.

All per-event seeds derive from the season `seed` via `hashSeed`, so the whole season is reproducible.

## 7. Verification invariants (adversarial targets)

A `simSeason(buildWorld(), seed)` over many seeds MUST satisfy:
1. **Calendar shape:** exactly 20 event entries = 4 kickoff + 1 m0 + 4 stage1 + 1 m1 + 4 stage2 + 1 m2 + 4 stage3 + 1 champions, in order.
2. **Masters composition:** each Masters has exactly 12 participants; exactly 4 direct (the seeds 1-4 = placement-1 of the 4 feeding regional events) and 8 swiss; each region contributes exactly 3; m0 from kickoff, m1 from stage1, m2 from stage2.
3. **Champions composition:** exactly 16 unique teams; index 0 = the m2 champion (direct slot); the other 15 = current top-15 by cumulative CP (excluding the direct team, and excluding none erroneously); the m2 champion appears exactly once.
4. **CP accounting:** `ledger.totals[t]` == sum over events of `awardCP(...)[t]`; kickoff/stage/masters award CP, champions awards none; no negative/NaN.
5. **Determinism:** same `seed` → deep-equal `SeasonResult`; different seed differs.
6. **Engine-backed & sound:** every event is a real `EventResult` with played series and valid placements; champion is a real team id present in the Champions field; no team double-booked within any event (already guaranteed by the format engine — re-assert at season level).

## 8. Tests

Add `tests/unit/{calendar,seasonQualification,cpLedger}.test.mjs`, `tests/unit/format-stage.test.mjs`, `format-masters.test.mjs`, `format-champions.test.mjs` (each descriptor runs and returns the right placement count), and a top-level `tests/season.test.mjs` running ≥10 seeded full seasons asserting every §7 invariant. All via `node tests/run.mjs` (no regressions to the 38 existing suites). Add a `scripts/demo-season.mjs` printing the calendar progression, each Masters' qualifiers, the CP top-10, the Champions field, and the crowned champion.

## 9. Scope boundary

IN: 4-league world, the season runner, all qualification feeds, cumulative CP, working Stage/Masters/Champions formats, a crowned champion, headless tests + a season demo. OUT (later phases): the worker/perf offload (a full season sims in ~1-2s synchronously — defer), UI for browsing the whole season (P5), persistence/saves (P5), career dynamics/off-season/transfers (P6). The existing Phase-3 UI keeps showing the Pacific Kickoff; wiring it to the full season is the next phase.
