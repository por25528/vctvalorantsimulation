/**
 * ui/router.js — route state -> active Screen (CONTRACTS-UI §4).
 *
 * Phase 3 (UI shell). Maps a screen id to its screen render function and, given
 * the live store state, renders the active screen via {@link selectRoute}.
 *
 * CALLING CONVENTION (the one signature every screen shares):
 *   screen(state, dispatch, store) => VNode
 *
 * Each screen is a pure `(state, dispatch[, store])` function. Most screens only
 * need `(state, dispatch)`; HomeInbox additionally takes `store` so its
 * Continue button can call the engine-touching `continueSeason(store)` command.
 * The remaining screens accept (and ignore) the third argument, so passing
 * `store` to every screen is harmless and lets the router stay uniform. Screens
 * that themselves call commands (Bracket, via openSeries) build a minimal store
 * facade internally from `(state, dispatch)`, so they work with or without the
 * forwarded `store`. No screen needed modification to share this convention.
 *
 * DOM-free: this module only composes pure screen functions, so RouterOutlet
 * serializes via toHtml headlessly (used by tests).
 */

import { selectRoute } from '../state/selectors.js';

import { WorldHub } from './screens/WorldHub.js';
import { Calendar } from './screens/Calendar.js';
import { StandingsScreen } from './screens/Standings.js';
import { BracketScreen } from './screens/Bracket.js';
import { TournamentScreen } from './screens/Tournament.js';
import { MatchScreen } from './screens/Match.js';
import { MatchDayScreen } from './screens/MatchDay.js';
import { TeamScreen } from './screens/Team.js';
import { PlayerScreen } from './screens/Player.js';
import { StatsLeadersScreen } from './screens/StatsLeaders.js';
import { LeagueStatsScreen } from './screens/LeagueStats.js';
import { CPStandingsScreen } from './screens/CPStandings.js';
import { RankingsScreen } from './screens/Rankings.js';
import { GlobalRankingsScreen } from './screens/GlobalRankings.js';
import { LadderScreen } from './screens/Ladder.js';
import { ChampionsScreen } from './screens/Champions.js';
import { SaveLoadScreen } from './screens/SaveLoad.js';
import { Squad } from './screens/Squad.js';
import { TransferMarket } from './screens/TransferMarket.js';
import { PlayerDevelopment } from './screens/PlayerDevelopment.js';
import { Awards } from './screens/Awards.js';
import { News } from './screens/News.js';
import { Editor } from './screens/Editor.js';
import { Offseason } from './screens/Offseason.js';
import { Scouting } from './screens/Scouting.js';
import { FinancesScreen } from './screens/Finances.js';
import { Tier2Screen } from './screens/Tier2.js';

/**
 * Screen id -> screen render fn (CONTRACTS-UI §5).
 * Every entry shares the `(state, dispatch, store) => VNode` convention.
 * @type {Record<string, (state:object, dispatch:Function, store?:object) => import('./render.js').VNode>}
 */
export const ROUTES = Object.freeze({
  home: WorldHub,
  matchday: MatchDayScreen,
  calendar: Calendar,
  tournament: TournamentScreen,
  // Legacy route ids — the nav now unifies these under `tournament`, but the
  // standalone screens stay registered so any in-flight deep link still resolves.
  standings: StandingsScreen,
  bracket: BracketScreen,
  match: MatchScreen,
  team: TeamScreen,
  player: PlayerScreen,
  leaders: StatsLeadersScreen,
  stats: LeagueStatsScreen,
  cp: CPStandingsScreen,
  rankings: RankingsScreen,
  globalrankings: GlobalRankingsScreen,
  ladder: LadderScreen,
  champions: ChampionsScreen,
  saves: SaveLoadScreen,
  squad: Squad,
  market: TransferMarket,
  scouting: Scouting,
  finances: FinancesScreen,
  development: PlayerDevelopment,
  awards: Awards,
  news: News,
  editor: Editor,
  offseason: Offseason,
  tier2: Tier2Screen
});

/** The fallback screen id for unknown routes. */
const DEFAULT_SCREEN = 'home';

/**
 * Resolve the active screen's VNode for the current route.
 *
 * Reads the route via {@link selectRoute}, looks the screen fn up in
 * {@link ROUTES} (unknown -> home), and invokes it with the shared
 * `(state, dispatch, store)` convention.
 *
 * @param {object} state     the full store state
 * @param {(action:object)=>void} dispatch  store dispatch
 * @param {object} [store]   store reference, forwarded to screens that need
 *                           command access (HomeInbox -> continueSeason). May be
 *                           omitted in headless render-only tests.
 * @returns {import('./render.js').VNode}
 */
export function RouterOutlet(state, dispatch, store) {
  const route = selectRoute(state) || { screen: DEFAULT_SCREEN };
  const screen = ROUTES[route.screen] || ROUTES[DEFAULT_SCREEN];
  return screen(state, dispatch, store);
}
