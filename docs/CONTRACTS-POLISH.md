# CONTRACTS-POLISH — Phase 7 Polish (binding interface spec)

Builds on all prior contracts. Phase 7 is the **polish layer**: it adds presentation depth and breadth on top of the now-complete multi-season career (P1–P6). It is deliberately broken into independent sub-phases, each shippable on its own and each independently green via `node tests/run.mjs`.

**The determinism contract remains sacred.** `engine/match/**`, `engine/format/**`, and `engine/career/{calendar,qualification,championshipPoints,season}.js` stay PURE and byte-identical to their prior behaviour. Any P7 randomness flows from `hashSeed(careerSeed, …)` → `createRng(...)` (never `Math.random`/`Date`). Pure derivations (awards, records) take a snapshot and read it; world-mutating features (injuries, economy) thread an EVOLVING world exactly as P6's career layer already does. All tuning lives under `BALANCE` (deeply frozen; no magic numbers in engine modules).

---

## 0. Sub-phases (each independently green)

- **P7a — Awards & All-Pro** (THIS deliverable): pure, deterministic end-of-season awards derived from the season's box scores — Season MVP, Finals MVP, Rookie of the Year, All-Pro First & Second Team, and per-region MVPs. Attached to each `SeasonSummary` (so history carries them) and computed live for the in-progress/just-finished season. New Awards screen + Sidebar/router. No engine-determinism risk (read-only over a snapshot).
- **P7b — News & Inbox**: a deterministic news-feed generator (results, upsets, transfers, retirements, awards, records) feeding an upgraded HomeInbox + a dedicated inbox slice.
- **P7c — Injuries**: a seeded availability dynamic threaded through the career layer (a player may be unavailable for an event; recovers over time); surfaced in Squad/Market; never breaks the ≥5 fieldable lineup.
- **P7d — God-mode editor**: a UI to edit player attributes / team rosters / identities live (the sandbox half of the "god-mode sandbox + follow a team" decision).
- **P7e — Sponsor economy**: make `team.budget` meaningful — income, wage bills, transfer fees — interacting with the P6 transfer market.
- **P7f — Worker offload**: move the heavy season sim into a Web Worker so the UI stays responsive (no gameplay change).

Sub-phases ship in this order (rising determinism/UI risk). Each may be re-scoped as it is reached; this doc is authoritative for P7a and a roadmap for P7b–f.

---

## 1. Awards & All-Pro — `engine/career/awards.js` (P7a)

```js
/** @typedef AwardWinner { playerId, teamId|null, handle, role, age, maps, acs, kills, rating } */
/** @typedef SeasonAwards {
 *   mvp: AwardWinner|null,            // best qualified player across the whole season
 *   finalsMvp: AwardWinner|null,      // best player in the Champions event (the season's last)
 *   rookieOfYear: AwardWinner|null,   // best qualified player with age <= ROOKIE_MAX_AGE
 *   allProFirst: AwardWinner[],       // top ALL_PRO_SIZE qualified players (rating desc)
 *   allProSecond: AwardWinner[],      // the next ALL_PRO_SIZE
 *   regionMvps: Record<region, AwardWinner|null>  // best qualified player per league (regional events only)
 * } */
export function computeSeasonAwards(season, world)   // -> SeasonAwards (PURE, deterministic, no rng)
export function aggregatePlayerStats(events)         // -> Map<playerId, {maps,kills,deaths,assists,acsSum}> (shared helper)
```

- **Rating metric:** a player's `rating` = mean ACS across the maps they played, **gated** by `maps >= MIN_MAPS` (a small-sample guard — two great maps can't beat a full deep run). Unqualified players are excluded from every award. Ranking tiebreak: rating desc, then total maps desc, then total kills desc, then `playerId` asc (fully deterministic).
- **Scope:** `mvp`/`allPro*`/`rookieOfYear` aggregate over **all** of the season's events; `finalsMvp` over the single `champions` event only; `regionMvps[r]` over that region's **regional** events only (`entry.region === r`).
- **Identity:** `teamId` = the player's `contract.teamId`; `handle`/`role`/`age` read from `world.playersById` (end-of-season world — ages pre-aging, so RoY uses in-season age). A player absent from `world` is still ranked by stats but carries null identity fields.
- **Empty/partial:** with no qualified players every field is `null`/`[]` (never throws). Works on a partially-played season (awards "so far").
- Constants from `BALANCE.CAREER.AWARDS = { MIN_MAPS, ROOKIE_MAX_AGE, ALL_PRO_SIZE }`.

### Integration
- `engine/career/career.js` `summarizeSeason(season, seasonIndex, world)` gains a `world` param and attaches `awards: computeSeasonAwards(season, world)` to the returned `SeasonSummary` (so completed seasons carry their awards in `history`). `runCareerOffseason` passes `state.world`. This lives in the EVOLVING career layer, not the pure season engine — `simSeason`/`advanceSeason` are untouched, and awards are deterministic so same-seed careers stay identical (the career regression guard holds).

### State + UI
- `state/selectors.js` `selectSeasonAwards(state)` → `computeSeasonAwards` over the live season slice + world (the in-progress / just-finished season; null before any maps). Past seasons read `history[i].awards` via the existing `selectCareerHistory`.
- Screen **Awards** (id `awards`): the current season's MVP / Finals MVP / Rookie cards, All-Pro First & Second Team tables, per-region MVPs, and a "Past Seasons" list (champion + MVP per prior year). Sidebar adds **Awards**; router adds `awards`. Read-only, pure `(state, dispatch) => VNode`, headless via `toHtml`.

### Testing
- `tests/unit/awards.test.mjs`: determinism (same season+world ⇒ identical awards), MIN_MAPS gate excludes small samples, MVP is the top qualified mean-ACS, RoY respects ROOKIE_MAX_AGE, All-Pro teams are the right sizes and disjoint and rating-ordered, finalsMvp is drawn from the champions event, empty-season safety.
- `tests/ui/screen-awards.test.mjs`: the Awards screen renders the live + historical awards headlessly; router resolves `awards`; Sidebar exposes it.
- `tests/career.test.mjs` (extended): every archived `SeasonSummary` carries an `awards` block; awards are stable across the same seed.

## 6. Scope boundary
IN (P7 overall): awards/all-pro, news/inbox depth, injuries, god-mode editor, sponsor economy, worker offload. The determinism of the match/format/season engines stays INVARIANT — P7 only reads snapshots or threads an evolving world, exactly as P6 established.
