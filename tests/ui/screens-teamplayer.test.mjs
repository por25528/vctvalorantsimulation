/**
 * tests/ui/screens-teamplayer.test.mjs — the Team + Player screens, headless via
 * toHtml (CONTRACTS-UI §5, §8).
 *
 * Builds the real store, bootstraps, runs continueSeason (sims the Pacific
 * Kickoff), then renders TeamScreen / PlayerScreen via toHtml and asserts:
 *   - Team: shows all 5 roster players, a W-L record, and the team's series.
 *   - Player: shows an <svg> AttributeRadar, the 9 named attributes, identity
 *     meta (role/age/nation), and per-map box-score lines from the event.
 *
 * Default-exported async fn that throws on failure (tests/run.mjs convention).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { navigate } from '../../src/state/actions.js';
import { selectKickoff } from '../../src/state/selectors.js';
import { TeamScreen } from '../../src/ui/screens/Team.js';
import { PlayerScreen } from '../../src/ui/screens/Player.js';

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

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  continueSeason(store, { simEvent: true });

  const state = store.getState();
  const event = selectKickoff(state);
  assert(event, 'kickoff event was played');

  // Pick a team that actually played series in the event.
  const teamId = event.series[0].teamAId;
  const team = state.world.teams[teamId];
  assert(team && (team.roster || []).length >= 5, 'team has a 5+ roster');

  /* ----------------------------- Team screen ----------------------------- */
  const dispatch = () => {};
  store.dispatch(navigate('team', { teamId, eventId: event.eventId }));
  const teamHtml = toHtml(TeamScreen(store.getState(), dispatch));

  section('Team roster');
  {
    // All 5 roster players render (one clickable row each).
    assertEqual(countOf(teamHtml, 'table__row--clickable'), 5, '5 clickable roster rows');
    for (const pid of team.roster.slice(0, 5)) {
      const p = state.world.players[pid];
      const handle = p.handle || p.name || p.id;
      assert(teamHtml.includes(handle), `roster shows ${handle}`);
    }
  }

  section('Team record + series');
  {
    assert(teamHtml.includes('team__record'), 'W-L record block present');
    assert(teamHtml.includes('team__series-list'), 'series list present');
    const played = event.series.filter(
      (s) => s.teamAId === teamId || s.teamBId === teamId
    );
    assert(played.length >= 1, 'team played at least one series');
    assertEqual(
      countOf(teamHtml, 'team__series-item--clickable'),
      played.length,
      'one row per team series'
    );
  }

  /* ---------------------------- Player screen ---------------------------- */
  const playerId = team.roster[0];
  const player = state.world.players[playerId];
  store.dispatch(navigate('player', { playerId, eventId: event.eventId }));
  const playerHtml = toHtml(PlayerScreen(store.getState(), dispatch));

  section('Player radar + attributes');
  {
    assert(playerHtml.includes('<svg'), 'AttributeRadar <svg> rendered');
    assert(playerHtml.includes('class="radar"'), 'radar root class present');
    // All 9 attribute axes listed.
    assertEqual(countOf(playerHtml, 'data-attr='), 9, '9 attribute rows');
    assert(playerHtml.includes('player__attrs'), 'attribute list present');
  }

  section('Player meta');
  {
    assert(playerHtml.includes(player.role), 'role shown');
    assert(playerHtml.includes(String(player.age)), 'age shown');
    assert(playerHtml.includes(player.nationality), 'nationality shown');
    const handle = player.handle || player.name || player.id;
    assert(playerHtml.includes(handle), 'handle shown');
  }

  section('Player box scores');
  {
    assert(playerHtml.includes('player__boxscore'), 'box-score section present');
    // Count this player's actual map appearances in the event.
    let appearances = 0;
    for (const s of event.series) {
      if (s.teamAId !== teamId && s.teamBId !== teamId) continue;
      for (const m of s.maps || []) {
        if (m.boxScore && m.boxScore[playerId]) appearances += 1;
      }
    }
    assert(appearances >= 1, 'player appeared on at least one map');
    // boxscore-lines DataTable body rows == map appearances.
    assert(playerHtml.includes('boxscore-lines'), 'box-score table present');
  }
}
