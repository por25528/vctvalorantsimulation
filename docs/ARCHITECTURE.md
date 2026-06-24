# VCT 2026 Career Simulator — Architecture

A multi-season, full-tactical Valorant VCT 2026 career simulator. Vanilla ES-module JS, zero build step, custom reactive store. Maximal fidelity: per-player duel/clutch/trade resolution, full career depth (form/morale/fatigue/development/aging), full transfer system, all four leagues simulated in parallel.

> This document is the design reference. `CONTRACTS.md` is the binding interface spec that all modules implement against. When they disagree, `CONTRACTS.md` wins.

---

## 0. Decision Ledger (locked requirements)

| # | Dimension | Decision |
|---|-----------|----------|
| 1 | Sim paradigm | Full tactical sim — rounds + economy + per-player duel/clutch/trade → box scores |
| 2 | Scope | Full 2026 cycle, multi-season career |
| 3 | Roster model | Players + agents/roles, full career depth (form/morale/fatigue/development/aging) |
| 4 | Data source | Real 2026 rosters as editable seed data, all 4 leagues |
| 5 | Kickoff | 12 → two seeded GSL double-elim groups of 6 → top 4 each → 8-team triple-elimination (Upper/Middle/Lower, 3 losses = out); 1/2/3 → Masters, CP 4/3/2/1 to top 4 |
| 6 | Calendar | `Kickoff → M0 → S1 → M1 → S2 → M2 → S3 → Champions`, all 4 leagues in parallel |
| 7 | Stage | Regional: 2 RR groups of 6 → top 4 → 8-team double-elim → top 3 to next Masters |
| 8 | Masters | International 12: 4 league-1st-seeds → playoff, 8 (2nd/3rd) → 8-team Swiss → 4 advance → 8-team double-elim |
| 9 | Champions | 16 teams: 1 direct slot (final Masters winner) + 15 by cumulative CP; Swiss → 8-team double-elim |
| 10 | Control | God-mode sandbox + "follow a team" |
| 11 | Matchday | Round-ticker + box score (side/economy indicators), no 2D/commentary |
| 12 | Engine | One full tactical engine, store all round logs, seeded for replay |
| 13 | Persistence | Autosave + named slots + JSON export (IndexedDB for logs, localStorage for index) |
| 14 | Tech | Vanilla ES-module JS, zero-build, custom reactive store; full transfer/youth system |

Series length: Bo3 everywhere, Bo5 for bracket/grand finals.

---

## 1. Design Pillars

1. **The engine is pure; the store holds truth.** Every simulation function is `(inputs, rng) → result` with no side effects. The store applies results.
2. **Determinism via seeds.** `masterSeed` + stable match id derive each match's PRNG. Any match regenerates byte-identical. "Re-sim" = reroll one derived seed. Stored logs are a *cache*, not the source of truth.
3. **Formats are data, not code.** One `FormatEngine` interprets declarative `FormatDescriptor`s. Triple-elim, GSL, Swiss, round-robin, double-elim are all expressed as data.
4. **Heavy work off the main thread.** Season-advance runs in a Web Worker so the UI never blocks.
5. **Phased but future-proof.** The data model supports the maximal feature set from day one; features ship in phases (§11).

---

## 2. Domain Model

See `CONTRACTS.md` for exact field-level typedefs. High level:

- **Player** — identity, age, role, `attributes` (0–100: aim, movement, reaction, composure, consistency, gameSense, utility, trading, igl), `potential`, `proficiency` (roles/agents/maps), `dynamics` (form/morale/fatigue), `development` (trajectory/peak/decline), `contract`, `careerStats`.
- **Team** — roster, league, reputation, budget, season record, cumulative `championshipPoints`.
- **League** — one of pacific/americas/emea/china; team list; standings.
- **Agent** / **GameMap** — editable reference data (≈27 agents, 7-map active pool).
- **Event** — calendar instance (kickoff/stage/masters/champions), `formatId`, participants, live phase state, final standings.
- **FormatDescriptor** — declarative stage list (gsl / roundRobin / swiss / bracket) + feeds + placement map.
- **Series / MapResult / RoundLog** — the stored match logs (the "store all logs" requirement).
- **SaveGame** — meta (masterSeed, cursor), world (mutable/editable), calendar, history, settings.

