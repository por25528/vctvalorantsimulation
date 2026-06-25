# CONTRACTS-CAREER — Phase 6 Career Dynamics + Off-season (binding interface spec)

Builds on all prior contracts. Phase 6 makes the world **live across time**: player form/morale/fatigue evolve as a season is played, and an **off-season** ages/develops players, retires veterans, injects newgen youth, resolves contracts, and runs a transfer market — then a NEW season begins on the changed world. This turns the single-season sim (P1–P5) into a **multi-season career**.

**The determinism contract is sacred.** `engine/match/**`, `engine/format/**`, and `engine/career/{calendar,qualification,championshipPoints,season}.js` stay PURE over a FIXED world: `simSeason(world, seed)` and `advanceSeason(state, world)` remain byte-identical to P4 (their tests must not move). Career evolution therefore lives in a NEW layer that THREADS AN EVOLVING WORLD between events and between seasons — it never mutates the season engine. All career randomness flows from `hashSeed(careerSeed, …)` → `createRng(...)` (never `Math.random`/`Date`), so a career is fully reproducible from `(seed)`.

The match engine ALREADY consumes dynamics (`engine/match/duel.js`: `dyn = 1 + FORM_WEIGHT·form/100 − FATIGUE_WEIGHT·fatigue/100 + MORALE_WEIGHT·(morale−50)/100`). P6 does NOT touch that read path; it only makes the values it reads change over time.

All tuning lives under `BALANCE.CAREER` in `config/balance.js` (documented defaults; deeply frozen). No magic numbers in engine modules.

---

## 0. Phasing (sub-phases, each independently green via `node tests/run.mjs`)

- **P6a — pure mechanics** (THIS deliverable): the 5 stub functions become real, pure, rng-injected, fully unit-tested; `BALANCE.CAREER` added. No orchestration, no world threading, no UI — the season engine is untouched, so all 53 prior suites stay green.
- **P6b — off-season pipeline + transfer market**: `offseason/transfers.js` + an orchestrator `engine/career/offseason.js` (`runOffseason`) chaining age→develop→retire→newgen→contracts→transfers into a new World + an OffseasonReport.
- **P6c — career orchestration**: `engine/career/career.js` — a multi-season `CareerState` that plays a season (threading in-season dynamics) then runs the off-season then starts the next season. Deterministic; `simCareer(seed, nSeasons)` for headless tests.
- **P6d — state + UI**: career/transfers slices, commands, screens (Squad, Transfer Market, Player Development, Off-season Report), persistence schema bump (v1→v2 migration).
- **P6e — invariants + demo + adversarial verification**: `tests/career.test.mjs`, `scripts/demo-career.mjs`.

---

## 1. Pure mechanics — the five engine functions (P6a)

All are PURE: same inputs → same outputs, no `Date`/`Math.random`/DOM, inputs never mutated, outputs fresh & frozen. `rng` is an `Rng` from `core/rng.js`. Constants come from `BALANCE.CAREER`.

### 1.1 In-season dynamics — `engine/career/dynamics.js`
```js
/** @typedef MatchOutcome { won:boolean, mapsPlayed:number, performance:number }
 *  performance ~ a normalized rating where 1.0 ≈ league-average (e.g. ACS/baseline). */
export function updateDynamics(player, matchOutcome)   // -> { form, morale, fatigue } (clamped to DOMAIN ranges)
export function recoverBetweenEvents(player)           // -> { form, morale, fatigue } (fatigue & form decay; morale reverts toward base)
```
- `updateDynamics` is DETERMINISTIC from its inputs (no rng): form chases `(performance−PERF_BASELINE)` plus a win/loss kick; morale swings on result + performance; fatigue accrues `FATIGUE_PER_MAP·mapsPlayed`.
- `recoverBetweenEvents`: `fatigue·=…`/`−=…` toward 0, `form·=FORM_DECAY` (mean-reversion to 0), `morale += MORALE_REVERT·(MORALE_BASE−morale)`.
- Both return ONLY the dynamics sub-object (callers splice it onto the player), all three values clamped to `player.js` DOMAIN ranges (form[−100,100], morale[0,100], fatigue[0,100]).

