# CONTRACTS-UI — Phase 3 UI Shell (binding interface spec)

Builds on `CONTRACTS.md` (engine) and `CONTRACTS-FORMAT.md` (format engine). Phase 3 makes the simulator **visible**: an FM-style shell (sidebar hub + Continue loop) over the existing engine, with Standings, the triple-elim Bracket, and a Match view (round-ticker + box score).

**Tech rules:** vanilla ES modules, zero build, zero dependencies. The UI layer (`src/ui/**`, `src/state/**`, `src/main.js`) is the ONLY place `document`/`window` may be used — and even there, components are pure `props -> VNode` so they render headlessly via `toHtml`. The engine/domain/config/format layers remain DOM-free. Existing scaffold stubs (ui/app.js, ui/router.js, ui/render.js, ui/components/BoxScore.js, ui/components/RoundTicker.js, ui/screens/Match.js, state/slices/*, state/actions.js, state/selectors.js) must be Read then replaced.

---

## 1. Rendering layer — `src/ui/render.js`

A tiny hyperscript + DOM renderer + string serializer. No virtual-DOM library.

```js
/** @typedef {{tag:string, props:object, children:Array<VNode|string>}} VNode */
export const Fragment = Symbol('Fragment');
export function h(tag, props, ...children)   // tag: string | Fragment | (props)=>VNode (component). Flattens/838 ignores null children. props.class, props.onClick, props.key, props.style(object), value, checked, etc.
export function mount(vnode, container)       // build real DOM from vnode, replace container's children, attach event handlers
export function patch(container, vnode)       // re-render: diff against last vnode for this container (keyed by props.key in lists) and apply minimal DOM updates
export function toHtml(vnode)                 // -> HTML string; pure; event handlers omitted; used by tests (no DOM needed)
```

Rules: `h('div', {class:'x'}, child1, child2)`; a function `tag` is a component invoked as `tag(props)` (children passed as `props.children`). Event props are `on<Event>` camelCase (`onClick`, `onInput`). `toHtml` must escape text. Keep it < ~250 LOC. Provide `classNames(...parts)` helper (truthy join).

## 2. State shape & store wiring

The Phase-1 store (`core/store.js`: `createStore`, `combineReducers`) is reused. Phase 3 adds slices and wires bootstrap.

```js
// state/slices/world.js   (EXISTS) -> { leagues, teams, players }
// state/slices/events.js          -> { byId:Record<eventId,EventResult>, order:string[], status:Record<eventId,'pending'|'complete'> }
// state/slices/ui.js              -> {
//   route:{ screen:string, params:object },        // screen ids in §5
//   followedTeamId:string|null,
//   ticker:{ seriesId:string|null, mapIndex:number, roundIndex:number, playing:boolean },
//   modals:Array<{id,type,props}>, toasts:Array<{id,kind,text}>
// }
```

Root reducer = `combineReducers({ world, events, ui })`.

```js
// state/actions.js  — plain action creators (type + payload)
export const navigate = (screen, params={}) => ({ type:'ui/navigate', screen, params })
export const follow   = (teamId) => ({ type:'ui/follow', teamId })
export const addEvent = (eventId, result) => ({ type:'events/add', eventId, result })
export const setStatus= (eventId, status) => ({ type:'events/status', eventId, status })
export const tickerSet = (patch) => ({ type:'ui/ticker', patch })       // {seriesId,mapIndex,roundIndex,playing}
export const pushToast = (kind, text) => ({ type:'ui/toast/push', kind, text })
export const dismissToast = (id) => ({ type:'ui/toast/dismiss', id })
export const openModal = (type, props) => ({ type:'ui/modal/open', modalType:type, props })
export const closeModal = (id) => ({ type:'ui/modal/close', id })

// state/commands.js — orchestration that touches the engine (no middleware needed in Phase 3)
export function bootstrap(store)               // load PACIFIC_SEED -> normalize via createPlayer/createTeam -> dispatch world init; set followedTeam default; set route home
export function continueSeason(store, eventSeed=2026)  // if pacific-kickoff pending: run simEvent(KICKOFF_FORMAT, ctx, seed) -> addEvent + setStatus complete -> toast -> navigate('standings',{eventId}). If complete: toast "Season complete (Phase 3 demo)".
export function openSeries(store, seriesId)     // tickerSet to that series (mapIndex 0) + navigate('match',{seriesId})
```

`bootstrap` builds the world from the Pacific seed (12 teams / 60 players). `continueSeason` runs the Kickoff synchronously (≈32 series, <1s — the worker is a Phase-4 concern; show an optimistic toast).

## 3. Selectors — `state/selectors.js` (pure, memoized where useful)

```js
selectRoute(state) selectFollowedTeam(state) selectTeams(state) selectTeam(state,id) selectPlayer(state,id)
selectEvent(state,eventId) selectKickoff(state)            // the pacific-kickoff EventResult or null
selectStage(state,eventId,stageId)                          // StageResult
selectStandings(state,eventId,stageId)                      // standings rows + team display info
selectPlacements(state,eventId)                             // [{rank,teamId,losses,eliminatedIn,cp,qual}] joined w/ awardCP + kickoffQualifiers
selectSeries(state,seriesId)                                // a SeriesRef from any event
selectLeaders(state,eventId)                                // flattened player box-score leaders (ACS/K/D/clutch) across all series, top N
selectBracketModel(state,eventId,stageId)                   // see §6 buildBracketView
```

## 4. App shell — `src/ui/app.js`, `src/main.js`, `index.html`

- `app.js`: `export function App(store)` mounts the shell into `#app`, subscribes to the store, and on every change recomputes the screen via the router and `patch`es. Layout: `<div class="app"> TopBar Sidebar <main class="screen"> RouterOutlet </main> ModalRoot ToastRoot </div>`.
- `ui/router.js`: `export function RouterOutlet(state, dispatch)` -> the active screen's VNode based on `selectRoute`. `export const ROUTES` maps screen id -> screen fn. Unknown route -> Home.
- `main.js`: build root reducer + store, `bootstrap(store)`, `App(store)`. This is what `index.html` loads (`<script type="module" src="src/main.js">`).
- `index.html`: minimal — `<div id="app"></div>` + the stylesheet links + the module script. No inline logic.

## 5. Screens — `src/ui/screens/*` — each `(state, dispatch) => VNode`

| id | file | shows |
|----|------|-------|
| `home` | HomeInbox.js | Followed team card, "Continue" call-to-action, recent results / a few news lines, jump links |
| `calendar` | Calendar.js | The season's events (Phase 3: just Pacific Kickoff) with status; click → standings |
| `standings` | Standings.js | Group A & B standings tables (StandingsTable), final placements table with losses + CP + qualification badges |
| `bracket` | Bracket.js | The triple-elim playoff tree (BracketView) — Upper/Middle/Lower columns, each match clickable → match screen |
| `match` | Match.js | One series: VetoPanel (map picks), a map switcher, RoundTicker + BoxScore for the selected map |
| `team` | Team.js | Roster table (→ player), team's series in the event, record |
| `player` | Player.js | AttributeRadar + attribute list, role, per-map box-score lines from the event |
| `leaders` | StatsLeaders.js | Sortable leaderboards (ACS, K, FB, clutch) across the event (DataTable) |

Screens are pure: read via selectors, return VNodes, wire `onClick` to `dispatch(...)` / command calls. No data fetching beyond selectors.

## 6. Components — `src/ui/components/*` — each `(props) => VNode`, pure

- `Sidebar(props)` — nav buttons (screen id + label + icon glyph), highlights active route, dispatches `navigate`. Includes the followed-team badge.
- `TopBar(props)` — event/season label, `ContinueButton`, save menu placeholder.
- `ContinueButton(props)` — big primary button; `onClick` → `continueSeason(store)`. Disabled/labeled "Season complete" when done.
- `StandingsTable(props:{rows, onTeam})` — ranked table: #, team, W-L, map diff, round diff.
- `DataTable(props:{columns, rows, sortKey, onSort, rowKey})` — generic sortable table (the leaders + box score build on it).
- `BoxScore(props:{mapResult, playersById, teamsById})` — two team blocks, players sorted by ACS, columns K/D/A, ACS, ADR, KAST, FB, CL, KD; MVP highlighted.
- `RoundTicker(props:{mapResult, index, playing, onSeek})` — horizontal strip of round cells; each cell colored by `winnerTeam` (A/B theme colors), a small glyph for econ type (pistol/eco/force/full) and end condition (elim/spike/defuse/time); halftime + OT dividers; `index` reveals rounds ≤ index when `playing` (playback), full strip otherwise; running score above.
- `BracketView(props:{model})` — renders the §6 bracket model as columns (Upper/Middle/Lower for triple; Winners/Losers for double), each match a card (two team rows + scores, winner emphasized), clickable.
- `AttributeRadar(props:{attributes})` — a small inline-SVG radar of the 9 attributes (pure SVG via `h('svg',...)`).
- `Modal(props)` / `Toast(props)` + `ModalRoot(state,dispatch)` / `ToastRoot(state,dispatch)`.

`buildBracketView(eventResult, stageDescriptor)` — a pure helper (place in `ui/derive.js`): for a bracket stage, call `buildTemplate(stageDescriptor.bracketType, stageDescriptor.size)` and join with `eventResult.series` (by matchId) → `{ columns:[{ round, matches:[{matchId, a:{teamId,score,winner}, b:{...}, bestOf}] }] }`. Group the 18 triple-elim matches into Upper / Middle / Lower columns by their id prefix (U*/M*/L*).

## 7. Theme & CSS — `styles/main.css`, `styles/theme.css`

Dark esports aesthetic. `theme.css` defines CSS custom properties (tokens): `--bg`, `--panel`, `--panel-2`, `--text`, `--muted`, `--accent` (Valorant red ~#ff4655), `--teamA`, `--teamB`, `--win`, `--loss`, side colors for atk/def, econ glyph colors, spacing/radius/typescale. `main.css` styles the shell grid (sidebar + topbar + screen), tables, bracket cards/connectors, round-ticker cells, badges, buttons, radar. Use the token vars throughout; BEM-ish class names (`.sidebar`, `.sidebar__item--active`, `.ticker__cell--atk`, `.bracket__match--won`). Must look clean at 1280×800.

## 8. Testing — headless via `toHtml`

UI is verified WITHOUT a browser by rendering components/screens to HTML strings and asserting content. Tests under `tests/ui/*.test.mjs` (default-export async, throw on failure), discovered by `tests/run.mjs`.

- Each component test: call the component with mock props → `toHtml` → assert structure/content (e.g. BoxScore HTML contains every player handle and the MVP marker; RoundTicker has exactly `score.A+score.B` cells; BracketView has 18 match cards for triple/8).
- `tests/ui/render.test.mjs`: `h`/`toHtml` correctness (nesting, escaping, attrs, Fragment, component tags).
- `tests/ui/smoke.test.mjs` (the integration check): build the real store, `bootstrap`, `continueSeason` (sim the Kickoff), then for EVERY screen id set `ui.route` and render `RouterOutlet(getState(), dispatch)` → `toHtml` WITHOUT throwing and assert each contains expected anchors (Standings shows team names + CP; Bracket shows 18 matches; Match shows round-ticker cells + box-score rows; Player shows a radar `<svg>`). Also assert `continueSeason` populated `events` with a 12-placement Kickoff.
- All via `node tests/run.mjs` (must stay green for ALL prior suites too).

## 9. Phase-3 scope boundary

IN: shell, routing, Continue (sim Kickoff + browse), Standings, Bracket, Match (ticker+box), Team, Player, Leaders, theme, headless tests. OUT (later phases): full 8-event calendar & worker (P4), persistence/save UI (P5), transfers/editor screens & career dynamics (P6/7). Stubs for those remain. The app must run by opening `index.html` (or a static server) and let the user hit Continue, watch the Pacific Kickoff resolve, and browse the triple-elim bracket, standings, matches, and players.
