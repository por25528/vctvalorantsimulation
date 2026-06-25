/**
 * ui/screens/Tier2.js — Challengers (Tier-2) standings + promotion race screen
 * (id 'tier2').
 *
 * Read-only surfacing of the existing T2 engine output. Shows each region's
 * season-long CP standings (derived from `season.state.tier2.ledger`) and marks
 * the top PROMOTE_PER_REGION positions as "Promotion Zone" — those are the clubs
 * whose best eligible players (OVR >= PROMOTE_OVERALL_MIN or POT >=
 * PROMOTE_POTENTIAL_MIN) will be promoted into the T1 free-agent pool during the
 * next off-season, exactly as `tier2Offseason.js` decides.
 *
 * Pure `(state, dispatch) => VNode`. DOM-free, headless-serializable via toHtml.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { DataTable } from '../components/DataTable.js';
import { selectRoute, selectT2Standings } from '../../state/selectors.js';
import { BALANCE } from '../../config/balance.js';
import { TIER2_REGION_ORDER } from '../../data/seed/tier2.js';

export const id = 'tier2';

const T2 = BALANCE.CAREER.TIER2;
const PROMOTE_PER_REGION = T2.PROMOTE_PER_REGION;

const REGION_LABELS = Object.freeze({
  all: 'All',
  pacific: 'Pacific',
  americas: 'Americas',
  emea: 'EMEA',
  china: 'China'
});

const REGION_FILTERS = ['all', ...TIER2_REGION_ORDER];

/**
 * The Challengers standings screen.
 * @param {object} state  the full store state
 * @param {(action:object)=>void} dispatch
 * @returns {*} VNode
 */
export function Tier2Screen(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const region = REGION_FILTERS.includes(params.region) ? params.region : 'all';

  const { hasData, byRegion } = selectT2Standings(state);

  if (!hasData) {
    return h(
      'section',
      { class: 'screen screen--tier2', 'data-screen': 'tier2' },
      h('h1', { class: 'screen__title' }, 'Challengers'),
      h(
        'p',
        { class: 'screen__empty' },
        'The Challengers season has not started yet. Hit Continue to begin.'
      )
    );
  }

  const regionsToShow = region === 'all' ? TIER2_REGION_ORDER : [region];

  return h(
    'section',
    { class: 'screen screen--tier2', 'data-screen': 'tier2' },
    h('h1', { class: 'screen__title' }, 'Challengers'),
    h(
      'p',
      { class: 'screen__subtitle' },
      `Season-long CP standings — after each season, the top ${PROMOTE_PER_REGION} eligible ` +
        'players per region (OVR ≥ ' + T2.PROMOTE_OVERALL_MIN +
        ' or POT ≥ ' + T2.PROMOTE_POTENTIAL_MIN + ') advance to Tier 1.'
    ),
    h(
      'div',
      { class: 't2__toolbar row row--wrap' },
      regionFilterBar(region, dispatch)
    ),
    regionsToShow.map((r) => regionSection(r, byRegion[r] || [], dispatch))
  );
}

/** Region filter chip bar. Each chip re-navigates preserving nothing else. */
function regionFilterBar(active, dispatch) {
  return h(
    'div',
    { class: 't2__filters', role: 'tablist' },
    REGION_FILTERS.map((r) =>
      h(
        'button',
        {
          key: r,
          type: 'button',
          class: classNames('t2__filter', r === active && 't2__filter--active'),
          'data-region': r,
          'aria-selected': r === active ? 'true' : 'false',
          onClick: () => dispatch(navigate('tier2', { region: r }))
        },
        REGION_LABELS[r] || r
      )
    )
  );
}

/** One region's standings table, with promotion-zone markers on the top rows. */
function regionSection(region, rows, _dispatch) {
  const columns = [
    {
      key: 'rank',
      label: '#',
      numeric: true,
      render: (row) => String(row.rank)
    },
    {
      key: 'zone',
      label: '',
      render: (row) =>
        row.rank <= PROMOTE_PER_REGION
          ? h('span', { class: 'badge t2__promo-badge', title: 'Promotion zone' }, '↑ Promo')
          : null
    },
    {
      key: 'team',
      label: 'Team',
      render: (row) =>
        h(
          'span',
          { class: 't2__team' },
          row.teamTag
            ? h('span', { class: 'badge badge--seed' }, row.teamTag)
            : null,
          ' ',
          row.teamName
        )
    },
    {
      key: 'cp',
      label: 'CP',
      numeric: true,
      render: (row) => String(row.cp)
    }
  ];

  return h(
    'div',
    { class: 't2__region', key: region },
    h('h2', { class: 't2__region-title' }, REGION_LABELS[region] || region),
    DataTable({
      columns,
      rows,
      rowKey: (row) => row.teamId,
      rowClass: (row) =>
        classNames(row.rank <= PROMOTE_PER_REGION && 't2__row--promo') || null,
      class: 't2-standings'
    })
  );
}
