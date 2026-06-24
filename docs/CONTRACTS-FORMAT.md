# CONTRACTS-FORMAT — Phase 2 Format Engine (binding interface spec)

Builds on `CONTRACTS.md` (Phase 1). Same hard rules: pure functions, named exports, no `Math.random`/`Date.now`/DOM in `engine/`/`config/`/`domain/`, all randomness via injected `Rng`, all tuning from `config/balance.js` / `config/cpTable.js`. The match engine (`simSeries`) is the leaf that decides every series.

The Format Engine turns a declarative **FormatDescriptor** into a played-out event: it resolves entrants, runs each stage (round-robin / GSL / Swiss / bracket), routes winners & losers, and emits a full **EventResult** (ranked placements + every Series played). One engine interprets all events; the bracket templates below are fixed, hand-verified graphs.

---

## 1. Data shapes

```js
/** @typedef SourceRef  // where a bracket match's competitor comes from
 *  { seed:number } | { winnerOf:string } | { loserOf:string } | { entrant:string }
 */

/** @typedef BracketMatch
 *  id:string,            // unique within the bracket, e.g. 'UQF1'
 *  round:string,         // display group, e.g. 'Upper Quarterfinal'
 *  bestOf:number,        // resolved series length (3, or 5 for finals)
 *  a:SourceRef, b:SourceRef,
 *  winnerTo:Routing, loserTo:Routing
 */
/** @typedef Routing  { to:string, slot:'a'|'b' } | { placement:number } | { eliminated:true } | { advance:true } */

/** @typedef StageDescriptor
 *  id:string, name:string,
 *  kind:'roundRobin'|'gsl'|'swiss'|'bracket',
 *  seriesLen:{ default:number, final?:number },
 *  entrants:EntrantRef[],     // resolved in order -> seeds 1..N for this stage
 *  // kind-specific:
 *  bracketType?:'single'|'double'|'triple'|'gsl6',  // when kind==='bracket'|'gsl'
 *  advancersOut?:number,      // roundRobin/gsl/swiss: how many advance
 *  winsToAdvance?:number, lossesToEliminate?:number, // swiss (default 3/3 for Bo? -> here 2/2)
 *  rounds?:number             // roundRobin: 1 (single) or 2 (double); default 1
 */
/** @typedef EntrantRef  { from:'seed', seed:number } | { from:string /*stageId*/, slot:string } */
//   slot examples: '1'..'N' (placement within that stage), 'advance:1'..'advance:K' (k-th advancer)

/** @typedef FormatDescriptor  { id, name, type:'kickoff'|'stage'|'masters'|'champions', stages:StageDescriptor[] } */

/** @typedef SeriesRef  { ...Series (CONTRACTS §9), stageId:string, matchId:string } */
/** @typedef StageResult
 *  stageId, kind,
 *  standings:{ teamId:string, rank:number, w:number, l:number, mapW:number, mapL:number, roundDiff:number }[],
 *  advancers:string[],    // teamIds advancing, in advance order
 *  series:SeriesRef[]
 */
/** @typedef Placement { rank:number, teamId:string, losses:number, eliminatedIn?:string } */
/** @typedef EventResult
 *  eventId, formatId, type,
 *  placements:Placement[],   // rank 1..N over ALL participants
 *  qualifiers:{ teamId, seedInto:string }[],  // filled by qualification.js, may be []
 *  cp:{ teamId:number }[]|Record<string,number>,  // filled by championshipPoints.js
 *  stages:StageResult[], series:SeriesRef[]
 */
```

---

## 2. Seeding & helpers — `engine/format/seeding.js`

