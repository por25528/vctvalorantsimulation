/**
 * tests/ui/screen-spectator.test.mjs — the spoiler-free spectator match flow (P14).
 *
 * Headless via toHtml + the real store. Verifies that, with spoiler-free mode ON
 * (the default), an opened series plays out LIVE and nothing is spoiled ahead of
 * the watch cursor:
 *   - the series score + winner are hidden behind a "LIVE" pill,
 *   - only the maps reached so far get tabs (the map count isn't given away),
 *   - the box score is withheld until a map is watched to its final round,
 *   - finishing a map mid-series offers a "Next map" control,
 *   - reaching/▸revealing the last map unlocks the full result,
 *   - turning spoilers ON opens straight onto the full, paused result.
 * Also checks the ui-slice reducers for the two new settings.
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason, openSeries } from '../../src/state/commands.js';
import { tickerSet, setSpoilerFree, setAutoplaySpeed } from '../../src/state/actions.js';
import { uiReducer, initialUiState } from '../../src/state/slices/ui.js';
import { MatchScreen } from '../../src/ui/screens/Match.js';

/** Count non-overlapping occurrences of a substring. */
function countOf(haystack, needle) {
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

const mapTotal = (m) => ((m.score.A || 0) + (m.score.B || 0));

export default async function spectatorTest() {
  section('ui/screen-spectator — spoiler-free reveal');

  /* ----------------------------- ui reducers ----------------------------- */
  assertEqual(initialUiState.spoilerFree, true, 'spoiler-free is ON by default');
  assertEqual(initialUiState.autoplaySpeed, 'normal', 'autoplay speed defaults to normal');
  assertEqual(uiReducer(initialUiState, setSpoilerFree(false)).spoilerFree, false, 'setSpoilerFree(false) clears it');
  assertEqual(uiReducer(initialUiState, setAutoplaySpeed('fast')).autoplaySpeed, 'fast', 'setAutoplaySpeed sets the cadence');
  assertEqual(uiReducer(initialUiState, setAutoplaySpeed('bogus')).autoplaySpeed, 'normal', 'an unknown speed falls back to normal');

  /* ------------------------- a real played series ------------------------ */
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  assert(store.getState().ui.spoilerFree === true, 'a fresh career starts spoiler-free');
  continueSeason(store, { simEvent: true }); // sim the Pacific Kickoff slot

  const kickoff = store.getState().events.byId['pacific-kickoff'];
  // A multi-map series so the "only reached maps get tabs" rule is observable.
  const series = kickoff.series.find((s) => (s.maps || []).length >= 2);
  assert(series, 'found a played multi-map series');
  const totalMaps = series.maps.length;

  /* ----------------------- opening a series goes LIVE --------------------- */
  openSeries(store, series.id);
  let st = store.getState();
  assert(st.ui.ticker.playing === true, 'spoiler-free open auto-plays the series');
  assertEqual(st.ui.ticker.maxMap, 0, 'open resets the map high-water mark');
  assertEqual(st.ui.ticker.revealed, false, 'the result starts locked');

  let html = toHtml(MatchScreen(st, () => {}));
  assert(html.includes('match__live') && html.includes('LIVE'), 'header shows a LIVE pill, not the result');
  assert(!html.includes('match__bestof'), 'the Bo badge (a result tell) is hidden while live');
  assertEqual(countOf(html, 'role="tab"'), 1, 'only the first map has a tab (map count is not spoiled)');
  assert(html.includes('match__boxhold'), 'the box score is withheld until the map ends');
  assertEqual(countOf(html, 'class="boxscore__row'), 0, 'no box-score rows while the map is mid-watch');

  /* --------------------- watch map 1 out -> it reveals -------------------- */
  const map0Total = mapTotal(series.maps[0]);
  store.dispatch(tickerSet({ roundIndex: map0Total, playing: false }));
  st = store.getState();
  html = toHtml(MatchScreen(st, () => {}));
  assert(!html.includes('match__boxhold'), 'finishing map 1 reveals its box score');
  assert(countOf(html, 'class="boxscore__row') >= 10, 'both rosters appear once the map is watched out');
  assert(html.includes('match__nextmap'), 'a "Next map" control appears mid-series');
  // The series result is still locked (more maps to watch).
  assert(html.includes('match__live'), 'the series result stays locked after only map 1');

  /* --------------------------- reveal the result ------------------------- */
  // Simulate the "Reveal result" control (jump to the end of the last map).
  const lastTotal = mapTotal(series.maps[totalMaps - 1]);
  store.dispatch(tickerSet({ mapIndex: totalMaps - 1, maxMap: totalMaps - 1, roundIndex: lastTotal, playing: false, revealed: true }));
  st = store.getState();
  html = toHtml(MatchScreen(st, () => {}));
  assert(!html.includes('match__live'), 'revealing the result drops the LIVE pill');
  assert(html.includes('match__bestof'), 'the Bo badge returns once revealed');
  assertEqual(countOf(html, 'role="tab"'), totalMaps, 'every map tab shows once the series is revealed');
  assert(html.includes('match__team--won'), 'the winning team is emphasised once revealed');

  /* ------------------- spoilers ON opens the full result ----------------- */
  store.dispatch(setSpoilerFree(false));
  openSeries(store, series.id);
  st = store.getState();
  assert(st.ui.ticker.playing === false, 'with spoilers on, a series opens paused on the full result');
  html = toHtml(MatchScreen(st, () => {}));
  assert(!html.includes('match__live'), 'no LIVE pill with spoilers on');
  assertEqual(countOf(html, 'role="tab"'), totalMaps, 'all map tabs show immediately with spoilers on');
  assert(countOf(html, 'class="boxscore__row') >= 10, 'the box score shows immediately with spoilers on');

  // eslint-disable-next-line no-console
  console.log(`ui/screen-spectator: live reveal over a ${totalMaps}-map series OK (tabs gate, box-score gate, result lock).`);
}
