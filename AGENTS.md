# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Architecture & invariants

- Vanilla ES modules, zero runtime deps. Runs in Node and the browser unchanged.
- **Purity/determinism is sacred.** `core | domain | engine | config | data` must never use
  `Math.random` / `Date.now` / `new Date()`. All randomness flows from an injected `rng`
  (`src/core/rng.js`, a seedable mulberry32). Same seed ⇒ byte-identical output. The match /
  format / season engines (`engine/match/**`, `engine/format/**`,
  `engine/career/{calendar,qualification,championshipPoints,season}.js`) stay PURE over a FIXED
  world; career evolution lives in a separate layer that threads an evolving World between
  seasons (`engine/career/offseason*`, `career.js`).
- `rng.range`/`int`/`chance`/`pick`/`weightedPick` each consume a FIXED number of stream draws
  regardless of arguments (e.g. `range(min,max)` is always one `next()`). So you can vary the
  bounds/weights by deterministic inputs without shifting downstream draws — handy for
  age/role-aware decisions that must stay reproducible. (`rng.gaussian` consumes two.)
- **All tuning magic numbers live in `src/config/balance.js`** (deeply frozen, single source).
  Engine modules read from `BALANCE.*`; do not inline constants.

## Career transfer/management layer (where AI-org behaviour lives)

