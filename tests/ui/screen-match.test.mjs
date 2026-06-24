/**
 * tests/ui/screen-match.test.mjs — Match screen (CONTRACTS-UI §5 'match', §8).
 *
 * Integration-flavored, headless via toHtml (no DOM). Builds the REAL Phase-3
 * store, bootstraps the Pacific world, runs continueSeason (sims the Kickoff —
 * engine-backed series with real maps/box scores), picks a real seriesId from
 * the played event, opens it via openSeries, then renders MatchScreen(state,
 * dispatch) -> toHtml and asserts:
 *   - the series header shows both team names + the map score;
 *   - the VetoPanel lists the veto map picks;
 *   - the map switcher exposes a tab per played map;
 *   - the RoundTicker for the selected map has exactly score.A+score.B cells;
 *   - the BoxScore shows every player handle as rows;
 *   - play/pause + seek controls are present and tickerSet wiring is pure
 *     (dispatch fired only on interaction, not during render).
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason, openSeries } from '../../src/state/commands.js';
import { selectSeries } from '../../src/state/selectors.js';
import { tickerSet, setSpoilerFree } from '../../src/state/actions.js';
import { MatchScreen, VetoPanel } from '../../src/ui/screens/Match.js';

/** Count non-overlapping occurrences of a substring. */
function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

export default async function screenMatchTest() {
  section('ui/screen-match — Match screen over a real Kickoff series');

  // --- build the real store (full slice tree, incl. season) -------------
  const store = buildStore();

  await bootstrap(store, { fresh: true });
  // This suite asserts the full result is visible (header score, box score, all
  // map tabs), so disable spoiler-free mode — the spoiler-free spectator reveal
  // is covered separately in screen-spectator.test.mjs.
  store.dispatch(setSpoilerFree(false));
  continueSeason(store, { simEvent: true }); // advances the regional Kickoff slot (engine-backed)

  const state0 = store.getState();
  const kickoff = state0.events.byId['pacific-kickoff'];
  assert(kickoff, 'continueSeason populated the Kickoff event');
  assert(Array.isArray(kickoff.series) && kickoff.series.length > 0, 'Kickoff has played series');

  // Pick a real series that actually played maps + has a veto.
  const series = kickoff.series.find((s) => (s.maps || []).length > 0 && s.veto && s.veto.picks.length > 0);
  assert(series, 'found a played series with maps + veto');

  // --- open it through the command path (sets ticker + route) -----------
  openSeries(store, series.id);
  let state = store.getState();
  assertEqual(state.ui.route.screen, 'match', 'openSeries navigated to the match screen');
  assertEqual(state.ui.ticker.seriesId, series.id, 'ticker points at the opened series');

  // sanity: the series is resolvable via the selector the screen uses
  assert(selectSeries(state, series.id) === series || selectSeries(state, series.id), 'selectSeries resolves it');

  // --- render the screen headlessly -------------------------------------
  let dispatched = [];
  const dispatch = (a) => {
    dispatched.push(a);
    store.dispatch(a);
  };

  const html = toHtml(MatchScreen(state, dispatch));
  assert(dispatched.length === 0, 'render is pure: no dispatch during render');

  // header: both team names + the series score appear
  const teamA = state.world.teams[series.teamAId];
  const teamB = state.world.teams[series.teamBId];
  assert(html.includes(teamA.name), `header shows team A name '${teamA.name}'`);
  assert(html.includes(teamB.name), `header shows team B name '${teamB.name}'`);
  assert(html.includes('match__score'), 'header has the map-score block');

  // --- veto: every pick's map id is exposed -----------------------------
  assert(html.includes('class="veto"') || html.includes('veto__list'), 'VetoPanel rendered');
  for (const pick of series.veto.picks) {
    assert(html.includes(`data-map="${pick.mapId}"`), `veto exposes map '${pick.mapId}'`);
  }
  const vetoCount = countOccurrences(html, 'class="veto__pick');
  assertEqual(vetoCount, series.veto.picks.length, 'one veto entry per pick');

  // --- map switcher: a tab per played map -------------------------------
  const tabCount = countOccurrences(html, 'role="tab"');
  assertEqual(tabCount, series.maps.length, 'one map tab per played map');

  // --- selected map: RoundTicker cells == score.A + score.B -------------
  const map0 = series.maps[0];
  const total = (map0.score.A || 0) + (map0.score.B || 0);
  assert(total >= 13, 'precondition: a real map reaches >=13 rounds');
  // Count cells via their winner-team theme class (one per played round), the
  // same anchor RoundTicker's own test uses — avoids matching the inner
  // `ticker__cell-n` span.
  const cellCount =
    countOccurrences(html, 'ticker__cell--teamA') + countOccurrences(html, 'ticker__cell--teamB');
  assertEqual(cellCount, total, 'round ticker has exactly score.A+score.B cells');
  assert(html.includes('ticker__strip'), 'round ticker strip rendered');

  // --- BoxScore: every player handle present as a row -------------------
  const playersById = state.world.players;
  const boxPlayerIds = Object.keys(map0.boxScore);
  assert(boxPlayerIds.length >= 10, 'box score has both rosters (>=10 players)');
  const rowCount = countOccurrences(html, 'class="boxscore__row');
  assertEqual(rowCount, boxPlayerIds.length, 'one box-score row per player');
  for (const pid of boxPlayerIds) {
    const handle = (playersById[pid] && playersById[pid].handle) || pid;
    assert(html.includes(handle), `box score shows player handle '${handle}'`);
  }
  assert(html.includes('boxscore__row--mvp'), 'box score highlights the MVP');

  // --- playback controls: play/pause + seek range -----------------------
  assert(html.includes('match__play'), 'play/pause button present');
  assert(html.includes('match__seek'), 'seek range present');
  assert(html.includes('type="range"'), 'seek is an input range');

  // --- interaction wiring: tickerSet via dispatch -----------------------
  // Switching to map 2 (if present) dispatches a mapIndex change. Drive it via
  // the action creator the screen uses to confirm the wiring shape.
  store.dispatch(tickerSet({ mapIndex: 0, roundIndex: 6, playing: true }));
  state = store.getState();
  assertEqual(state.ui.ticker.roundIndex, 6, 'tickerSet seeks the round cursor');
  assert(state.ui.ticker.playing === true, 'tickerSet toggles playback');

  // Re-render in playback mode: cell count is stable, later rounds hidden.
  const playHtml = toHtml(MatchScreen(store.getState(), dispatch));
  assertEqual(
    countOccurrences(playHtml, 'ticker__cell--teamA') + countOccurrences(playHtml, 'ticker__cell--teamB'),
    total,
    'playback keeps the full cell count'
  );
  const hidden = countOccurrences(playHtml, 'ticker__cell--hidden');
  assert(hidden > 0, 'playback hides rounds beyond the cursor');

  // --- empty guards ------------------------------------------------------
  const noSeries = toHtml(
    MatchScreen(
      { ui: { route: { params: {} }, ticker: { seriesId: null } }, world: { teams: {}, players: {} } },
      () => {}
    )
  );
  assert(noSeries.includes('match--empty'), 'missing series renders an empty match screen');

  const emptyVeto = toHtml(VetoPanel({ veto: { picks: [] } }));
  assert(emptyVeto.includes('veto--empty'), 'empty veto renders a placeholder');

  // eslint-disable-next-line no-console
  console.log(
    `ui/screen-match: series ${series.id} -> header + veto(${series.veto.picks.length}) + ` +
      `${series.maps.length} map tabs + ticker(${total}) + boxscore(${boxPlayerIds.length}) OK.`
  );
}
