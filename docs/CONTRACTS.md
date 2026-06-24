# CONTRACTS — Phase 1 Engine Core (binding interface spec)

Every module implements exactly these signatures and data shapes. Do not invent alternative names. Pure functions only in `core/` (except `events.js`), `domain/`, `engine/`. No DOM, no `window`, no `Math.random` anywhere in these layers — all randomness flows through an injected `rng`. Code must run unchanged in both the browser and Node (use only standard ES + `export`/`import`). Use **named exports**. Annotate with JSDoc `@typedef`.

File extension: `.js` for `src/**`. Tests use `.mjs` under `tests/`. A root `package.json` with `{ "type": "module" }` is added so Node runs `src/**/*.js` as ES modules (browsers ignore it → zero-build preserved).

---

## 1. `core/rng.js` — deterministic PRNG (IMPLEMENT EXACTLY)

```js
// mulberry32: fast, seedable, 2^32 period. DO NOT substitute another algorithm.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wrap a raw float generator with helpers. Returns an Rng instance. */
export function createRng(seed) { /* returns { next, int, range, chance, pick, weightedPick, gaussian } */ }

/** @typedef Rng
 *  next()                       -> float [0,1)
 *  int(maxExclusive)            -> int [0,max)
 *  range(min, maxInclusive)     -> int [min,max]
 *  chance(p)                    -> bool, true with probability p
 *  pick(array)                  -> uniform random element
 *  weightedPick(items, weightFn)-> element, prob ∝ weightFn(item) (weights >= 0)
 *  gaussian(mean, stdev)        -> float, Box–Muller using next()
 */
```

`createRng` builds its float source from `mulberry32(seed)`. All helpers consume that single stream in a fixed order so a given seed always yields the same sequence.

## 2. `core/hash.js` — seed derivation (IMPLEMENT EXACTLY)

```js
// cyrb53 string hash → 32-bit unsigned. DO NOT substitute.
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
}

/** Derive a 32-bit seed from any number of string/number parts joined by '|'. */
export function hashSeed(...parts) { return cyrb53(parts.join('|')); }
```

## 3. `core/id.js` — deterministic ids (no randomness)

```js
export function seriesId(eventId, phaseId, slot)      // `${eventId}:${phaseId}:s${slot}`
export function mapId(seriesId, gameNo)               // `${seriesId}:m${gameNo}`
export function makeId(prefix, ...parts)              // `${prefix}_${parts.join('-')}`
```

## 4. `core/produce.js` — immutable helper

```js
export function produce(obj, recipe)  // shallow structural clone + recipe(draft) returning new object; never mutates input
export function set(obj, path, value) // immutable deep set by array path
```

## 5. `core/events.js` — pub/sub (only stateful core module)

```js
export function createEmitter() // -> { on(type, fn)->unsub, off, emit(type, payload) }
```

---

## 6. Reference data shapes

```js
/** @typedef Agent  { id, name, role:'Duelist'|'Initiator'|'Controller'|'Sentinel' } */
/** @typedef GameMap { id, name, atkBias:number /*0.5 neutral; >0.5 favors attack*/, inPool:boolean } */
```

`config/agents.js` exports `AGENTS` (array, ≈current roster — duelists, initiators, controllers, sentinels) and `AGENTS_BY_ROLE`.
`config/maps.js` exports `MAPS` (the 7 active-pool maps + others, each with `atkBias` default 0.5) and `MAP_POOL` (the 7 active ids).

## 7. `domain/` factories & typedefs

