/**
 * ui/screens/Ladder.js — the ranked LADDER browser (id 'ladder').
 *
 * Browse the huge competitive ladder (several thousand ranked players). Because
 * the list is "Large", it is ALWAYS paged through r9's `selectLadder` —
 * offset/limit — so the screen never holds more than one page (`PAGE_SIZE`) of
 * rows in memory at once. Filters by rank-tier and region; every row shows its
 * rank-tier badge and clicks through to the player page.
 *
 * Screen-local state (tier filter, region filter, page offset) lives in route
 * params so the screen stays pure and re-render-safe.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { Icon } from '../components/Icon.js';
import { DataTable } from '../components/DataTable.js';
import { RankBadge } from '../components/RankBadge.js';
import { selectRoute } from '../../state/selectors.js';
import { selectLadder } from '../rankSelectors.js';
import { RANK_TIERS } from '../rankTier.js';
import { REGION_LABELS, REGION_ORDER } from '../eventFormats.js';

/** Screen id (route key). */
export const id = 'ladder';

/** Rows per page — the cap on rendered ladder rows (memory-bound machine). */
export const PAGE_SIZE = 50;

const REGION_FILTERS = ['all', ...REGION_ORDER];
const REGION_FILTER_LABELS = Object.freeze({ all: 'All Regions', ...REGION_LABELS });

// Tier filter chips: highest first (Radiant → Iron) so the elite bands read top-left.
const TIER_FILTERS = ['all', ...RANK_TIERS.map((t) => t.key).reverse()];
const TIER_FILTER_LABELS = Object.freeze(
  RANK_TIERS.reduce((acc, t) => {
    acc[t.key] = t.label;
    return acc;
  }, { all: 'All Tiers' })
);

/** Parse a non-negative integer route param (NaN/negatives → 0). */
function intParam(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The Ladder browser screen.
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
export function LadderScreen(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const tier = TIER_FILTERS.includes(params.tier) ? params.tier : 'all';
  const region = REGION_FILTERS.includes(params.region) ? params.region : 'all';
  const offset = intParam(params.offset);

  const { total, rows } = selectLadder(state, {
    tier: tier === 'all' ? null : tier,
    region: region === 'all' ? null : region,
    offset,
    limit: PAGE_SIZE
  });

  const go = (next) =>
    dispatch(navigate('ladder', { tier, region, offset: String(Math.max(0, next)) }));

  const header = h(
    'header',
    { class: 'screen__head' },
    h('h1', { class: 'screen__title' }, 'Ranked Ladder'),
    h(
      'p',
      { class: 'screen__subtitle' },
      'Every ranked competitor, paged from the top of the ladder down. Filter by tier or region to find a band.'
    ),
    h(
      'div',
      { class: 'ladder__filters' },
      filterBar('Tier', TIER_FILTERS, TIER_FILTER_LABELS, tier, (v) =>
        dispatch(navigate('ladder', { tier: v, region, offset: '0' }))
      ),
      filterBar('Region', REGION_FILTERS, REGION_FILTER_LABELS, region, (v) =>
        dispatch(navigate('ladder', { tier, region: v, offset: '0' }))
      )
    )
  );

  if (!total) {
    return h(
      'section',
      { class: 'screen screen--ladder', 'data-screen': 'ladder' },
      header,
      h('p', { class: 'screen__empty muted' }, 'No players match these filters.')
    );
  }

  const columns = [
    { key: 'rank', label: '#', numeric: true, render: (r) => `#${r.rank}` },
    {
      key: 'handle',
      label: 'Player',
      render: (r) => h('span', { class: 'ladder__handle' }, r.handle)
    },
    { key: 'tier', label: 'Tier', render: (r) => RankBadge({ tier: r.tier, rr: r.rr, showRr: r.rr != null }) },
    { key: 'region', label: 'Region', render: (r) => (r.region ? REGION_LABELS[r.region] || r.region : '—') },
    { key: 'rating', label: 'Rating', numeric: true, render: (r) => h('span', { class: 'ladder__rating' }, String(r.rating)) }
  ];

  return h(
    'section',
    { class: 'screen screen--ladder', 'data-screen': 'ladder' },
    header,
    DataTable({
      columns,
      rows,
      onRow: (r) => dispatch(navigate('player', { playerId: r.id })),
      rowKey: (r) => r.id,
      class: 'ladder'
    }),
    pager(offset, rows.length, total, go)
  );
}

/**
 * The pager: Prev / Next + a "X–Y of TOTAL" window readout. Prev/Next are
 * disabled at the ends. Pure — buttons dispatch a navigate with the new offset.
 */
function pager(offset, pageCount, total, go) {
  const start = total === 0 ? 0 : offset + 1;
  const end = offset + pageCount;
  const atStart = offset <= 0;
  const atEnd = end >= total;

  return h(
    'div',
    { class: 'ladder__pager', role: 'navigation', 'aria-label': 'Ladder pages' },
    h(
      'button',
      {
        type: 'button',
        class: 'ladder__page-btn',
        disabled: atStart || undefined,
        'aria-disabled': atStart ? 'true' : 'false',
        onClick: atStart ? undefined : () => go(offset - PAGE_SIZE)
      },
      Icon('arrow-up', { size: 14, class: 'ladder__page-icon ladder__page-icon--prev' }),
      ' Prev'
    ),
    h(
      'span',
      { class: 'ladder__range' },
      h('span', { class: 'ladder__range-window' }, `${start.toLocaleString()}–${end.toLocaleString()}`),
      ' of ',
      h('span', { class: 'ladder__range-total' }, total.toLocaleString())
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'ladder__page-btn',
        disabled: atEnd || undefined,
        'aria-disabled': atEnd ? 'true' : 'false',
        onClick: atEnd ? undefined : () => go(offset + PAGE_SIZE)
      },
      'Next ',
      Icon('arrow-down', { size: 14, class: 'ladder__page-icon ladder__page-icon--next' })
    )
  );
}

/** A labelled filter chip bar. */
function filterBar(label, keys, labels, active, onPick) {
  return h(
    'div',
    { class: 'ladder__filter-group' },
    h('span', { class: 'ladder__filter-label' }, label),
    h(
      'div',
      { class: 'cp__filters', role: 'tablist', 'aria-label': label },
      keys.map((k) =>
        h(
          'button',
          {
            key: k,
            type: 'button',
            class: classNames('cp__filter', k === active && 'cp__filter--active'),
            'aria-selected': k === active ? 'true' : 'false',
            onClick: () => onPick(k)
          },
          labels[k] || k
        )
      )
    )
  );
}
