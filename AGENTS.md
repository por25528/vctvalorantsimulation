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
