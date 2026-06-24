/**
 * tests/ui/smoke.test.mjs — the Phase-3 integration smoke check (CONTRACTS-UI §8).
 *
 * Builds the REAL Phase-3 store via buildStore, bootstraps the Pacific world,
 * runs continueSeason (engine-backed sim of the Pacific Kickoff), then asserts
 * the events slice holds a 12-placement Kickoff. After that it walks EVERY
 * screen id (home, calendar, standings, bracket, match, team, player, leaders),
 * setting `ui.route` (with a real seriesId for match, real teamId/playerId for
 * team/player) and rendering `RouterOutlet(getState(), dispatch, store)` ->
 * toHtml WITHOUT throwing, asserting each contains its key anchors:
 *   - Standings: team names + a CP value
 *   - Bracket:   18 match cards
 *   - Match:     round-ticker cells + box-score rows
 *   - Player:    an <svg> radar
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import {
  bootstrap,
  continueSeason,
  openSeries,
  KICKOFF_EVENT_ID
} from '../../src/state/commands.js';
import { navigate, setSpoilerFree } from '../../src/state/actions.js';
import { selectKickoff } from '../../src/state/selectors.js';
import { RouterOutlet } from '../../src/ui/router.js';

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

export default async function smokeTest() {
  section('ui/smoke — build store, bootstrap, sim Kickoff, render every screen');

  // --- the real store + engine-backed Kickoff -----------------------------
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  continueSeason(store, { simEvent: true }); // advances the regional Kickoff slot (≈32 series)

  // dispatch wrapper that proves RouterOutlet renders are pure (no dispatch).
  const dispatched = [];
  const dispatch = (a) => {
    dispatched.push(a);
    return store.dispatch(a);
  };

  // --- events now hold a 12-placement Kickoff -----------------------------
  section('Kickoff populated');
  {
    const state = store.getState();
    const ev = state.events.byId[KICKOFF_EVENT_ID];
    assert(ev != null, 'continueSeason populated the Kickoff event');
    assertEqual(state.events.status[KICKOFF_EVENT_ID], 'complete', 'Kickoff marked complete');
    assert(selectKickoff(state) === ev, 'selectKickoff resolves the Kickoff');
    assert(Array.isArray(ev.placements), 'Kickoff has placements');
    assertEqual(ev.placements.length, 12, 'Kickoff holds exactly 12 placements');
    const ranks = ev.placements.map((p) => p.rank).sort((a, b) => a - b);
    assertEqual(ranks.join(','), '1,2,3,4,5,6,7,8,9,10,11,12', 'ranks 1..12 unique, no gaps');
    assert(Array.isArray(ev.series) && ev.series.length > 0, 'Kickoff has played series');
  }

  const state0 = store.getState();
  const event = selectKickoff(state0);
  const teamsById = state0.world.teams;

  // Real ids to drive the parameterized screens.
  const series = event.series.find(
    (s) => (s.maps || []).length > 0
  );
  assert(series, 'found a played series with maps');
  const teamId = series.teamAId;
  const team = teamsById[teamId];
  assert(team && (team.roster || []).length >= 1, 'series team A has a roster');
  const playerId = team.roster[0];

  /**
   * Set ui.route to a screen + params, render RouterOutlet -> toHtml without
   * throwing, and return the HTML string. Asserts render purity.
   * @param {string} screen
   * @param {object} [params]
   * @returns {string}
   */
  function renderScreen(screen, params = {}) {
    store.dispatch(navigate(screen, params));
    const before = dispatched.length;
    let html;
    try {
      html = toHtml(RouterOutlet(store.getState(), dispatch, store));
    } catch (err) {
      throw new Error(`RouterOutlet threw rendering '${screen}': ${err && err.stack ? err.stack : err}`);
    }
    assertEqual(dispatched.length, before, `render of '${screen}' is pure (no dispatch)`);
    assert(typeof html === 'string' && html.length > 0, `'${screen}' produced HTML`);
    return html;
  }

  // --- every screen id renders without throwing ---------------------------
  section('home');
  {
    const html = renderScreen('home');
    // Followed-team card / Continue CTA — the followed team's name appears.
    const followed = teamsById[store.getState().ui.followedTeamId];
    assert(followed && html.includes(followed.name), 'home shows the followed team');
  }

  section('calendar');
  {
    const html = renderScreen('calendar');
    assert(html.length > 0, 'calendar renders');
  }

  section('standings — team names + a CP value');
  {
    const html = renderScreen('standings', { eventId: KICKOFF_EVENT_ID });
    // Team names: the playoff teams' names appear.
    const champName = teamsById[event.placements[0].teamId].name;
    assert(html.includes(champName), `standings shows team name '${champName}'`);
    // A CP value: the CP column + the champion's 4 CP.
    assert(html.includes('placements__cp'), 'standings shows a CP column');
    assertEqual(countOf(html, 'placements__rank'), 12, 'standings has 12 placement rows');
  }

  section('bracket — 18 matches');
  {
    const html = renderScreen('bracket', { eventId: KICKOFF_EVENT_ID });
    assertEqual(countOf(html, 'data-match="'), 18, 'bracket renders 18 match cards');
  }

  section('match — ticker cells + box-score rows');
  {
    // Show the full result (the spoiler-free spectator reveal hides the box score
    // until a map is watched out; that path is covered in screen-spectator.test.mjs).
    store.dispatch(setSpoilerFree(false));
    // Use the command path so ticker + route params are real, then render.
    openSeries(store, series.id);
    const html = toHtml(RouterOutlet(store.getState(), dispatch, store));
    const map0 = series.maps[0];
    const total = (map0.score.A || 0) + (map0.score.B || 0);
    const cells =
      countOf(html, 'ticker__cell--teamA') + countOf(html, 'ticker__cell--teamB');
    assertEqual(cells, total, 'match round-ticker has score.A+score.B cells');
    const rows = countOf(html, 'class="boxscore__row');
    assertEqual(rows, Object.keys(map0.boxScore).length, 'match has one box-score row per player');
  }

  section('team');
  {
    const html = renderScreen('team', { teamId, eventId: event.eventId });
    assert(html.includes(team.name), 'team screen shows the team name');
    assert(html.includes('team__record'), 'team screen shows a record block');
  }

  section('player — <svg> radar');
  {
    const html = renderScreen('player', { playerId, eventId: event.eventId });
    assert(html.includes('<svg'), 'player screen renders an <svg> radar');
    assert(html.includes('class="radar"'), 'radar root present');
  }

  section('leaders');
  {
    const html = renderScreen('leaders', { eventId: KICKOFF_EVENT_ID });
    assert(html.includes('class="table leaders"'), 'leaders table present');
  }

  // eslint-disable-next-line no-console
  console.log(
    `ui/smoke: Kickoff = 12 placements / ${event.series.length} series; ` +
      'rendered all 8 screens (home, calendar, standings, bracket, match, team, player, leaders) ' +
      'via RouterOutlet -> toHtml with no throw and all key anchors present.'
  );
}
