/**
 * ui/screens/GlobalRankings.js — the Global Rankings leaderboard (id 'globalrankings').
 *
 * The competitive-core leaderboard of pro TEAMS and PLAYERS. A scope toggle
 * (teams | players, held in route params so the screen stays pure) switches the
 * ranked list; each row shows rank, rating, and the climb/fall since the last
 * update (deltaRank) with up/down indicators. Players additionally carry their
 * rank-tier badge. Rows click through to the team / player page.
 *
 * Pure `(state, dispatch) => VNode`; consumes r9's `selectGlobalRankings`
 * through the rank-selector adapter and renders the shared DataTable.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { Icon } from '../components/Icon.js';
import { DataTable } from '../components/DataTable.js';
import { RankBadge } from '../components/RankBadge.js';
import { selectRoute, selectFollowedTeam } from '../../state/selectors.js';
import { selectGlobalRankings } from '../rankSelectors.js';
import { tierFromOverall } from '../rankTier.js';
import { REGION_LABELS } from '../eventFormats.js';

/** Screen id (route key). */
export const id = 'globalrankings';

const SCOPES = [
  { key: 'teams', label: 'Teams' },
  { key: 'players', label: 'Players' }
];

/**
 * Classify a climb/fall delta into a direction descriptor for display.
 * Positive deltaRank = moved UP the ranking (climbed); negative = fell.
 * @param {number} delta
 * @returns {{dir:'up'|'down'|'flat', abs:number}}
 */
function climb(delta) {
  const d = typeof delta === 'number' && Number.isFinite(delta) ? delta : 0;
  if (d > 0) return { dir: 'up', abs: d };
  if (d < 0) return { dir: 'down', abs: -d };
  return { dir: 'flat', abs: 0 };
}

/** Render the climb/fall cell (up/down chevron + magnitude, or a flat dash). */
function deltaCell(delta) {
  const c = climb(delta);
  if (c.dir === 'flat') return h('span', { class: 'rankings__delta rankings__delta--flat' }, '—');
  const icon = c.dir === 'up' ? 'arrow-up' : 'arrow-down';
  return h(
    'span',
    { class: classNames('rankings__delta', `rankings__delta--${c.dir}`) },
    Icon(icon, { size: 13 }),
    h('span', { class: 'rankings__delta-num' }, String(c.abs))
  );
}

/**
 * The Global Rankings screen.
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
export function GlobalRankingsScreen(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const scope = SCOPES.some((s) => s.key === params.scope) ? params.scope : 'teams';

  const rows = selectGlobalRankings(state, { scope }) || [];
  const followed = selectFollowedTeam(state);
  const followedId = followed ? followed.id : null;

  const header = h(
    'header',
    { class: 'screen__head' },
    h('h1', { class: 'screen__title' }, 'Global Rankings'),
    h(
      'p',
      { class: 'screen__subtitle' },
      'The worldwide pro leaderboard — every team and player ranked by rating, with the climb or fall since the last update.'
    ),
    scopeToggle(scope, dispatch)
  );

  if (!rows.length) {
    return h(
      'section',
      { class: 'screen screen--rankings', 'data-screen': 'globalrankings' },
      header,
      h('p', { class: 'screen__empty muted' }, 'No rankings yet — play some matches to seed the board.')
    );
  }

  const onRow =
    scope === 'teams'
      ? (row) => dispatch(navigate('team', { teamId: row.id }))
      : (row) => dispatch(navigate('player', { playerId: row.id }));

  const columns = [
    { key: 'rank', label: '#', numeric: true, render: (r) => `#${r.rank}` },
    { key: 'delta', label: 'Δ', numeric: true, render: (r) => deltaCell(r.deltaRank) },
    {
      key: 'name',
      label: scope === 'teams' ? 'Team' : 'Player',
      render: (r) =>
        h(
          'span',
          { class: 'rankings__name' },
          h('span', { class: 'rankings__name-text' }, r.name),
          // The ranking row carries no attributes, so the player's rank-tier is
          // read from its rating band (the same ladder the engine uses).
          scope === 'players'
            ? RankBadge({ tier: tierFromOverall(r.rating).tier, showLabel: false, class: 'rankings__tier' })
            : null
        )
    },
    { key: 'region', label: 'Region', render: (r) => (r.region ? REGION_LABELS[r.region] || r.region : '—') },
    { key: 'rating', label: 'Rating', numeric: true, render: (r) => h('span', { class: 'rankings__rating' }, String(r.rating)) }
  ];

  return h(
    'section',
    { class: 'screen screen--rankings', 'data-screen': 'globalrankings' },
    header,
    DataTable({
      columns,
      rows,
      onRow,
      rowKey: (r) => r.id,
      rowClass: (r) => (scope === 'teams' && r.id === followedId ? 'table__row--me' : null),
      class: 'rankings'
    })
  );
}

/** Scope toggle (Teams | Players) chip bar. */
function scopeToggle(active, dispatch) {
  return h(
    'div',
    { class: 'cp__filters', role: 'tablist', 'aria-label': 'Ranking scope' },
    SCOPES.map((s) =>
      h(
        'button',
        {
          key: s.key,
          type: 'button',
          class: classNames('cp__filter', s.key === active && 'cp__filter--active'),
          'aria-selected': s.key === active ? 'true' : 'false',
          onClick: () => dispatch(navigate('globalrankings', { scope: s.key }))
        },
        s.label
      )
    )
  );
}