```js
/** @typedef Attributes {aim,movement,reaction,composure,consistency,gameSense,utility,trading,igl} // each 0-100 */
/** @typedef Player {
 *   id, name, handle, nationality, age, role,
 *   attributes:Attributes, potential:number,
 *   proficiency:{ roles:Record<role,number>, agents:Record<agentId,number>, maps:Record<mapId,number> },
 *   dynamics:{ form:number/*-100..100*/, morale:number/*0..100*/, fatigue:number/*0..100*/ },
 *   development:{ trajectory:number, growthRate:number, peakAge:number, declineAge:number },
 *   contract:{ teamId:string|null, salary:number, expires:number, status:'active'|'free_agent'|'retired' }
 * } */
export function createPlayer(partial)  // fills sane defaults; clamps attributes 0-100; dynamics default {form:0,morale:60,fatigue:0}
//   potential: explicit value honoured verbatim; when omitted, derived from current overall + an age-decreasing headroom (never below overall, so seed players don't start in decline)
export function roleProfile(role)      // -> Attributes: the role's reference "shape" (slants over ATTR_BASELINE), a fresh mutable copy; generators use it to give a role identity

/** @typedef Team { id, name, tag, leagueId, roster:string[]/*5+*/, reputation:number, budget:number, championshipPoints:number } */
export function createTeam(partial)

/** @typedef League { id, name, region, teamIds:string[] } */
export function createLeague(partial)

// event.js: createEvent(partial) — Phase 1 stub is fine (full use in Phase 2).
```

`createPlayer` must return a fully-formed object even from `{name, role}` so seed data can be terse.

## 8. `config/balance.js` — ALL tuning constants (single source of truth)

Export a frozen `BALANCE` object. Engine modules import constants from here; never hardcode magic numbers. Required keys (use these exact values as defaults):

```js
export const BALANCE = Object.freeze({
  DUEL_SCALE: 14,                 // logistic scale for duel rating diff
  ROUND_SCALE: 80,                // logistic scale for team round-strength diff (tiebreak/spike)
  // duel rating weights (sum ~1.0) over Attributes used in a gunfight
  DUEL_WEIGHTS: { aim:0.50, reaction:0.20, movement:0.18, gameSense:0.12 },
  // team round-strength contribution weights
  ROUND_WEIGHTS: { duel:0.70, utility:0.18, trading:0.12 },
  IGL_TEAM_BONUS: 0.06,           // *(igl/100) added as multiplier to team round strength
  // dynamics
  FORM_WEIGHT: 0.10, FATIGUE_WEIGHT: 0.08, MORALE_WEIGHT: 0.04,
  // economy factors applied to duel rating
  ECON_FACTOR: { full:1.00, force:0.92, eco:0.80, pistol:0.95 },
  PISTOL_AIM_DAMPEN: 0.85,        // compresses rating spread on pistol rounds
  // economy credits (Valorant-like)
  CREDIT_START: 800, CREDIT_MAX: 9000,
  WIN_REWARD: 3000, LOSS_BASE: 1900, LOSS_BONUS_STEP: 500, LOSS_BONUS_MAX: 2900,
  KILL_REWARD: 200, PLANT_BONUS: 300,
  BUY_FULL_MIN: 3900, BUY_FORCE_MIN: 2000,   // credit thresholds
  // round flow
  TRADE_BASE: 0.55,               // *(avg trading/100) chance a kill is traded
  CLUTCH_WEIGHT: 0.18,            // last-alive Composure bonus to duel rating: ((composure-50)/100)*scale
  PLANT_BASE_CHANCE: 0.45,        // attacker plant likelihood when reaching man-advantage
  ENGAGEMENT_CAP: 14,             // safety cap on engagements/round
  // map score
  ROUNDS_TO_WIN: 13, OT_WIN_BY: 2,
  // box score
  ACS_KILL: 150, ACS_ASSIST: 35, ACS_PER_DUEL_BONUS: 12
});
```

(Values are starting defaults; they are intentionally centralized so balancing is one-file.)

---

## 9. Engine match shapes

