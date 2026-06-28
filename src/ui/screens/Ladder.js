/**
 * ui/screens/Ladder.js — the ranked LADDER screen (id 'ladder').
 *
 * A BARE proof-of-data view over the huge deterministic ranked ladder beneath the
 * pro scene (`selectLadder`, PAGED) plus the global pro player ranking
 * (`selectGlobalRankings`). The polished screens are the UI half's (r10) job —
 * this exists to prove the r9 selector contract returns real, paged data and to
 * give the nav a destination. Pure `(state, dispatch) => VNode`; all filtering /
 * paging lives in route params so the screen stays pure and re-render-safe.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { DataTable } from '../components/DataTable.js';
import { selectRoute, selectLadder, selectGlobalRankings, rankTierOrder } from '../../state/selectors.js';
import { REGION_LABELS, REGION_ORDER } from '../eventFormats.js';

/** Screen id (route key). */
export const id = 'ladder';

const PAGE_SIZE = 50;
const REGION_FILTERS = ['all', ...REGION_ORDER];
const TIER_FILTERS = ['all', ...rankTierOrder().slice().reverse()]; // Radiant first
const REGION_FILTER_LABELS = Object.freeze({ all: 'All regions', ...REGION_LABELS });

/**
 * The ranked-ladder screen.
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @returns {*} VNode
 */
export function LadderScreen(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const region = REGION_FILTERS.includes(params.region) ? params.region : 'all';
  const tier = TIER_FILTERS.includes(params.tier) ? params.tier : 'all';
  const page = Math.max(0, Math.floor(Number(params.page) || 0));

  const { total, rows } = selectLadder(state, {
    region: region === 'all' ? undefined : region,
    tier: tier === 'all' ? undefined : tier,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE
  });

  if (!total) {
    return h(
      'section',
      { class: 'screen screen--ladder', 'data-screen': 'ladder' },
      h('h1', { class: 'screen__title' }, 'Ranked Ladder'),
      h('p', { class: 'screen__empty' }, 'The ladder builds once a career is underway.')
    );
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const go = (next) => dispatch(navigate('ladder', { region, tier, page: String(next) }));

  const columns = [
    { key: 'rank', label: '#', numeric: true, render: (r) => `#${r.rank}` },
    { key: 'handle', label: 'Player', render: (r) => h('span', { class: 'ladder__handle' }, r.handle) },
    { key: 'tier', label: 'Tier', render: (r) => h('span', { class: 'badge badge--seed' }, `${r.tier} ${r.rr}RR`) },
    { key: 'region', label: 'Region', render: (r) => REGION_LABELS[r.region] || r.region },
    { key: 'rating', label: 'Skill', numeric: true, render: (r) => String(r.rating) }
  ];

  return h(
    'section',
    { class: 'screen screen--ladder', 'data-screen': 'ladder' },
    h('h1', { class: 'screen__title' }, 'Ranked Ladder'),
    h(
      'p',
      { class: 'screen__subtitle' },
      `A global ranked ladder of ${total.toLocaleString()} players beneath the pro scene — Iron to Radiant, by skill. The strongest climbers earn pro tryouts each off-season.`
    ),
    chipBar('region', REGION_FILTERS, region, (v) => REGION_FILTER_LABELS[v] || v, (v) => dispatch(navigate('ladder', { region: v, tier, page: '0' }))),
    chipBar('tier', TIER_FILTERS, tier, (v) => (v === 'all' ? 'All tiers' : v), (v) => dispatch(navigate('ladder', { region, tier: v, page: '0' }))),
    DataTable({ columns, rows, rowKey: (r) => r.id, class: 'ladder' }),
    pager(page, pages, go),
    globalPlayersTeaser(state, dispatch)
  );
}

/** A small global-pro-ranking teaser so the rankings selector is exercised too. */
function globalPlayersTeaser(state, dispatch) {
  const top = selectGlobalRankings(state, { scope: 'players' }).slice(0, 10);
  if (!top.length) return null;
  const arrow = (d) => (d > 0 ? `▲${d}` : d < 0 ? `▼${Math.abs(d)}` : '—');
  const columns = [
    { key: 'rank', label: '#', numeric: true, render: (r) => `#${r.rank}` },
    { key: 'name', label: 'Pro', render: (r) => r.name },
    { key: 'region', label: 'Region', render: (r) => (r.region ? REGION_LABELS[r.region] || r.region : '') },
    { key: 'rating', label: 'Rating', numeric: true, render: (r) => String(r.rating) },
    { key: 'delta', label: '+/-', numeric: true, render: (r) => arrow(r.deltaRank) }
  ];
  return h(
    'div',
    { class: 'ladder__pro' },
    h('h2', { class: 'panel__title' }, 'Global Pro Ranking — Top 10'),
    DataTable({
      columns,
      rows: top,
      rowKey: (r) => r.id,
      onRow: (r) => dispatch(navigate('player', { playerId: r.id })),
      class: 'ladder-pro'
    })
  );
}

/** A chip filter bar. */
function chipBar(name, values, active, label, onPick) {
  return h(
    'div',
    { class: 'cp__filters', role: 'tablist' },
    values.map((v) =>
      h(
        'button',
        {
          key: `${name}-${v}`,
          type: 'button',
          class: classNames('cp__filter', v === active && 'cp__filter--active'),
          'aria-selected': v === active ? 'true' : 'false',
          onClick: () => onPick(v)
        },
        label(v)
      )
    )
  );
}

/** Prev / next pager. */
function pager(page, pages, go) {
  return h(
    'div',
    { class: 'ladder__pager' },
    h('button', { type: 'button', class: 'btn', disabled: page <= 0, onClick: () => go(page - 1) }, '‹ Prev'),
    h('span', { class: 'ladder__pageinfo' }, `Page ${page + 1} / ${pages}`),
    h('button', { type: 'button', class: 'btn', disabled: page >= pages - 1, onClick: () => go(page + 1) }, 'Next ›')
  );
}
