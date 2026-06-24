/**
 * ui/screens/StatsLeaders.js — the Leaders screen (CONTRACTS-UI §5, id 'leaders').
 *
 * Sortable per-player leaderboards across ANY played event (chosen via the
 * EventPicker), each player's stats aggregated over every map they played. Leads
 * with an HLTV-style Rating 2.0 (default sort), then ACS / K / FB / CL / KD /
 * KAST / ADR. Sort + event live in route params so the screen stays a pure
 * `(state, dispatch) => VNode`. Row clicks open the player.
 */

import { h } from '../render.js';
import { navigate } from '../../state/actions.js';
import { DataTable } from '../components/DataTable.js';
import { EventPicker } from '../components/EventPicker.js';
import {
  selectRoute,
  selectLeaders,
  selectEvent,
  selectPlayer,
  selectFollowedTeam,
  selectPlayedEvents,
  selectDefaultEventId
} from '../../state/selectors.js';
import { eventLabel } from '../eventFormats.js';

/** The screen id (route key) this screen serves. */
export const SCREEN_ID = 'leaders';

/** Sortable stat keys (all numeric, all default to descending). */
const SORT_KEYS = new Set(['rating', 'acs', 'kills', 'firstBloods', 'clutches', 'kd', 'kast', 'adr']);

/** Default sort: top players by HLTV Rating 2.0, descending. */
const DEFAULT_SORT_KEY = 'rating';
const DEFAULT_SORT_DIR = 'desc';

/**
 * The Leaders screen.
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @returns {*} VNode
 */
export function StatsLeadersScreen(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const events = selectPlayedEvents(state);
  const eventId =
    params.eventId && events.some((e) => e.eventId === params.eventId)
      ? params.eventId
      : selectDefaultEventId(state);
  const event = eventId ? selectEvent(state, eventId) : null;
  const entry = events.find((e) => e.eventId === eventId) || null;

  const onPick = (eid) => dispatch(navigate('leaders', { eventId: eid }));

  if (!event) {
    return h(
      'section',
      { class: 'screen screen--leaders' },
      h('h1', { class: 'screen__title' }, 'Leaders'),
      EventPicker({ events, activeEventId: eventId, onPick }),
      h('p', { class: 'screen__empty' }, 'No event has been played yet. Hit Continue to play one.')
    );
  }

  const sortKey = SORT_KEYS.has(params.sortKey) ? params.sortKey : DEFAULT_SORT_KEY;
  const sortDir = params.sortDir === 'asc' ? 'asc' : DEFAULT_SORT_DIR;

  const followed = selectFollowedTeam(state);
  const followedId = followed ? followed.id : null;

  const base = selectLeaders(state, eventId, Infinity).map((row) => {
    const player = selectPlayer(state, row.playerId);
    return {
      ...row,
      handle: player ? player.handle || player.name || player.id : row.playerId,
      teamId: player && player.contract ? player.contract.teamId : null,
      role: player ? player.role : ''
    };
  });

  const rows = sortRows(base, sortKey, sortDir).map((row, i) => ({ ...row, __rank: i + 1 }));

  const onSort = (key) => {
    if (!SORT_KEYS.has(key)) return;
    const nextDir = key === sortKey && sortDir === 'desc' ? 'asc' : 'desc';
    dispatch(navigate('leaders', { eventId, sortKey: key, sortDir: nextDir }));
  };

  const onRow = (row) => dispatch(navigate('player', { playerId: row.playerId, teamId: row.teamId, eventId }));

  return h(
    'section',
    { class: 'screen screen--leaders' },
    h(
      'header',
      { class: 'screen__head' },
      h(
        'div',
        null,
        h('h1', { class: 'screen__title' }, 'Leaders'),
        h('p', { class: 'screen__subtitle' }, `${eventLabel(entry)} — aggregated per player over every map`)
      )
    ),
    EventPicker({ events, activeEventId: eventId, onPick }),
    DataTable({
      columns: buildColumns(),
      rows,
      sortKey,
      sortDir,
      onSort,
      onRow,
      rowKey: (row) => row.playerId,
      rowClass: (row) => (row.teamId && row.teamId === followedId ? 'table__row--me' : null),
      class: 'leaders'
    })
  );
}

/** Sort the aggregated rows by the active column (Rating desc tie-break). */
function sortRows(rows, sortKey, sortDir) {
  const sign = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = Number(a[sortKey]) || 0;
    const bv = Number(b[sortKey]) || 0;
    if (av !== bv) return (av - bv) * sign;
    if (sortKey !== 'rating') {
      const rd = (Number(a.rating) || 0) - (Number(b.rating) || 0);
      if (rd !== 0) return -rd;
    }
    return String(a.handle).localeCompare(String(b.handle));
  });
}

/** Columns: rank, player, role, maps, Rating, then the supporting stats. */
function buildColumns() {
  return [
    { key: 'rank', label: '#', numeric: true, render: (row) => String(row.__rank) },
    { key: 'handle', label: 'Player', render: (row) => row.handle },
    { key: 'role', label: 'Role', render: (row) => row.role || '' },
    { key: 'maps', label: 'Maps', numeric: true, render: (row) => String(row.maps) },
    {
      key: 'rating',
      label: 'Rating',
      numeric: true,
      sortable: true,
      render: (row) => h('span', { class: ratingClass(row.rating) }, (Number(row.rating) || 0).toFixed(2))
    },
    { key: 'acs', label: 'ACS', numeric: true, sortable: true, render: (row) => (Number(row.acs) || 0).toFixed(0) },
    { key: 'kills', label: 'K', numeric: true, sortable: true, render: (row) => String(row.kills) },
    { key: 'kd', label: 'KD', numeric: true, sortable: true, render: (row) => (Number(row.kd) || 0).toFixed(2) },
    { key: 'kast', label: 'KAST', numeric: true, sortable: true, render: (row) => `${Math.round((Number(row.kast) || 0) * 100)}%` },
    { key: 'adr', label: 'ADR', numeric: true, sortable: true, render: (row) => (Number(row.adr) || 0).toFixed(0) },
    { key: 'firstBloods', label: 'FB', numeric: true, sortable: true, render: (row) => String(row.firstBloods) },
    { key: 'clutches', label: 'CL', numeric: true, sortable: true, render: (row) => String(row.clutches) }
  ];
}

/** Color a rating value by tier (1.10+ great, 1.0+ good, <0.95 poor). */
export function ratingClass(rating) {
  const r = Number(rating) || 0;
  if (r >= 1.1) return 'rating rating--elite';
  if (r >= 1.0) return 'rating rating--good';
  if (r < 0.95) return 'rating rating--low';
  return 'rating';
}