```js
/** @typedef Comp string[] // 5 agentIds */
/** @typedef RoundContext { side:'atk'|'def', econType:'pistol'|'eco'|'force'|'full', econFactor:number, isClutch:boolean } */
/** @typedef DuelEvent {
 *   round:number, killerId:string, victimId:string, killerSide:'atk'|'def',
 *   isFirstBlood:boolean, isTrade:boolean, isClutchKill:boolean, assistIds:string[]
 * } */
/** @typedef RoundLog {
 *   n:number, winnerSide:'atk'|'def', winnerTeam:'A'|'B',
 *   endCondition:'elim'|'spike'|'defuse'|'time',
 *   economy:{ A:{type,credits}, B:{type,credits} },
 *   events:DuelEvent[], aliveEnd:{A:number,B:number}, planted:boolean, clutchPlayerId:string|null
 * } */
/** @typedef PlayerMapStat {
 *   playerId, kills, deaths, assists, firstBloods, firstDeaths, tradeKills, clutches,
 *   plants, defuses, roundsPlayed, acs:number, adr:number, kast:number, kd:number
 * } */
/** @typedef MapResult {
 *   mapId, score:{A:number,B:number}, sideStartA:'atk'|'def',
 *   compA:Comp, compB:Comp, rounds:RoundLog[],
 *   boxScore:Record<string,PlayerMapStat>, mvpPlayerId:string, winner:'A'|'B'
 * } */
/** @typedef Series {
 *   id, teamAId, teamBId, bestOf:number, seed:number,
 *   veto:{ picks:{mapId,by:'A'|'B'|'decider'}[] }, maps:MapResult[],
 *   score:{A:number,B:number}, winnerId:string
 * } */
```

## 10. Engine function signatures

```js
// engine/match/duel.js  — ONE gunfight, no trade logic (caller handles trades)
export function duelRating(player, ctx /*RoundContext*/)   // -> number, applies weights+econ+dynamics+clutch
export function resolveDuel(pA, pB, ctxA, ctxB, rng)       // -> 'A' | 'B'  (logistic on rating diff / DUEL_SCALE)

// engine/match/economy.js
export function createEconomy()                            // -> { A:{credits:CREDIT_START, lossStreak:0}, B:{...} }
export function decideBuy(sideEcon, roundNo, rng)          // -> econType ('pistol' on rounds 1 & 13)
export function applyRoundResult(econ, { winnerTeam, planted, killsA, killsB }) // -> new econ (immutable)

// engine/match/boxScore.js
export function createBoxScore(roster /*playerIds*/)       // -> Record<id, PlayerMapStat> zeroed
export function accumulate(box, roundLog, rng)             // -> new box (apply a round's events; assign assists)
export function finalize(box, totalRounds)                 // -> box with acs/adr/kast/kd computed
export function pickMvp(box)                               // -> playerId (highest acs)

// engine/match/composition.js
export function selectComp(team, players, mapId, rng)      // -> Comp (5 agentIds; role-valid: >=1 controller, balanced; weighted by agent+map proficiency)

// engine/match/veto.js
export function runVeto(teamA, teamB, players, bestOf, rng)// -> { mapsToPlay:string[] (length ceil(bestOf/2)..bestOf), picks:[...] }
                                                            //    Bo3: ban,ban,pick,pick,ban,ban,decider. Bo5: ban,ban,pick,pick,pick,pick,decider.
                                                            //    bans/picks weighted by team map proficiency (own roster avg per map).

// engine/match/roundSim.js  — THE engagement loop (see §11)
export function simRound(args, rng)                        // args:{ n, sideA, sideB, rostersAlive, econA, econB, teamA, teamB, players, mapId } -> RoundLog

// engine/match/mapSim.js
export function simMap(teamA, teamB, players, mapId, compA, compB, sideStartA, rng) // -> MapResult

// engine/match/matchSim.js  — top-level entry
export function simSeries(teamA, teamB, players, bestOf, seed) // seed:int -> Series  (builds rng = createRng(seed))
```

`players` is a `Record<playerId, Player>` lookup passed through the pipeline. `teamA/teamB` are `Team` objects; their first 5 roster ids are the active lineup in Phase 1.

