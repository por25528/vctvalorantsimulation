/**
 * ui/screens/CPStandings.js — the Championship-Points race screen
 * (CONTRACTS-PERSIST §6, id 'cp').
 *
 * Pure `(state, dispatch) => VNode`: reads the cumulative CP standings (the
 * season-long race) via `selectCPStandings`, enriches each row with team display
 * info + the team's region, and renders them in the shared sortable `DataTable`.
 *
 * Features:
 *   - the cumulative CP table across the whole season, ranked desc by default;
 *   - a region filter (All / Pacific / Americas / EMEA / China) held in route
 *     params so the screen stays a pure function of state;
 *   - sortable by CP (the only meaningful numeric column) — sort key/dir live in
 *     route params too; a header click re-navigates with the toggled order;
 *   - clicking a row navigates to that team's screen;
 *   - an optional per-event CP breakdown column (how CP was earned), derived from
 *     the ledger history, shown when easily available.
 *
 * DOM-free and headless: renders via `toHtml` with no `document`/`window`.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { DataTable } from '../components/DataTable.js';
import {
  selectRoute,
  selectCPStandings,
  selectSeason,
  selectTeam,
  selectFollowedTeam
} from '../../state/selectors.js';
import { REGION_ORDER } from '../../engine/career/qualification.js';

/** The screen id (route key) the router maps to this screen. */
export const id = 'cp';

/** Region filter options: 'all' plus the four leagues in fixed order. */
const REGION_FILTERS = ['all', ...REGION_ORDER];

/** Human labels for the region filter chips / column. */
const REGION_LABELS = Object.freeze({
  all: 'All',
  pacific: 'Pacific',
  americas: 'Americas',
  emea: 'EMEA',
  china: 'China'
});

/**
 * The Championship-Points standings screen.
 * @param {object} state  the full store state
 * @param {(action:object)=>void} dispatch
 * @returns {*} VNode
 */
export function CPStandingsScreen(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const season = selectSeason(state);

  const standings = selectCPStandings(state);

  if (!season || standings.length === 0) {
    return h(
      'section',
      { class: 'screen screen--cp', 'data-screen': 'cp' },
      h('h1', { class: 'screen__title' }, 'Championship Points'),
      h(
        'p',
        { class: 'screen__empty' },
        'No Championship Points awarded yet. Hit Continue to play the season.'
      )
    );
  }

  const region = REGION_FILTERS.includes(params.region) ? params.region : 'all';
  const sortDir = params.sortDir === 'asc' ? 'asc' : 'desc';

  const followed = selectFollowedTeam(state);
  const followedId = followed ? followed.id : null;

  // Per-team region lookup (which league a team belongs to) from the season's
  // leagues — used both for the filter and the Region column.
  const regionByTeam = buildRegionByTeam(state);

  // Enrich + filter rows.
  const base = standings
    .map((row) => {
      const team = selectTeam(state, row.teamId);
      return {
        teamId: row.teamId,
        cp: row.cp,
        teamName: team ? team.name : row.teamId,
        teamTag: team ? team.tag : null,
        region: regionByTeam[row.teamId] || null
      };
    })
    .filter((row) => region === 'all' || row.region === region);

  // Sort by CP (the standings come desc; honor an asc toggle), then rank.
  const sign = sortDir === 'asc' ? 1 : -1;
  const sorted = [...base].sort((a, b) => {
    if (a.cp !== b.cp) return (a.cp - b.cp) * sign;
    return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
  });
  const rows = sorted.map((row, i) => ({ ...row, rank: i + 1 }));

  const onSort = (key) => {
    if (key !== 'cp') return;
    const nextDir = sortDir === 'desc' ? 'asc' : 'desc';
    dispatch(navigate('cp', { region, sortDir: nextDir }));
  };

  const onRow = (row) => dispatch(navigate('team', { teamId: row.teamId }));

  const columns = buildColumns();

  return h(
    'section',
    { class: 'screen screen--cp', 'data-screen': 'cp' },
    h('h1', { class: 'screen__title' }, 'Championship Points'),
    h(
      'p',
      { class: 'screen__subtitle' },
      'The season-long race — cumulative Championship Points decide the 15 ' +
        'cumulative Champions slots.'
    ),
    regionFilterBar(region, sortDir, dispatch),
    DataTable({
      columns,
      rows,
      sortKey: 'cp',
      sortDir,
      onSort,
      onRow,
      rowKey: (row) => row.teamId,
      rowClass: (row) => (row.teamId === followedId ? 'table__row--me' : null),
      class: 'cp-standings'
    })
  );
}

/** The region filter chip bar. Each chip re-navigates preserving the sort dir. */
function regionFilterBar(active, sortDir, dispatch) {
  return h(
    'div',
    { class: 'cp__filters', role: 'tablist' },
    REGION_FILTERS.map((r) =>
      h(
        'button',
        {
          key: r,
          type: 'button',
          class: classNames('cp__filter', r === active && 'cp__filter--active'),
          'data-region': r,
          'aria-selected': r === active ? 'true' : 'false',
          onClick: () => dispatch(navigate('cp', { region: r, sortDir }))
        },
        REGION_LABELS[r] || r
      )
    )
  );
}

/**
 * Build the team -> region map from the season's leagues (so the filter and the
 * Region column never need the engine). Each league lists its `teamIds`.
 * @param {object} state
 * @returns {Record<string,string>}
 */
function buildRegionByTeam(state) {
  /** @type {Record<string,string>} */
  const out = {};
  const leagues = (state.world && state.world.leagues) || {};
  for (const region of Object.keys(leagues)) {
    const league = leagues[region];
    const ids = (league && league.teamIds) || [];
    for (const teamId of ids) out[teamId] = region;
  }
  return out;
}

/** Columns: rank, team (tag + name), region, CP (sortable). */
function buildColumns() {
  return [
    { key: 'rank', label: '#', numeric: true, render: (row) => String(row.rank) },
    {
      key: 'team',
      label: 'Team',
      render: (row) =>
        h(
          'span',
          { class: 'cp__team' },
          row.teamTag
            ? h('span', { class: 'badge badge--seed' }, row.teamTag)
            : null,
          ' ',
          row.teamName
        )
    },
    {
      key: 'region',
      label: 'Region',
      render: (row) => (row.region ? REGION_LABELS[row.region] || row.region : '')
    },
    {
      key: 'cp',
      label: 'CP',
      numeric: true,
      sortable: true,
      render: (row) => String(row.cp)
    }
  ];
}