```js
export function resolveEntrants(stage, ctx, priorStages)  // -> string[] teamIds (index 0 => seed 1)
//   ctx = { seedOrder:string[] /*event-level seeding, teamIds by seed*/, teamsById, playersById }
//   { from:'seed', seed:n } -> ctx.seedOrder[n-1]
//   { from:stageId, slot } -> look up that stage's StageResult standings/advancers
export function crossSeed(groupAEntrants, groupBEntrants) // -> string[] of 8: [A1,B1,A2,B2,A3,B3,A4,B4]
export function bracketPairing8(seedTeamIds)              // -> [[1,8],[4,5],[3,6],[2,7]] mapped to teamIds
export function bracketPairing6(seedTeamIds)              // group pairings for the gsl6 template
```

Event-level `seedOrder`: at **Kickoff** it is a deterministic **draw** (shuffle teamIds with the event rng); everywhere else it is by standings/CP (passed in by the caller). Seeding never calls `Math.random`.

## 3. Standings & tiebreakers — `engine/format/standings.js`, `tiebreakers.js`

```js
// standings.js
export function roundRobinStandings(teamIds, series)  // -> ranked standings[] (see StageResult.standings shape)
export function swissStandings(teamIds, series, records) // -> ranked standings[] incl. Buchholz
export function recordFromSeries(series)              // -> per-team {w,l,mapW,mapL,roundDiff}
// tiebreakers.js  (apply in this order)
export function compareStandings(a, b)  // map-diff DESC -> round-diff DESC -> head-to-head -> seed ASC
export function headToHead(teamId, otherId, series)   // -> -1|0|1
```

## 4. Tournament kinds

Each kind exports `run(stage, entrants, ctx, makeSeed, rng)` returning a **StageResult**. `entrants` are teamIds seeded (index 0 = seed 1). `makeSeed(matchId)` returns a deterministic integer series seed (`hashSeed(eventSeed, stageId, matchId)`); `simSeries` is called with it — NOT the bracket's own rng — so each series is independently reproducible. `rng` is used only for in-stage non-series randomness (e.g. Swiss pairing tie-breaks).

```js
// roundRobin.js — every team plays every other once (rounds:1) or twice (rounds:2). Bo3.
export function run(stage, entrants, ctx, makeSeed, rng) // standings via roundRobinStandings; advancers = top advancersOut
// swiss.js — Buchholz-paired Swiss; advance at winsToAdvance, eliminate at lossesToEliminate (default 2/2 -> classic 8-team Masters Swiss: advance at 2 wins, out at 2 losses, 4 advance).
export function run(stage, entrants, ctx, makeSeed, rng)
// bracket.js — generic elimination engine driven by a fixed template (see §5). Handles single/double/triple/gsl6.
export function run(stage, entrants, ctx, makeSeed, rng)
export function buildTemplate(bracketType, size)  // -> BracketMatch[]  (the graphs in §5)
export function simulateBracket(template, seedTeamIds, ctx, makeSeed) // -> { placements:Placement[], series:SeriesRef[] }
// gsl.js — thin wrapper: run() === bracket.run with bracketType 'gsl6', advancersOut 4.
export function run(stage, entrants, ctx, makeSeed, rng)
```

**Bracket execution:** topologically process matches — a match is ready when both `SourceRef`s resolve to concrete teams. Simulate via `simSeries(teamA, teamB, ctx.playersById, bestOf, makeSeed(matchId))`. Route the winner/loser teamId per `winnerTo`/`loserTo`. A team's **loss counter** increments whenever it loses a series; assert it never exceeds the bracket's loss cap. Continue until all matches resolved. Placements come from the `{placement:n}` routings plus elimination-order ranking for the rest (§5).

## 5. Bracket templates (FIXED, hand-verified)

### 5a. `triple` / size 8 — the Kickoff playoff (THE centerpiece)

Invariants this graph guarantees: a team is eliminated only at its **3rd** loss; final placements have **exactly** these loss counts — 1st:0, 2nd:1, 3rd:2, 4th:3. Seeds 1..8 come from `crossSeed` (1=A1,2=B1,3=A2,4=B2,5=A3,6=B3,7=A4,8=B4); round-1 pairings `[1,8],[4,5],[3,6],[2,7]` (all cross-group).