### 1.2 Aging & development — `engine/career/offseason/development.js`
```js
export function developPlayer(player, rng)   // -> new frozen Player (age+1, attributes drifted, development.trajectory set)
```
- `age' = age+1`. Growth phase (`age<peakAge`): each attribute drifts UP toward `potential` headroom, scaled by `growthRate` and gaussian noise — high-potential youngsters with low current overall grow fastest. Plateau (`peakAge≤age<declineAge`): small zero-mean noise. Decline (`age≥declineAge`): drift DOWN, magnitude growing with `(age−declineAge)`.
- **Differential aging (fidelity):** PHYSICAL attrs (`aim/movement/reaction`) decline faster (`PHYSICAL_DECLINE_MULT`); MENTAL attrs (`gameSense/igl/composure`) decline slower and may still tick UP late (`MENTAL_LATE_GROWTH`) — veterans get smarter as their aim fades.
- `development.trajectory` = the net signed overall delta this off-season (UI shows ↑/→/↓). `potential`, `peakAge`, `declineAge`, identity, role, proficiency, dynamics, contract all preserved. Attributes clamped [0,100].

### 1.3 Retirement — `engine/career/offseason/retirement.js`
```js
export function decideRetirement(player, rng)   // -> boolean
```
- `0` below `MIN_AGE`. Above it, `p = BASE + AGE_K·(age−MIN_AGE)` lifted by low morale (`< MORALE_PIVOT`) and low overall (`< DECLINE_OVERALL_PIVOT`). `age ≥ FORCE_AGE` ⇒ retire with certainty. Returns `rng.chance(clamp(p,0,1))`.
- Pure decision only — the caller flips `contract.status='retired'` and frees the roster slot.