## 11. Round simulation algorithm (authoritative — duel/round/boxScore agents MUST align)

Per round, attackers vs defenders, 5v5 alive:
1. Compute each side's `econType`/`econFactor` (from economy). Pistol rounds dampen rating spread via `PISTOL_AIM_DAMPEN`.
2. Loop engagements until one side has 0 alive, or `ENGAGEMENT_CAP` reached:
   a. `weightedPick` one alive attacker and one alive defender, weight = `duelRating(player, ctx)`.
   b. Build `RoundContext` for each (side, econ, `isClutch` = that player's side has exactly 1 alive).
   c. `resolveDuel` → loser dies (record `DuelEvent`: kill/death, `isFirstBlood` if first event, `isClutchKill` if killer was in clutch).
   d. **Trade attempt:** with `p = TRADE_BASE * (avgTrading(losingSideAlive)/100)`, the killer is immediately traded — a random alive teammate of the victim kills the killer (record a traded `DuelEvent`, `isTrade:true`). Update alive counts.
3. Determine outcome: if a side reached 0 alive → `endCondition:'elim'`, winner = surviving side. If cap hit with both alive → winner = higher `aliveEnd`; tie broken by team round-strength logistic (`ROUND_SCALE`) → `endCondition:'time'`.
4. Spike: if attackers gained a man-advantage during the round, set `planted` with `PLANT_BASE_CHANCE`; if planted and attackers win → `endCondition:'spike'`; if defenders win after a plant → `endCondition:'defuse'`.
5. `clutchPlayerId` = a player who won the round while last-alive vs ≥1 enemy.

`accumulate` consumes `events` to tally kills/deaths/assists/firstBloods/trades/clutches; assists are assigned probabilistically to alive teammates of the killer (utility-weighted). `finalize` computes `acs = (ACS_KILL*kills + ACS_ASSIST*assists + ACS_PER_DUEL_BONUS*firstBloods)/roundsPlayed`-style, `kast`, `adr` as reasonable approximations.

## 12. `core/store.js` — reactive store (Phase 1 minimal)

```js
export function createStore(rootReducer, initialState)  // -> { getState, dispatch(action), subscribe(fn)->unsub }
export function combineReducers(map)                    // -> rootReducer
// Phase 1 ships createStore + combineReducers + a trivial `world` slice holding {leagues,teams,players}. Middleware deferred to Phase 3.
```

## 13. Seed data — `data/seed/pacific.js` (Phase 1 test fixture)

Export `PACIFIC_SEED = { league, teams:[...], players:[...] }` with **at least the full ≈10–12 Pacific teams**, each 5 players, realistic 2026 handles/roles and plausible attribute spreads (stars ~80-90, role players ~70-80). Other regions may be stubbed this phase. `createPlayer`/`createTeam` normalize them. This fixture is what the Verify runner simulates.

## 14. Tests — convention

- `tests/_assert.mjs` exports `assert(cond,msg)`, `assertEqual(a,b,msg)`, `assertClose(a,b,eps,msg)`, `section(name)`.
- Each module test: `tests/unit/<module>.test.mjs`, default export `async () => { ... }` throwing on failure.
- `tests/run.mjs` imports all unit tests + `determinism.test.mjs`, runs them, prints a PASS/FAIL summary, exits non-zero on failure. Runnable via `node tests/run.mjs`.
- `tests/determinism.test.mjs`: `simSeries(...)` twice with the **same** seed → deep-equal results; with a **different** seed → not equal. Also sanity: map scores reach 13 with win-by-2, box-score kills per map roughly equal deaths summed across both teams.

## 15. Hard rules

- No `Math.random`, no `Date.now`, no `window`/`document` in `core|domain|engine|config|data`.
- All randomness via the injected `Rng`. All seeds via `hashSeed`.
- Named exports only; one concern per file; JSDoc typedefs on shapes.
- Import constants from `config/balance.js`; never duplicate magic numbers.
- Every produced object is new (immutable engine outputs).