UPPER (loss 0→1):
```
UQF1: seed1 vs seed8   winner->USF1.a  loser->MR1a.a
UQF2: seed4 vs seed5   winner->USF1.b  loser->MR1a.b
UQF3: seed3 vs seed6   winner->USF2.a  loser->MR1b.a
UQF4: seed2 vs seed7   winner->USF2.b  loser->MR1b.b
USF1: W(UQF1) vs W(UQF2)  winner->UF.a  loser->MR2a.b
USF2: W(UQF3) vs W(UQF4)  winner->UF.b  loser->MR2b.b
UF  : W(USF1) vs W(USF2)  winner->{placement:1}  loser->MF.b
```
MIDDLE (loss 1→2):
```
MR1a: L(UQF1) vs L(UQF2)  winner->MR2a.a  loser->LR1.a
MR1b: L(UQF3) vs L(UQF4)  winner->MR2b.a  loser->LR1.b
MR2a: W(MR1a) vs L(USF1)  winner->MR3.a   loser->LR2.b
MR2b: W(MR1b) vs L(USF2)  winner->MR3.b   loser->LR3.b
MR3 : W(MR2a) vs W(MR2b)  winner->MF.a    loser->LR4.b
MF  : W(MR3)  vs L(UF)    winner->{placement:2}  loser->LF.b
```
LOWER (loss 2→3), seriesLen final = Bo5 for LF:
```
LR1 : L(MR1a) vs L(MR1b)  winner->LR2.a  loser->{eliminated} (rank 8)
LR2 : W(LR1)  vs L(MR2a)  winner->LR3.a  loser->{eliminated} (rank 7)
LR3 : W(LR2)  vs L(MR2b)  winner->LR4.a  loser->{eliminated} (rank 6)
LR4 : W(LR3)  vs L(MR3)   winner->LF.a   loser->{eliminated} (rank 5)
LF  : W(LR4)  vs L(MF)    winner->{placement:3}  loser->{placement:4}
```
18 series total. Eliminated ranks 5–8 are assigned by elimination round (LR4 loser=5, LR3=6, LR2=7, LR1=8). Verify: every `{eliminated}`/`{placement:4}` team has loss count 3; placement 3 has 2; placement 2 has 1; placement 1 has 0.

### 5b. `double` / size 8 — Stage & Masters playoff
Standard 8-team double elimination (UQF×4 → USF×2 → UF → Grand Final; lower bracket LR1×2, LR2×2, LR3, LR4(LF); GF Bo5). Loss cap 2. Placements 1 (GF winner), 2 (GF loser), 3 (LF loser), 4 (LR4 loser), 5/6 (LR3 losers), 7/8 (LR1 losers). Provide the explicit `BracketMatch[]` in `buildTemplate('double',8)` mirroring 5a's style.

### 5c. `gsl6` — Kickoff/Stage group (6 teams, top 4 advance)
```
M1: seed3 vs seed6   winner->M4.b  loser->LB1.a
M2: seed4 vs seed5   winner->M3.b  loser->LB1.b
M3: seed1 vs W(M2)   winner->UF.a  loser->LB2.a
M4: seed2 vs W(M1)   winner->UF.b  loser->LB2.b
UF: W(M3) vs W(M4)   winner->{advance:1}  loser->{advance:2}
LB1: L(M1) vs L(M2)  winner->LB2-feed... 
```
Resolve gsl6 precisely as: seeds 1,2 get byes into M3,M4. The two upper-final teams advance (ranks 1 & 2 of the group, 0/1 losses). The remaining 4 one-loss teams (L(M3),L(M4),W(LB1a),...) are reduced by two elimination matches that send 2 teams home (group 5th/6th) and pass 2 survivors as advance:3, advance:4. Implement so **exactly 4 advance, 2 eliminated**, each advancer's loss count ≤ 1 except possibly the lower-survivors (≤1 since eliminated at 2). The bracket agent finalizes the exact lower matches; the verifier asserts: 4 advance, 2 out, advancers ranked, deterministic.

