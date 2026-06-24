/**
 * ui/screens/Rankings.js — the world RANKINGS screen (id 'rankings').
 *
 * A cross-region team power ranking (Elo, seeded from roster strength and moved
 * by every revealed series) — an HLTV/VLR-style world ranking. Pure
 * `(state, dispatch) => VNode`: reads `selectTeamRatings`, filters by region
 * (held in route params so the screen stays pure), and renders the sortable
 * DataTable. Row clicks open the team page.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { DataTable } from '../components/DataTable.js';
import { selectRoute, selectTeamRatings, selectTeam, selectFollowedTeam } from '../../state/selectors.js';
import { REGION_LABELS, REGION_ORDER } from '../eventFormats.js';

/** Screen id (route key). */
export const id = 'rankings';

const FILTERS = ['all', ...REGION_ORDER];
const FILTER_LABELS = Object.freeze({ all: 'All', ...REGION_LABELS });

/**
 * The world rankings screen.
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @returns {*} VNode
 */
export function RankingsScreen(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const region = FILTERS.includes(params.region) ? params.region : 'all';

  const all = selectTeamRatings(state);
  const followed = selectFollowedTeam(state);
  const followedId = followed ? followed.id : null;

  if (!all.length) {
    return h(
      'section',
      { class: 'screen screen--rankings', 'data-screen': 'rankings' },
      h('h1', { class: 'screen__title' }, 'World Ranking'),
      h('p', { class: 'screen__empty' }, 'No teams loaded yet.')
    );
  }

  const rows = all
    .filter((r) => region === 'all' || r.region === region)
    .map((r) => {
      const team = selectTeam(state, r.teamId);
      return {
        ...r,
        teamName: team ? team.name : r.teamId,
        teamTag: team ? team.tag : null
      };
    });

  const onRow = (row) => dispatch(navigate('team', { teamId: row.teamId }));

  const columns = [
    { key: 'rank', label: '#', numeric: true, render: (row) => `#${row.rank}` },
    {
      key: 'team',
      label: 'Team',
      render: (row) =>
        h(
          'span',
          { class: 'rankings__team' },
          row.teamTag ? h('span', { class: 'badge badge--seed' }, row.teamTag) : null,
          ' ',
          row.teamName
        )
    },
    { key: 'region', label: 'Region', render: (row) => (row.region ? REGION_LABELS[row.region] || row.region : '') },
    { key: 'rating', label: 'Rating', numeric: true, render: (row) => h('span', { class: 'rankings__rating' }, String(row.rating)) },
    { key: 'wl', label: 'W-L', numeric: true, render: (row) => `${row.w}-${row.l}` }
  ];

  return h(
    'section',
    { class: 'screen screen--rankings', 'data-screen': 'rankings' },
    h('h1', { class: 'screen__title' }, 'World Ranking'),
    h(
      'p',
      { class: 'screen__subtitle' },
      'A cross-region Elo power ranking — seeded from roster strength, then moved by every series result. International events let regions trade places.'
    ),
    filterBar(region, dispatch),
    DataTable({
      columns,
      rows,
      onRow,
      rowKey: (row) => row.teamId,
      rowClass: (row) => (row.teamId === followedId ? 'table__row--me' : null),
      class: 'rankings'
    })
  );
}

/** Region filter chip bar. */
function filterBar(active, dispatch) {
  return h(
    'div',
    { class: 'cp__filters', role: 'tablist' },
    FILTERS.map((r) =>
      h(
        'button',
        {
          key: r,
          type: 'button',
          class: classNames('cp__filter', r === active && 'cp__filter--active'),
          'aria-selected': r === active ? 'true' : 'false',
          onClick: () => dispatch(navigate('rankings', { region: r }))
        },
        FILTER_LABELS[r] || r
      )
    )
  );
}