### 1.4 Newgen youth — `engine/career/offseason/newgen.js`
```js
export function generateNewgens(count, rng, opts = {})   // -> Player[] (frozen, status:'free_agent')
//   opts: { idPrefix='ng', nationalityPool=[…], season=0 }
```
- Each: `age∈[AGE_MIN,AGE_MAX]`, role by weighted draw (`ROLE_WEIGHTS`, so intake never droughts a role), `potential = clamp(gaussian(POT_MEAN,POT_STD), POT_MIN, POT_MAX)` (rare wonderkids), CURRENT attributes generated LOW = `potential − headroom` with role slant (the role's `roleProfile` re-centred to zero mean, so OVERALL stays `potential − headroom`) + per-attr noise (a 16-yo is far below their ceiling). MEAN/MAX/HEADROOM are calibrated against the SEED world so the best newgens refill T1 turnover without deflating its average or inflating its ceiling (see `scripts/probe-newgen.mjs`). Generated handle/name via deterministic syllable tables (data local to this module). Globally-unique ids `"${idPrefix}-${season}-${i}-${token}"`. `contract.status='free_agent'`, `teamId:null`.
- Deterministic: `count` players consume rng in a fixed order; same `(count, seed, opts)` ⇒ identical batch.

### 1.5 Contracts — `engine/career/offseason/contracts.js`
```js
export function resolveContract(player, team, rng, opts = {})   // -> new contract { teamId, salary, expires, status }
//   opts: { season=0 }  — called for an EXPIRING player; decides renew vs release
```
- Renewal probability rises with player value (overall+potential) relative to `team.budget`/`team.reputation` and with morale; sentinels of the org (high morale, in-prime) re-sign. Renew ⇒ `{ teamId:team.id, salary: f(overall,potential,age), expires: season+contractLengthFor(player,rng), status:'active' }` — the term is age-scaled (`contractLengthFor`: young/prime get the full `LENGTH_MIN..LENGTH_MAX` range, 30+ are capped a year shorter, 33+ only get `LENGTH_MIN`), still one rng draw within `[LENGTH_MIN, LENGTH_MAX]`. Release ⇒ `{ teamId:null, salary:0, expires:0, status:'free_agent' }`.

---

## 2. Off-season pipeline — `engine/career/offseason.js` (P6b)
```js
export function runOffseason(world, rng, opts = {})   // -> { world: World', report: OffseasonReport }
/** OffseasonReport { developed:Array<{id,trajectory}>, retired:string[], newgens:string[],
 *  contracts:{ renewed:string[], released:string[] }, transfers:Move[] } */
```
Ordered, each step pure over the prior world (age → develop → retire → newgen → contracts → free-agency/transfer market). Rosters stay valid (≥5); a team that loses players fills from free agents / newgens via the transfer market. Returns the NEXT season's `World` + a human-readable report for the UI/news.

`engine/career/offseason/transfers.js`:
```js
export function runTransferMarket(world, rng)   // -> { world: World', moves: Move[] }
/** Move { playerId, fromTeamId|null, toTeamId|null, fee, salary, kind:'signing'|'transfer'|'release' } */
```
AI bids by need (roster holes/weak roles) × budget × reputation; resolves the highest-value matches; the user (P6d) may broker any move before the AI pass.

---

## 3. Career orchestration — `engine/career/career.js` (P6c)
```js
/** @typedef CareerState { seed, seasonIndex, world:World, season:SeasonState|null,
 *   history:Array<SeasonSummary>, offseason:OffseasonReport|null, phase:'preseason'|'inSeason'|'offseason' } */
export function initCareer(seed)                 // build world (buildWorld) + initSeason; seasonIndex 0; phase 'inSeason'
export function advanceCareerSlot(state)         // advanceSeason ONE slot on state.world, then apply in-season dynamics to
                                                 //   the participating players → new world; immutable. On season complete →
                                                 //   summarize, run runOffseason, init next season; phase transitions.
export function simCareer(seed, nSeasons)        // headless: run N full seasons; returns { history, finalWorld } (deterministic)
```
- **In-season dynamics threading:** after a slot's events resolve, derive each participant's `MatchOutcome` from the box scores (won/mapsPlayed/performance), `updateDynamics`, and `recoverBetweenEvents` for everyone else; produce the next world the next `advanceSeason` is fed. The season engine never sees this — it just receives an updated `world` each call (exactly as the UI already passes `state.world`).
- Per-season/off-season seeds derive via `hashSeed(seed, 'season', seasonIndex)` / `hashSeed(seed, 'offseason', seasonIndex)`.

## 4. State + UI (P6d)
- `state/slices/career.js` (seasonIndex, phase, history, last OffseasonReport) and the now-live `state/slices/transfers.js` (market listings, pending user moves). `commands.js` gains `advanceCareer`, `signPlayer`, `releasePlayer`, `offerContract`. Persistence `SCHEMA_VERSION → 2` with a v1→v2 migration (adds `career`, defaults seasonIndex 0).
- Screens: **Squad** (roster + contracts + dynamics), **Transfer Market** (free agents/listed players, bid), **Player Development** (attribute trajectory, age curve), **Off-season Report** (retirements/newgens/moves). Sidebar adds Squad + Market.

## 5. Testing — headless
- P6a: `tests/unit/dynamics.test.mjs`, `unit/development.test.mjs`, `unit/retirement.test.mjs`, `unit/newgen.test.mjs`, `unit/contracts.test.mjs` — determinism (same seed ⇒ identical), clamping/ranges, and monotonic-direction invariants (winning↑form, fatigue↑with maps, young+high-potential grows, old declines, decline hits physical > mental, age≥FORCE_AGE retires, newgens below potential, expiring high-morale star renews). **Prior 53 suites unchanged.**
- Talent-pool health: `tests/unit/talent-pool.test.mjs` runs multi-season distribution invariants (pyramid shape, role demographics/identity, long-run pool stability, no role drought, bounded pool, determinism); `scripts/probe-newgen.mjs [seed] [seasons]` prints prospect-quality/role histograms and per-season pool size/quality as realism evidence.
- P6c/e: `tests/career.test.mjs` — `simCareer(seed, 3)` over several seeds: rosters stay valid every season, ages advance, retirements+newgens balance roster counts, same seed ⇒ identical career fingerprint, distinct seeds diverge; `simSeason` still byte-identical (regression guard). `scripts/demo-career.mjs` prints a 3-season career (a star's rise, a veteran's retirement, headline transfers, the champion each year).

## 6. Scope boundary
IN (P6 overall): evolving dynamics, full off-season (aging/development/retirement/newgen/contracts/transfers), multi-season career loop, career/transfer UI, persistence v2. OUT (P7): news/inbox depth, awards/all-pro, full god-mode editor, injuries, staff/coaches, sponsor economy, worker offload. The determinism of the match/format/season engines is INVARIANT — P6 only ever changes the world handed to them.
