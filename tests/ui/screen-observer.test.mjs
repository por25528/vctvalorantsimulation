/**
 * tests/ui/screen-observer.test.mjs — the spectator/observer features:
 * browse ANY league/event's bracket+standings (EventPicker), follow any team or
 * none, god-mode any team, and the autoplay flag. Headless via toHtml + the real
 * store. Default-exported async fn (run.mjs).
 */

import { assert } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason, followTeam } from '../../src/state/commands.js';
import { AppView } from '../../src/ui/app.js';
import { BracketScreen } from '../../src/ui/screens/Bracket.js';
import { StandingsScreen } from '../../src/ui/screens/Standings.js';
import { TeamScreen } from '../../src/ui/screens/Team.js';
import { Editor } from '../../src/ui/screens/Editor.js';
import { navigate, setAutoplay } from '../../src/state/actions.js';
import { uiReducer, initialUiState } from '../../src/state/slices/ui.js';
import { selectTeams, selectPlayedEvents, selectDefaultEventId } from '../../src/state/selectors.js';

function countMatches(html, re) {
  return (html.match(re) || []).length;
}

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const st = () => store.getState();

  assert(selectPlayedEvents(st()).length === 0, 'no played events before any Continue');
  assert(selectDefaultEventId(st()) === null, 'no default event before any Continue');

  // The top-bar follow dropdown lists teams (region-grouped) + a spectate option.
  const shell = toHtml(AppView(st(), store.dispatch, store));
  assert(shell.includes('topbar__follow-select'), 'top bar has the follow dropdown');
  assert(shell.includes('Spectating (no team)'), 'follow dropdown offers a spectate option');
  assert((shell.match(/<optgroup/g) || []).length === 4, 'follow dropdown groups teams by the 4 regions');

  // Play the Kickoff (4 regions) + Masters One (international Swiss + double-elim).
  continueSeason(store, { simEvent: true });
  continueSeason(store, { simEvent: true });

  const played = selectPlayedEvents(st());
  assert(played.length === 5, `5 played events after Kickoff + Masters One (got ${played.length})`);
  assert(played.some((e) => e.eventId === 'kickoff-emea'), 'EMEA Kickoff is a played event');
  assert(played.some((e) => e.eventId === 'm0' && !e.region), 'Masters One is an international played event');

  /* ---- view ANY league's bracket ---- */
  store.dispatch(navigate('bracket', { eventId: 'kickoff-china' }));
  const bChina = toHtml(BracketScreen(st(), store.dispatch, store));
  assert(bChina.includes('>Upper<') && bChina.includes('>Lower<'), 'China Kickoff renders the triple-elim');
  assert(bChina.includes('picker__tab'), 'bracket shows the event picker');
  assert(bChina.includes('China'), 'bracket subtitle names the region');

  store.dispatch(navigate('bracket', { eventId: 'm0' }));
  const bM0 = toHtml(BracketScreen(st(), store.dispatch, store));
  assert(bM0.includes('>Winners<') && bM0.includes('>Losers<'), 'Masters renders the double-elim');
  assert(countMatches(bM0, /data-match=/g) === 14, 'Masters double-elim has 14 match cards');

  /* ---- view ANY event's standings ---- */
  store.dispatch(navigate('standings', { eventId: 'm0' }));
  const sM0 = toHtml(StandingsScreen(st(), store.dispatch));
  assert(sM0.includes('>Swiss<'), 'Masters standings show the Swiss group');
  assert(sM0.includes('class="table placements"'), 'Masters standings show final placements');

  store.dispatch(navigate('standings', { eventId: 'kickoff-emea' }));
  const sEmea = toHtml(StandingsScreen(st(), store.dispatch));
  assert(sEmea.includes('Group A') && sEmea.includes('Group B'), 'EMEA Kickoff standings show Group A/B');

  /* ---- clearer bracket: round groups + format legend ---- */
  store.dispatch(navigate('bracket', { eventId: 'kickoff-pacific' }));
  const bPac = toHtml(BracketScreen(st(), store.dispatch, store));
  assert(bPac.includes('bracket__round-label'), 'bracket groups matches into labeled rounds');
  assert(bPac.includes('bracket__legend') && bPac.includes('Triple-elimination'), 'bracket shows a format legend');

  /* ---- clearer standings: qualification cut-line ---- */
  store.dispatch(navigate('standings', { eventId: 'kickoff-pacific' }));
  const sPac = toHtml(StandingsScreen(st(), store.dispatch));
  assert(sPac.includes('Top 4 advance'), 'standings mark the qualification cut-line');
  assert(sPac.includes('standings__row--adv'), 'advancing rows are flagged');

  /* ---- team trophy cabinet ---- */
  const champ = st().events.byId['kickoff-pacific'].placements.find((p) => p.rank === 1).teamId;
  store.dispatch(navigate('team', { teamId: champ }));
  const tHtml = toHtml(TeamScreen(st(), store.dispatch, store));
  assert(tHtml.includes('team__cabinet'), 'a regional champion shows a trophy cabinet');
  assert(tHtml.includes('Trophy Cabinet'), 'trophy cabinet is labeled');
  assert(tHtml.includes('team__series-group'), 'team results are grouped by event');

  /* ---- follow any team / spectate none ---- */
  const teams = selectTeams(st());
  const amerId = st().world.leagues.americas.teamIds[0];
  followTeam(store, amerId);
  assert(st().ui.followedTeamId === amerId, 'followTeam follows any team (an Americas side)');
  followTeam(store, null);
  assert(st().ui.followedTeamId === null, 'followTeam(null) spectates with no team');

  /* ---- god mode on ANY team ---- */
  const target = teams[30];
  store.dispatch(navigate('editor', { teamId: target.id }));
  const ed = toHtml(Editor(st(), store.dispatch, store));
  assert(ed.includes('editor__teamselect'), 'God Mode has a team selector');
  assert(ed.includes(target.name), 'God Mode edits the chosen (non-followed) team');

  /* ---- autoplay flag ---- */
  let ui = uiReducer(initialUiState, setAutoplay(true));
  assert(ui.autoplay === true, 'setAutoplay(true) sets the flag');
  ui = uiReducer(ui, setAutoplay(false));
  assert(ui.autoplay === false, 'setAutoplay(false) clears the flag');

  /* ---- autoplay advance (noNav) keeps the viewer on their screen ---- */
  store.dispatch(navigate('bracket', { eventId: 'kickoff-pacific' }));
  const routeBefore = st().ui.route.screen;
  const revealBefore = st().reveal.slotId + ':' + st().reveal.dayIndex;
  continueSeason(store, { noNav: true });
  assert(st().ui.route.screen === routeBefore, 'noNav advance does not navigate the viewer away');
  assert(st().reveal.slotId + ':' + st().reveal.dayIndex !== revealBefore, 'noNav advance still advances the reveal');
}