- `offseason/transfers.js` — the AI buy/sell market. `playerValue(player)` is the shared notion
  of worth: ability (overall) + age-discounted upside + an age depreciation curve + form/morale
  condition (so the AI doesn't overpay fees for 30+ decliners). `transferFee` prices contracted
  players; `fillRosters` biases the value-weighted draw toward MISSING core roles
  (`MARKET.ROLE_NEED_FILL_MULT`) so AI fives trend role-complete.
- **Two distinct notions of worth — do not conflate them.** `playerValue` is ASSET/resale worth
  (potential-heavy, age-depreciated) and is used ONLY for pricing fees. `lineupValue` is CURRENT
  on-field contribution (overall-led, small potential nudge, mild age curve) and is what every
  SQUAD decision judges on — `bestUpgradeBid` improvement, the makeweight drop, and the fill draw.
  This split is load-bearing: judging upgrades on resale value made a 74-ovr high-ceiling rookie
  out-rank a proven 83-ovr veteran, so strong veteran FREE AGENTS sat unsigned while clubs paid
  fees for weaker rookies. If you add a roster/upgrade decision, use `lineupValue`, not `playerValue`.
- **Free-agency-first buying** (`bestUpgradeBid`, `TRANSFER.{FA_PREFER_MARGIN,FEE_MAX_AGE,FREE_SIGN_TRIGGER_BONUS}`):
  a club never pays a fee for a target that isn't clearly better than the best free-agent upgrade
  (take the free agent instead); fees are paid only for players under `FEE_MAX_AGE` (a strong vet
  still arrives FREE, never bought); and a free signing gets a higher pull-the-trigger chance so
  valuable free agents are signed promptly. The fill draw is restricted to a `MARKET.FILL_SHORTLIST`
  of best-fitting candidates so the long tail of raw newgens can't dilute a strong same-role free
  agent down to a few-percent chance (which left strong FAs stranded while clubs fielded raw youth).
  NOTE: residual stranding of a strong free agent in an OVER-SUPPLIED role (e.g. too many Initiators)
  is a talent-DISTRIBUTION matter (newgen role weights), not a transfer-logic bug.
- `offseason/contracts.js` — `salaryFor` (must stay monotonic non-decreasing in overall) and
  `contractLengthFor(player, rng)` (age-aware term, always within `CONTRACT.LENGTH_MIN..MAX`).
- Supporting: `attractiveness.js` (team pull + a player's `signingDesirability`, resolves bidding
  wars so talent flows UP to prestigious/rich orgs), `reputation.js` (living rep), `economy.js`
  (budgets: prize + sponsor − wages, floored at `ECONOMY.BUDGET_FLOOR`, anti-hoard reserve drag),
  `staff.js` (transfer/man-management coach), `chemistry.js`, `traits.js`.
- Market invariants the pipeline + safety net rely on: rosters end at exactly `MIN_ROSTER` (=5),
  no player double-rostered, input World never mutated, outputs frozen, budgets never breach the
  floor and fees only MOVE money buyer→seller (never mint). The user's club (`protectTeamId`) is
  never auto-bought-for nor sold from under them.
- `offseason/newgen.js` and `offseason/development.js` are the talent-pool/dev lane — owned
  separately; avoid editing them from the transfer/management lane.

## Career engine — talent pool & newgens

- **Determinism is sacred.** No `Math.random`/`Date`/`new Date()` anywhere in `core|domain|engine|config|data`; all randomness flows from an injected `rng` (`core/rng.js`). The match/format/season engines must stay byte-identical for a fixed world — `potential`/`age` are NOT read by the match engine (only the career layer + UI), so newgen/development/player tuning is safe to change without moving `simSeason`/`simSeries` results.
- **Preserve rng DRAW COUNT, not just determinism.** `offseason/development.js` and `offseason/newgen.js` consume the rng stream in a fixed order; keep one draw per attribute and one role draw per newgen so downstream draws keep their positions. `rng.weightedPick` and `rng.pick` each consume exactly one stream value (`rng.gaussian` consumes two).
- **Talent pool is calibrated against the SEED world**, not in the abstract: seed T1 overall ≈ 79 (mean), ceiling ≈ 85. Newgen `BALANCE.CAREER.NEWGEN.{POT_MEAN,POT_STD,POT_MAX}` + `HEADROOM_*` + `MARKET.NEWGEN_PER_OFFSEASON` are tuned so the rostered (T1) pool reaches a STABLE steady state (~70-73 mean, ceiling ~88-90) instead of deflating into the 60s or inflating into 95-overall gods. The steady-state mean sits a few points below the authored seed on purpose: real development can't make every 20-year-old a finished product, so a youth-movement dip is expected and realistic.
- **Seed players omit `potential`**, so `domain/player.js` derives it from current overall + an age-decreasing headroom (`POTENTIAL_*` in the `DOMAIN` block). Without this a seed star (overall ~82) would default below their overall and could only decline. An explicit `potential` is always honoured verbatim.
- **Newgen stat lines are role-SHAPED**, not flat: `newgen.js` re-centres `domain/player.js`'s `roleProfile(role)` to zero mean and adds it to `baseOverall`, so a generated Duelist is aim-heavy/igl-light (matching authored players and what `development.js` preserves) while OVERALL still equals `baseOverall` (calibration untouched).
- **Validate the OUTCOME, not just the code.** `node scripts/probe-newgen.mjs [seed] [seasons]` prints the seed-world demographics, a large newgen quality/role histogram, and long-run pool health (rostered overall mean/p90/max, active-pool size, per-role counts) per season — run it across a few seeds to confirm stability before changing any NEWGEN/AGING constant. `tests/unit/talent-pool.test.mjs` encodes the resulting invariants (pyramid shape, role demographics/identity, multi-season stability, no role drought, bounded pool, determinism).

## UI shell — screens & routing

- Screens are pure `(state, dispatch[, store]) => VNode`. The router (`ui/router.js`) maps a
  `screen` id to a render fn via `ROUTES`; `ui/components/Sidebar.js` `NAV_ITEMS` is the primary
  nav, and `NAV_PARENT` maps contextual/legacy route ids to the nav item that should highlight.
- **The `home` route is the "God View" spectator hub** (`ui/screens/WorldHub.js`, nav label
  "World"). It is a hands-off world-at-a-glance dashboard: a TIME-MACHINE hero (Step Forward /
  Sim Event / Auto-Play + speed) that drives `continueSeason(store, { noNav:true })` and
  `setAutoplay`/`setAutoplayPace` so the world advances IN PLACE (no navigation), plus panels for
  the power ranking, region leaders, people to watch, now/next fixtures, recent results, and the
  happenings feed. All presentation math lives in the pure `ui/homeDashboard.js` (reads truth only
  through selectors; every derivation guarded for empty/early worlds). `recentResults` reads
  placements via `selectPlacements`, which returns `[]` for a slot still being revealed — so it is
  spoiler-safe by construction. The legacy FM inbox home (`ui/screens/HomeInbox.js`) is no longer
  routed but kept as a module (still rendered directly by its tests). The smoke test asserts the
  home screen shows the followed team's name — `WorldHub` guarantees this via the hero "Watching"
  lens chip (`followedLens`), which is also the spectator's window into the world.
- **Tournament unifies group stage + playoffs.** The single `tournament` nav item is the entry
  point for an event; `ui/screens/Tournament.js` renders shared chrome (title + `EventPicker` +
  Group Stage/Playoffs sub-tabs) and switches body on the `view` route param
  (`'standings'` default | `'bracket'`). The bodies are reused verbatim from the standalone
  screens via the exported `standingsContent(state, dispatch, eventId)` and
  `bracketContent(state, dispatch, store, eventId)` builders — content-only (no outer
  `<section>`/title/picker), so `StandingsScreen`/`BracketScreen` and `TournamentScreen` all share
  one source of truth. When changing standings/bracket markup, edit the `*Content` builder.
- The legacy `standings`/`bracket` route ids stay registered in `ROUTES` (so any in-flight deep
  link still resolves) but are no longer in the nav. App-internal deep links (`openEvent` in
  `state/commands.js`, Calendar, HomeInbox) navigate to `'tournament'` with a `view` param.

## In-map momentum & round-stakes pressure (`engine/match/momentum.js`)

- **`src/engine/match/momentum.js`** is a pure module with four exports:
  `updateMomentum(current, won)` → clamped decay-smoothed scalar in `[-1,+1]`;
  `momentumDuelFactor(momentum)` → `[1-DUEL_MAX, 1+DUEL_MAX]` multiplier on duel ratings;
  `momentumEcoBias(momentum)` → `±ECO_BIAS_MAX` credit offset applied inside `roundSim`'s
  `econTypeFor` (shifts buy tier without extra rng draws);
  `stakesAmplifier(ctx)` → `≥1` multiplier on trait deviations — eco-upset < match-point < OT.
- **`mapSim.js`** tracks `momentumA`, `momentumB` (both start at 0, updated via `updateMomentum`
  after every round) and passes them + the running score to `simRound`.
- **`roundSim.js`** reads `args.momentumA/B/scoreA/scoreB`, maps per-TEAM to per-SIDE, computes
  `momentumDuelFactor` + `momentumEcoBias` + `stakesAmplifier` for the round, then threads all
  three through `buildContext → RoundContext`.
- **`duel.js`** applies `stakesAmplifier` to the trait-deviation from 1 (amplifying
  clutch/bigGame/choker effects in pressure moments), then applies `momentumFactor` post-traits.
- **Constants in `BALANCE.MOMENTUM`**: `WIN_STEP=0.20`, `LOSS_STEP=0.20`, `DECAY=0.70`,
  `DUEL_MAX=0.04`, `ECO_BIAS_MAX=150`, `STAKES_MATCH_POINT=0.30`, `STAKES_OT=0.40`, `STAKES_ECO_UPSET=0.20`.
  These are intentionally modest — max momentum only tilts duel ratings by ±4%, so a heavy
  favourite (skill gap ~10 overall) still wins 90%+ of rounds despite max opponent momentum.
- **OVERLAP NOTE**: `agent-abilities-a8` also edits `roundSim.js` and `balance.js`. My changes
  are localized to the `MOMENTUM` block in balance, new `momentumA/B/scoreA/scoreB` fields in
  `SimRoundArgs`, and new `momentumFactor`/`stakesAmplifier` fields in `buildContext/RoundContext`.
  Merge conflicts should be straightforward (different sections of the same functions).
- Tests: `tests/unit/momentum.test.mjs` (bounded invariants, tier detection, win-rate proof,
  determinism) + all existing match tests (roundSim, mapSim, matchSim, duel, traits, determinism)
  pass with the new system in place.

## Tier 2 / Challengers ecosystem (`engine/career/tier2/*`)

- **T2 lives in a SEPARATE `world.tier2` namespace**, never folded into the
  top-level `teamsById`/`playersById`. This is load-bearing: many tests pin the T1
  world at exactly 48 teams / 240 players / 4 region leagues (`season.test`,
  `stateSeason`/`state` UI tests, `screen-rating`, `talent-pool`), and `buildWorld()`
  is left byte-identical. `world.tier2 = { leagues, teamsById, playersById }` is a
  parallel 48-team / 240-player division (12 clubs/region — sized to the regional
  Kickoff/Stage format) attached by `tier2World.attachTier2(world, seed)`.
- **T1 stays byte-identical whether or not T2 is attached.** Every T2 draw uses its
  own seed namespace: the build is `hashSeed(seed, 'tier2-build')`, the in-season sim
  is `hashSeed(seed, slotId, region, 't2')`, the off-season is `hashSeed(seed,
  'tier2-offseason', idx)`. `tests/unit/tier2.test.mjs` asserts `simSeason(withT2)`
  reproduces the T1 events of `simSeason(plain)` exactly.
- **Where T2 is threaded:** `season.js` carries a `state.tier2` accumulator SEPARATE
  from `state.events` (so the T1 calendar stays 21 entries) and runs each region's T2
  league through the same `simEvent` on every REGIONAL slot. `career.js` attaches T2
  in `initCareer`, re-attaches it after `applyInSeasonDynamics`/`restForNewSeason`
  (both rebuild the T1 world and DROP `tier2`), and runs `runTier2Offseason` after the
  T1 off-season. T2 players evolve only at the off-season (static dynamics in-season).
- **Promotion pipeline** (`tier2Offseason.runTier2Offseason`): strong T2 players
  (overall ≥ `PROMOTE_OVERALL_MIN` OR potential ≥ `PROMOTE_POTENTIAL_MIN`) are moved
  into the T1 free-agent pool (tier→'t1', `status:'free_agent'`) where the T1 market
  signs them next window; weak surplus T1 free agents fall to T2. It reuses the T1
  `developPlayer`/`decideRetirement`/`generateNewgens` so curves are consistent. Knobs
  in `BALANCE.CAREER.TIER2`. ~8 promote + 8 relegate per off-season by default.
- **UI wiring:** `worldToSlice`/`sliceToWorld` in `commands.js` now carry `world.tier2`
  through the store world slice (`state.world.tier2`). This means `advanceSeason` runs
  T2 events in the UI path (same as the headless engine path). Legacy saves without
  `tier2` in the world slot get `null` gracefully (no crash; T2 simply doesn't
  simulate for that session). The new `Tier2Screen` (`src/ui/screens/Tier2.js`) surfaces
  the live `season.state.tier2.ledger` standings via `selectT2Standings` in selectors.js,
  which reads team names from the static `TIER2_TEAMS_BY_REGION` seed data (no engine
  call needed at render time).

## Build / test / run

- No build step. Run the app: `node scripts/serve.mjs` (or open `index.html`).
- Full test suite: `node tests/run.mjs`. **It is slow on a `\\wsl.localhost` / network filesystem
  — run it in the background and read the log.** Run a single suite fast with:
  `node --input-type=module -e "import t from './tests/<name>.test.mjs'; t().then(()=>console.log('PASS')).catch(e=>{console.error(e);process.exit(1)})"`.
- Multi-season smoke / narrative: `node scripts/demo-career.mjs [seed] [seasons]`.
- Career test invariants live in `tests/career.test.mjs`; market/contract units in
  `tests/unit/{transfers,contracts}.test.mjs`; talent-pool invariants in
  `tests/unit/talent-pool.test.mjs`. Prefer outcome (multi-season invariant) assertions
  over pinning exact champions/rosters — there is no golden-master career fixture.

## UI layer (`src/ui/` + `styles/`)

- Vanilla ES modules, zero deps. Screens/components are pure `(state, dispatch, store) => VNode`
  built with the hyperscript `h` from `src/ui/render.js`; they read game truth ONLY through
  selectors and never touch `document`/`window`. The same tree serializes via `toHtml` so every
  screen is testable headlessly — that is how `tests/ui/*.test.mjs` work (assert on the HTML string).
- `h(tag, props, ...children)` flattens nested arrays in children, so `cond ? [Icon(...), ' text'] : x`
  is a valid single child.
- **Icons, not emoji.** Chrome/marker glyphs use the inline-SVG set in `components/Icon.js`
  (`Icon(name, { size, class })`) — monochrome `currentColor`, `aria-hidden`, sits beside a real
  text label. Emoji render as tofu (□) in headless/Linux and look incoherent, so don't add them to
  shell/markers; the colourful trophy cabinet (`screens/Team.js`) is the one intentional exception.
- Design tokens live in `styles/theme.css` (`--sp-*`, `--fs-*`, colours, `--ring`); `styles/main.css`
  consumes them. Keyboard focus uses `box-shadow: var(--ring)` on `:focus-visible` — prefer that token
  over bespoke outlines. Engine/domain layers never emit class names; only `src/ui/**` + `src/main.js` do.
- Run the app over HTTP (`npm start` → http://localhost:8000); ES modules won't load from `file://`.
- Full `node tests/run.mjs` also runs the slow engine/season suites; for quick UI iteration import a
  single `tests/ui/*.test.mjs`'s default export and call it.
- **Screen-local state lives in route params** (`state.ui.route.params`), set via
  `dispatch(navigate(screen, params))` — active sort, region filter, picked event — not in
  module/closure state, so screens stay pure and re-render-safe.
- **Adding a screen touches four spots**: a file under `src/ui/screens/`, a `ROUTES` entry in
  `src/ui/router.js`, a `NAV_ITEMS` entry in `src/ui/components/Sidebar.js` (each item is
  `{screen,label,icon,glyph}` — `icon` names a shape in `components/Icon.js`; add one there if
  missing), and (if styled) a BEM block in `styles/main.css`. `Sidebar.NAV_PARENT` maps contextual
  (non-nav) screens onto a parent nav highlight.
- **Heavier presentation maths belongs in a pure helper module** (e.g. `src/ui/derive.js`,
  `src/ui/leagueStats.js` for the Stats analytics page) rather than inline in the screen — easier to
  unit-test and reuse. Player "overall" = `overall(player)` (`engine/career/playerStats.js`, mean of
  nine attributes); team Elo + region come from `selectTeamRatings`. Players carry no region — derive
  it from their team (`contract.teamId` → `team.region`). Tier is `'t1'|'t2'` on teams and
  `'t1'|'t2'|'prospect'` on players.
- **Derivations must be robust to empty / early-career worlds**: guard means against
  divide-by-zero, return a structured empty shape — screens render an empty state, never crash or
  emit `NaN`.

## Agent abilities — match engine (`engine/match/abilities.js`)

- **Ability archetypes** are a SECOND classification layer (separate from Valorant role). Each agent maps to one of `'info'` / `'smoke'` / `'flash'` / `'anchor'` / `'duelist'` in `AGENT_ARCHETYPE` inside `abilities.js`. The mapping is authoritative; agents not listed default to no effect (graceful).
- **`compProfile(comp)`** → archetype counts. **`compAbilityEffects(comp, ultReady)`** → `{ atkFactor, defFactor, tradeBonus, ultBonus }` multipliers applied per round in `roundSim.js`. All constants live in `BALANCE.ABILITY` (config/balance.js).
- **Ult economy**: `createUltState(comp)` / `advanceUltState(state, kills, won)` thread through `mapSim.js`'s round loop. When `state.ready === true` at the START of a round, `ultReadyA/B` is passed to `simRound()` and the bonus fires; the advance then resets to 0. `MapResult` gains `ultUsage: {A, B}` (fire count) and `abilityProfile: {A, B}` (per-team archetype counts).
- **Backward compatibility**: `compA`/`compB`/`ultReadyA`/`ultReadyB` are OPTIONAL in `SimRoundArgs` — existing callers that omit them get 1× multipliers (no-op). Tests assert this.
- **Effect magnitudes**: smoke +2.5% ATK per agent, flash +1.5% ATK, anchor +2.5% DEF, info +4% trade probability, balanced comp (has smoke/flash + anchor + info) +2% on both, ult +8% econ factor. All capped at 10%. Meaningful but not dominant — comparable to the chemistry multiplier swing.
## Spectator / god-observer model (the app is hands-off — NO team management)

- **This is a WorldBox-style god-observer spectator sim, not a GM game.** The user never manages a
  team: there is NO sell / release / sign / buy / contract-extend / lineup-reorder / coach hire-fire.
  Those commands were REMOVED from `state/commands.js`; do not re-add user agency over rosters. The
  engine runs every club autonomously — you are removing *user agency*, not the simulation.
- **No privileged "my team".** `continueSeason` runs the off-season with `runCareerOffseason(career)`
  (no `protectTeamId`), so even the team the camera is on is subject to the same AI market. The engine
  still *accepts* a `protectTeamId` opt (unused by the UI now) — leave that engine param alone.
- **"Followed team" is a FREE CAMERA, not ownership.** `followTeam(store, teamId|null)` just points a
  lightweight viewing focus (`ui.followedTeamId`); null = roam all teams. The Sidebar footer is the
  "NOW VIEWING" chip and the TopBar's far-left control is the "Camera" dropdown — both pure focus.
- **Management screens are now READ-ONLY observation views** (data kept, action controls dropped):
  `Finances.js` (budget/payroll ledger — `selectTeamFinances`/`selectPayrollBreakdown`/
  `selectTransferBalance`), `Squad.js` ("Roster"), `TransferMarket.js` ("Market Watch": read-only
  finances + coach card + roster + league free-agent pool). When restyling these, do NOT reintroduce
  buttons that mutate the world.
- **Kept observer tools:** the god-mode editor (`editPlayer`/`editTeam`/`healPlayer`) and scouting
  (`scoutPlayer`) — world-shaping, not team management.

## Visual identity — "Mission Control" (styles/)

- The look is a sleek esports-broadcast / control-surface dashboard: deep slate-navy base, an electric
  **signal-cyan** accent (`--accent`), a warm **amber/red "live"** secondary (`--live`), sharp HUD
  radii, and a mono "HUD" voice for labels (uppercase, `--tracking-hud`). EVERYTHING is token-driven
  in `styles/theme.css` — change a token and the whole app shifts; screens never hardcode hex.
- Structural identity lives in `styles/main.css`: body has a fixed HUD gridline texture; the Sidebar
  is a grouped broadcast rail (NAV_ITEMS now carry a `section` field: watch/competition/world/tools)
  with a glowing active marker; panel/card/table titles use the mono HUD voice; the TopBar carries a
  "LIVE" on-air chip. Keyboard focus still uses `box-shadow: var(--ring)` on `:focus-visible`.
- New icons go in `components/Icon.js` (e.g. `cross` = injury marker). Icons, never emoji.
