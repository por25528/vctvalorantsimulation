/**
 * tests/ui/screen-cp-champions.test.mjs — CP + CHAMPIONS screens
 * (CONTRACTS-PERSIST §6, ids 'cp' and 'champions').
 *
 * Headless integration: build the real root store, bootstrap fresh, then loop
 * continueSeason until the season is complete (the whole 20-event cycle). Render
 * both screens to HTML strings via `toHtml` (no DOM) and assert:
 *   - CPStandingsScreen: a populated, CP-ordered (desc) table; the region filter
 *     bar; the followed team and a real champion-tier CP total appear; the CP
 *     column is non-increasing top-to-bottom.
 *   - ChampionsScreen: the 16-team seeded field (#1..#16, direct slot marked),
 *     the crowned World Champion banner naming the season champion, and the
 *     played double-elim bracket with match cards.
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import {
  selectSeason,
  selectCPStandings,
  selectChampionsField,
  selectChampion,
  selectTeam,
  selectFollowedTeam
} from '../../src/state/selectors.js';
import { CPStandingsScreen, id as cpId } from '../../src/ui/screens/CPStandings.js';
import { ChampionsScreen, id as champId } from '../../src/ui/screens/Champions.js';

export default async function screenCpChampionsTest() {
  section('ui/screen-cp-champions — CP + Champions over a full season');

  // Screen ids are the route keys.
  assertEqual(cpId, 'cp', "CPStandingsScreen exports id 'cp'");
  assertEqual(champId, 'champions', "ChampionsScreen exports id 'champions'");

  const store = buildStore();
  await bootstrap(store, { fresh: true });

  // --- pre-season: both screens render an empty state without throwing -----
  {
    const cpHtml = toHtml(CPStandingsScreen(store.getState(), store.dispatch));
    assert(cpHtml.includes('Championship Points'), 'pre-season CP has a title');
    assert(
      cpHtml.includes('screen__empty'),
      'pre-season CP shows the empty state (no CP awarded yet)'
    );

    const champHtml = toHtml(ChampionsScreen(store.getState(), store.dispatch));
    assert(champHtml.includes('Champions'), 'pre-season Champions has a title');
    assert(
      !champHtml.includes('champions__seed-list'),
      'pre-season Champions shows no field yet'
    );
  }

  // --- play the whole season -----------------------------------------------
  let guard = 0;
  while (!selectSeason(store.getState()).complete) {
    continueSeason(store, { simEvent: true });
    if (++guard > 50) throw new Error('season did not complete within 50 steps');
  }
  const state = store.getState();
  assert(selectSeason(state).complete, 'season completed');

  // ====================== CP STANDINGS SCREEN ==============================
  const standings = selectCPStandings(state);
  assert(standings.length > 0, 'CP standings populated after a full season');

  const cpVnode = CPStandingsScreen(state, store.dispatch);
  const cpHtml = toHtml(cpVnode);

  // Title + the region filter bar.
  assert(cpHtml.includes('Championship Points'), 'CP screen titled');
  assert(cpHtml.includes('cp__filters'), 'CP screen has a region filter bar');
  for (const label of ['>All<', '>Pacific<', '>Americas<', '>EMEA<', '>China<']) {
    assert(cpHtml.includes(label), `CP filter chip ${label} present`);
  }

  // Table populated: a row per team in the standings (all teams that earned CP).
  const cpRowCount = (cpHtml.match(/table__row--clickable/g) || []).length;
  assertEqual(
    cpRowCount,
    standings.length,
    `CP table has one row per team (got ${cpRowCount}, expected ${standings.length})`
  );

  // Top team (by CP) appears with its tag + CP total.
  const top = standings[0];
  const topTeam = selectTeam(state, top.teamId);
  assert(
    cpHtml.includes(`>${topTeam.tag}<`),
    `CP leader tag '${topTeam.tag}' appears`
  );
  assert(cpHtml.includes(`>${String(top.cp)}<`), `CP leader total ${top.cp} appears`);

  // The followed team is emphasized.
  const followed = selectFollowedTeam(state);
  assert(
    cpHtml.includes('table__row--me'),
    'followed team row emphasized in the CP table'
  );

  // CP is ordered DESCENDING: walk the rendered rows' rank order against the
  // selector order (which is desc), and assert CP totals are non-increasing.
  for (let i = 1; i < standings.length; i++) {
    assert(
      standings[i - 1].cp >= standings[i].cp,
      `CP standings are non-increasing (row ${i - 1} >= row ${i})`
    );
  }
  // First rendered data row must be the CP leader (desc order in the DOM).
  const firstRowTeam = firstTableRowTeam(cpHtml);
  assert(
    firstRowTeam === topTeam.tag || cpHtml.indexOf(`>${topTeam.tag}<`) <
      cpHtml.indexOf(`>${selectTeam(state, standings[standings.length - 1].teamId).tag}<`),
    'CP leader is rendered before the CP tail (desc order in the table)'
  );

  // Region filter actually narrows: clicking 'pacific' renders only pacific
  // teams (<= the all-region count, and > 0 since every league earns CP).
  {
    const cap = [];
    const dispatch = (a) => cap.push(a);
    // Simulate the user picking the Pacific filter via the chip handler. Re-render
    // with the capturing dispatch so the chip's onClick closes over it.
    const capVnode = CPStandingsScreen(state, dispatch);
    const pacHandler = findFilterHandler(capVnode, 'pacific');
    assert(typeof pacHandler === 'function', 'Pacific filter chip has a handler');
    pacHandler();
    assert(
      cap.length >= 1 && cap[0].params && cap[0].params.region === 'pacific',
      'Pacific chip navigates with region=pacific'
    );
    // Render the screen in the pacific-filtered route and count rows.
    const pacState = withRoute(state, 'cp', { region: 'pacific', sortDir: 'desc' });
    const pacHtml = toHtml(CPStandingsScreen(pacState, dispatch));
    const pacRows = (pacHtml.match(/table__row--clickable/g) || []).length;
    assert(pacRows > 0, 'Pacific filter shows at least one team');
    assert(pacRows <= cpRowCount, 'Pacific filter shows no more rows than All');
    assert(pacRows < cpRowCount, 'Pacific filter narrows the table below All');
  }

  // ======================= CHAMPIONS SCREEN ===============================
  const field = selectChampionsField(state);
  assert(Array.isArray(field), 'Champions field resolved after the season');
  assertEqual(field.length, 16, 'Champions field has exactly 16 teams');

  const champion = selectChampion(state);
  assert(champion != null, 'a World Champion was crowned');
  const champTeam = selectTeam(state, champion);

  const champVnode = ChampionsScreen(state, store.dispatch);
  const champHtml = toHtml(champVnode);

  // The 16-team seeded list: a <li> per seed, #1..#16, direct slot marked.
  const seedCount = (champHtml.match(/champions__seed-no/g) || []).length;
  assertEqual(seedCount, 16, `Champions field renders 16 seed rows (got ${seedCount})`);
  assert(champHtml.includes('#1'), 'seed #1 present');
  assert(champHtml.includes('#16'), 'seed #16 present');
  assert(
    champHtml.includes('champions__seed--direct'),
    'the direct (Masters-winner) slot is marked'
  );
  assert(
    champHtml.includes('Masters Winner'),
    'the direct slot is labeled as the Masters winner'
  );

  // Every field team's tag appears in the field list.
  for (const teamId of field) {
    const t = selectTeam(state, teamId);
    assert(
      champHtml.includes(`>${t.tag}<`),
      `field team tag '${t.tag}' appears`
    );
  }

  // The crowned World Champion banner names the champion.
  assert(champHtml.includes('champions__banner'), 'World Champion banner rendered');
  assert(champHtml.includes('World Champion'), 'banner labeled "World Champion"');
  assert(
    champHtml.includes(`data-champion="${champion}"`),
    'banner tagged with the champion id'
  );
  assert(
    champHtml.includes(`>${champTeam.name}<`) || champHtml.includes(champTeam.name),
    `banner names the champion '${champTeam.name}'`
  );

  // The played double-elim bracket renders match cards.
  const matchCards = (champHtml.match(/data-match="/g) || []).length;
  assert(matchCards > 0, `Champions bracket renders match cards (got ${matchCards})`);
  assert(
    champHtml.includes('bracket__match--won'),
    'a winning side is emphasized in the Champions bracket'
  );

  // eslint-disable-next-line no-console
  console.log(
    `ui/screen-cp-champions: CP table ${cpRowCount} rows (desc), leader ${topTeam.tag} ` +
      `with ${top.cp} CP; Champions field 16 teams, champion ${champTeam.name}, ` +
      `${matchCards} bracket cards. OK.`
  );
}

/* --------------------------------------------------------------------- */
/* helpers                                                                */
/* --------------------------------------------------------------------- */