### 5d. `single` / size N — generic single elimination (used by Swiss-fed playoffs if needed).

## 6. Format engine — `engine/format/formatEngine.js`

```js
export function simEvent(descriptor, ctx, eventSeed)  // -> EventResult
//   ctx = { eventId, teamsById, playersById, seedOrder?:string[] }
//   1) determine seedOrder: provided, else deterministic draw via createRng(eventSeed)
//   2) for each stage in order: resolveEntrants -> kind.run(...) -> StageResult; cache by stageId
//   3) assemble placements across all stages (bracket placements + group non-advancers ranked below)
//   4) return EventResult with placements, all stages & series (cp/qualifiers left for career layer)
export function makeSeedFactory(eventSeed, stageId)   // -> (matchId) => hashSeed(eventSeed, stageId, matchId)
```

Kickoff placement assembly: playoff ranks 1–8; the 4 group non-advancers ranked 9–12 by group standing (5th of a group above 6th; tie-break by seed). 12 total placements, no gaps, no dupes.

## 7. Career glue (Phase-2 slice)

```js
// engine/career/championshipPoints.js
export function awardCP(eventResult, cpTable)  // -> Record<teamId, number> using CP_TABLE[type][rank]; ranks beyond table -> 0
// engine/career/qualification.js
export function kickoffQualifiers(eventResult) // -> [{teamId, seedInto:'masters-playoff'}, {teamId,'masters-swiss'}, {teamId,'masters-swiss'}]
//   placement 1 -> masters-playoff (1st seed); placements 2 & 3 -> masters-swiss. (Mirrors the locked rule.)
```

## 8. Config descriptors — `config/formats/*.js`

Each exports a `FormatDescriptor`. `kickoff.js` is the Phase-2 priority and MUST encode: two `gsl6` groups (`groupA` entrants seeds 1,4,5,8,9,12-style split or A/B draw halves; `groupB` the others), then a `triple`/8 `playoff` whose entrants are `crossSeed(groupA.advancers, groupB.advancers)`, with `seriesLen {default:3, final:5}`. `stage.js`, `masters.js`, `champions.js` may be drafted (double-elim / swiss+double / swiss+double-16) and lightly tested; **kickoff is the one verified end-to-end this phase.**

## 9. Verification invariants (the adversarial checks)

A Kickoff `EventResult` from `simEvent(KICKOFF, ctx, seed)` over MANY seeds MUST satisfy:
1. **Loss invariant:** placement 1 has 0 losses; 2 has 1; 3 has 2; 4 has 3. No team is eliminated with <3 losses; no surviving/placed team exceeds 3.
2. **Structural:** exactly 12 placements, ranks 1–12 unique, every participant present once. Exactly 8 teams in the playoff; exactly 4 advance from each group; the 4 non-advancers occupy 9–12.
3. **Qualification:** exactly 3 qualifiers — placement 1 → masters-playoff, 2 & 3 → masters-swiss.
4. **CP:** placements 1/2/3/4 receive 4/3/2/1; placements 5–12 receive 0.
5. **No double-booking:** no team appears as both `a` and `b` of a match; no team plays two live matches simultaneously; every series winner is one of its two teams.
6. **Engine-backed:** every series has real maps with finalized box scores (placements are not faked — they come from `simSeries`).
7. **Determinism:** same `seed` → identical `EventResult` (deep-equal); different seed → different bracket outcomes.

## 10. Tests

Add `tests/unit/{seeding,standings,bracket,swiss,roundRobin,formatEngine,championshipPoints}.test.mjs`. Add `tests/kickoff.test.mjs` running ≥25 seeded Kickoffs asserting every §9 invariant. Extend `tests/run.mjs` discovery already globs `tests/unit/*` — also import top-level `kickoff.test.mjs`. All via `node tests/run.mjs`.