---

## 3. State Management

Single immutable state tree + Redux-style unidirectional flow, hand-built (~200 LOC, no dependency).

- **Store:** `createStore(rootReducer, initialState) → { getState, dispatch, subscribe }`. Single source of truth mirroring `SaveGame` + a transient `ui` slice.
- **Immutable updates** via a tiny `produce()` helper; never mutate.
- **Slices:** `world`, `calendar`, `events`, `results`, `transfers`, `ui` (combined reducer).
- **Selectors:** pure, memoized derivations; UI reads only through them.
- **Middleware chain:** `dispatch → [logger] → [command/thunk] → [simScheduler] → [persistence] → reducer`.
  - *Command middleware:* high-level ops (`advanceContinue`, `simEvent`, `applyTransfer`, `runOffseason`).
  - *simScheduler:* routes heavy sim to the Web Worker, streams results back as actions.
  - *persistence:* debounced autosave to IndexedDB.

---

## 4. Format Engine (data-driven competitions)

`engine/format/formatEngine.js` interprets a `FormatDescriptor` and drives an event through its stages:
- `gsl.js` — 6-team GSL double-elim → top-4 ranked.
- `roundRobin.js` — RR scheduling, standings, advancers.
- `swiss.js` — Buchholz-paired Swiss, advance-at-N-wins / out-at-N-losses.
- `bracket.js` — single/double/**triple**-elimination graph; triple-elim models Upper→Middle→Lower drop chain with a per-team loss counter (`elimAt: 3`); placement = highest tier won.
- `seeding.js`, `standings.js`, `tiebreakers.js` — map-diff → round-diff → head-to-head → seed.

---

## 5. Match Simulation Engine (tactical core)

Pure, seeded pipeline:

```
simSeries(teamA, teamB, bestOf, seed)
  → runVeto → [for each map: selectComp ×2 → simMap] → aggregate → Series

simMap(teamA, teamB, mapId, comps, rng)
  → loop rounds (to 13, win-by-2 OT):
       economy.decideBuy per side
       simRound: sequential engagement loop over alive 5v5 →
         resolveDuel per engagement (logistic on duel ratings + context),
         trade attempts, clutch (last-alive Composure bonus),
         until one side eliminated / spike resolution → RoundLog
       economy.applyRoundResult; boxScore.accumulate
  → MapResult { rounds[], boxScore, mvp }
```

**Dynamics:** form shifts strength; fatigue accrues per map/series, decays between events; morale swings on results. **Development/aging** runs each off-season.

**Determinism:** `matchSeed = hashSeed(masterSeed, seriesId)`, PRNG = `mulberry32`. Re-sim = `hashSeed(masterSeed, seriesId, rerollCounter)`.

**Performance:** ~1–2M duel ops per full season — seconds in a worker. Logs are the memory concern, not CPU.

---

## 6. Career Engine

- `scheduler.js` builds the ordered 8-event calendar × 4 leagues, wiring qualification feeds.
- `advanceContinue()` auto-sims up to the next stop point (followed team's match, event boundary, or off-season decision).
- `championshipPoints.js` applies the tunable CP table; `qualification.js` resolves slots (Stage top-3 → next Masters; Masters → CP + final-Masters direct Champions slot; CP ranking → Champions field of 16).
- `offseason/` — `retirement.js`, `development.js` (aging), `newgen.js` (youth generation), `contracts.js`, `transfers.js` (AI bidding by need/budget/reputation; user may broker any move).

---

## 7. Persistence

- **IndexedDB** — object stores: `saves`, `matchLogs` (bulky `rounds[]`), `archives`. Tens of MB, async.
- **localStorage** — lightweight save index + UI settings only.
- **Autosave** — debounced after state-changing actions.
- **Slots** — named saves: create/duplicate/delete.
- **Export/Import** — full save → JSON (logs optionally excluded; regenerable from seeds).
- **Migrations** — `schemaVersion` gate, ordered upgrade functions.
- **Log compaction** — drop `rounds[]` for events older than N (box scores kept; ticker regenerates from seed).

---

## 8. UI Component Tree

```
App (shell)
├─ TopBar (EventCursor · SeasonLabel · ContinueButton · SaveMenu)
├─ Sidebar (Home/Inbox · Calendar · Standings · Bracket · Teams · Players · Stats · Transfers · Editor · Settings · FollowedTeamBadge)
├─ RouterOutlet → Screen
│   ├─ HomeInbox · Calendar · Standings · Bracket
│   ├─ Team · Player · Match (RoundTicker + BoxScore + VetoPanel)
│   ├─ StatsLeaders · Transfer · Editor
├─ ModalRoot · ToastRoot
```
Shared components: `BracketView`, `RoundTicker`, `BoxScore`, `DataTable` (sortable/virtualized), `AttributeRadar`, `StandingsTable`, `Modal`, `Toast`.

---

## 9. File / Directory Structure

```
vct2026-sim/
├─ index.html
├─ styles/  (main.css, theme.css, components/)
├─ src/
│  ├─ main.js
│  ├─ config/  formats/{kickoff,stage,masters,champions}.js  cpTable.js  balance.js  maps.js  agents.js
│  ├─ data/seed/  {pacific,americas,emea,china}.js
│  ├─ core/  store.js rng.js hash.js id.js produce.js events.js
│  ├─ domain/  player.js team.js league.js event.js
│  ├─ engine/
│  │  ├─ match/  veto.js composition.js matchSim.js mapSim.js roundSim.js economy.js duel.js boxScore.js
│  │  ├─ format/ formatEngine.js bracket.js gsl.js roundRobin.js swiss.js seeding.js standings.js tiebreakers.js
│  │  └─ career/ scheduler.js championshipPoints.js qualification.js dynamics.js
│  │     └─ offseason/ retirement.js development.js newgen.js contracts.js transfers.js
│  ├─ state/  slices/{world,calendar,events,results,transfers,ui}.js  actions.js selectors.js
│  │          middleware/{persistence,simScheduler,logger}.js
│  ├─ persistence/ db.js saveManager.js serializer.js migrations.js
│  ├─ workers/ simWorker.js
│  └─ ui/  app.js router.js render.js  components/  screens/
└─ tests/  _assert.mjs  unit/  run.mjs  determinism.test.mjs
```

---

## 10. Determinism & RNG

- One `masterSeed` per save; all randomness derives via `hashSeed(masterSeed, ...path)`.
- Engine functions receive an `rng` instance; never call global `Math.random`.
- Guarantees: reproducible seasons, shareable saves replay identically, safe re-sim, golden-seed snapshot tests.

---

## 11. Phased Roadmap

1. **Engine core** — domain + store + match engine (veto→map→round→duel→box score) + determinism tests. Headless. ← *current build*
2. **Format engine** — Kickoff (GSL→triple-elim) end-to-end + standings/CP.
3. **UI shell** — sidebar hub, Continue loop, Bracket/Standings/Match screens, round-ticker + box score.
4. **Full calendar** — all 8 events × 4 leagues, qualification feeds, CP, Champions.
5. **Persistence** — IndexedDB, slots, autosave, export/import, migrations.
6. **Career depth** — dynamics, then off-season (aging/development/retirement/newgen), then transfer market.
7. **Polish** — stats/leaders/awards, editor, inbox/news, log compaction.

---

## 12. Tuning Defaults (override in config)

- CP table in `config/cpTable.js`: Stage 1st=5↓, Masters Champion=8↓, Kickoff 4/3/2/1, Champions = finale (no CP).
- Tiebreakers: map-diff → round-diff → head-to-head → seed.
- Veto: standard Bo3 (b-b-p-p-b-b-decider) / Bo5; comps from agent+role proficiency.
- Newgen/aging: peak ~24, decline ~28; potential-gated growth — in `balance.js`.
- Champions per-region minimum: off by default (pure CP + 1 direct slot), toggleable.
