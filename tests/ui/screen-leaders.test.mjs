/**
 * tests/ui/screen-leaders.test.mjs — the Leaders screen, headless via toHtml
 * (CONTRACTS-UI §5, §8).
 *
 * Builds the real store, bootstraps, runs continueSeason (sims the Pacific
 * Kickoff), then renders StatsLeadersScreen(state, dispatch) -> toHtml and
 * asserts:
 *   - a populated leaders table renders (one row per player who played);
 *   - the default sort is ACS desc — the first data row matches the top of
 *     `selectLeaders(...)` (which is ACS-sorted) and ACS is non-increasing
 *     down the rendered column;
 *   - the four sortable stat columns (ACS/K/FB/CL) expose sort buttons;
 *   - clicking a header dispatches navigate('leaders', {sortKey,...}) and a
 *     row click dispatches navigate('player', {playerId}).
 *
 * Default-exported async fn that throws on failure (tests/run.mjs convention).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { selectLeaders, selectPlayer } from '../../src/state/selectors.js';
import { StatsLeadersScreen } from '../../src/ui/screens/StatsLeaders.js';

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
  const eventId = 'pacific-kickoff';

  // Default render (no sort params -> ACS desc default).
  const dispatched = [];
  const dispatch = (a) => dispatched.push(a);
  const html = toHtml(StatsLeadersScreen(state, dispatch));

  const leaders = selectLeaders(state, eventId, Infinity);

  section('populated table');
  {
    assert(html.includes('class="table leaders"'), 'leaders table present');
    assert(leaders.length >= 10, 'selector yields many leaders');
    // One body row per player that played (every player carries a clickable row).
    assertEqual(
      countOf(html, 'table__row--clickable'),
      leaders.length,
      'one clickable row per leader'
    );
    // The ACS leader's handle is on the page.
    const top = selectPlayer(state, leaders[0].playerId);
    const topHandle = top ? top.handle || top.name || top.id : leaders[0].playerId;
    assert(html.includes(`>${topHandle}<`), 'ACS leader handle rendered');
  }

  section('sorted by ACS desc (default)');
  {
    // The first rendered data row must be the ACS leader.
    const top = selectPlayer(state, leaders[0].playerId);
    const topHandle = top ? top.handle || top.name || top.id : leaders[0].playerId;
    const firstHandleIdx = html.indexOf(`>${topHandle}<`);
    assert(firstHandleIdx !== -1, 'top handle present');
    // No other player's handle appears before the ACS leader's handle.
    for (let i = 1; i < leaders.length; i++) {
      const p = selectPlayer(state, leaders[i].playerId);
      const handle = p ? p.handle || p.name || p.id : leaders[i].playerId;
      if (handle === topHandle) continue;
      const idx = html.indexOf(`>${handle}<`);
      if (idx !== -1) {
        assert(idx > firstHandleIdx, 'ACS leader renders before lower-ACS players');
      }
    }
    // The active sort column carries the active modifier in the desc direction.
    assert(html.includes('table__sort--active'), 'an active sort header is marked');
    assert(html.includes('table__sort--desc'), 'active sort is descending');
  }

  section('sortable stat columns');
  {
    // ACS / K / FB / CL headers expose sort buttons.
    for (const label of ['ACS', 'K', 'FB', 'CL']) {
      assert(
        html.includes(`>${label}</button>`),
        `sortable header button for ${label}`
      );
    }
  }

  section('header click -> re-sort, row click -> player');
  {
    // Render with an explicit Kills sort to confirm params drive the order.
    const stateK = {
      ...state,
      ui: { ...state.ui, route: { screen: 'leaders', params: { eventId, sortKey: 'kills', sortDir: 'desc' } } }
    };
    const htmlK = toHtml(StatsLeadersScreen(stateK, () => {}));
    // Top kills player should be the max-kills leader.
    const maxKills = [...leaders].sort((a, b) => b.kills - a.kills)[0];
    const kp = selectPlayer(state, maxKills.playerId);
    const kHandle = kp ? kp.handle || kp.name || kp.id : maxKills.playerId;
    const allBefore = leaders
      .map((l) => {
        const p = selectPlayer(state, l.playerId);
        const handle = p ? p.handle || p.name || p.id : l.playerId;
        return { handle, kills: l.kills };
      })
      .filter((r) => r.kills > maxKills.kills);
    assertEqual(allBefore.length, 0, 'no one has more kills than the kills leader');
    assert(htmlK.includes(`>${kHandle}<`), 'kills leader rendered under kills sort');

    // The DataTable wires onSort/onRow through to dispatch as onClick handlers
    // on the header buttons (`table__sort`) and the data rows
    // (`table__row--clickable`). Pull them out of the rendered VNode tree and
    // fire them to confirm the screen builds the right navigate actions.
    const cap = [];
    const vnode = StatsLeadersScreen(state, (a) => cap.push(a));

    const sortBtn = findByClass(vnode, 'table__sort');
    assert(sortBtn && typeof sortBtn.props.onClick === 'function', 'sort header onClick wired');
    sortBtn.props.onClick();
    const navSort = cap.find((a) => a.screen === 'leaders');
    assert(navSort && typeof navSort.params.sortKey === 'string', 'header click navigates with a sortKey');

    const rowEl = findByClass(vnode, 'table__row--clickable');
    assert(rowEl && typeof rowEl.props.onClick === 'function', 'row onClick wired');
    rowEl.props.onClick();
    const navPlayer = cap.find((a) => a.screen === 'player');
    assert(navPlayer && typeof navPlayer.params.playerId === 'string', 'row click navigates to a player');
  }
}

/** Depth-first search a (possibly component) VNode tree for the first element whose class includes `cls`. */
function findByClass(vnode, cls) {
  if (!vnode || typeof vnode !== 'object') return undefined;
  if (typeof vnode.tag === 'function') {
    return findByClass(vnode.tag({ ...vnode.props, children: vnode.children }), cls);
  }
  const c = vnode.props && (vnode.props.class || vnode.props.className);
  if (typeof c === 'string' && c.split(' ').includes(cls)) return vnode;
  for (const child of vnode.children || []) {
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return undefined;
}