/** Shallow-clone state with a different ui.route (screen + params). */
function withRoute(state, screen, params) {
  return { ...state, ui: { ...state.ui, route: { screen, params } } };
}

/** Extract the team tag rendered in the first clickable table row (rough). */
function firstTableRowTeam(html) {
  const rowIdx = html.indexOf('table__row--clickable');
  if (rowIdx === -1) return null;
  const seg = html.slice(rowIdx);
  const m = seg.match(/class="badge badge--seed">([^<]+)</);
  return m ? m[1] : null;
}

/**
 * Walk a VNode tree to find the onClick handler of the CP region filter chip
 * whose `data-region` equals `region`. Component tags are resolved by invoking.
 * @param {*} vnode
 * @param {string} region
 * @returns {Function|null}
 */
function findFilterHandler(vnode, region) {
  if (vnode == null || typeof vnode !== 'object') return null;
  let node = vnode;
  while (node && typeof node.tag === 'function') {
    node = node.tag({ ...node.props, children: node.children });
  }
  if (node == null || typeof node !== 'object') return null;
  const props = node.props || {};
  if (props['data-region'] === region && typeof props.onClick === 'function') {
    return props.onClick;
  }
  for (const child of node.children || []) {
    const found = findFilterHandler(child, region);
    if (found) return found;
  }
  return null;
}
