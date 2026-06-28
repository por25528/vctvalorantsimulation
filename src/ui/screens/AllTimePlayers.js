/**
 * ui/screens/AllTimePlayers.js — the ALL-TIME PLAYERS leaderboard (Wave 2 E,
 * route id 'legends'). Pure `(state, dispatch) => VNode`; reads truth only through
 * selectors and renders headlessly via toHtml (no DOM access).
 *
 * Ranks every banked player across boards (most titles / MVPs / career ACS / K-D
 * / maps / events) from `state.career.playerLegacy`. The active board is a route
 * param (`board`) so the screen stays pure. Rows link to a player's Life Story.
 * Robust to an empty ledger (early career) — each board shows an empty state.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { Icon } from '../components/Icon.js';
import { DataTable } from '../components/DataTable.js';
import { selectRoute, selectPlayerLegacy } from '../../state/selectors.js';
import { ALLTIME_BOARDS, deriveAllTime, deriveLegacySummary } from '../legacyDerive.js';

/** The screen id (route key) this screen serves. */
export const SCREEN_ID = 'legends';

const DEFAULT_BOARD = 'titles';
const VALUE_FMT = {
  acs: (v) => v.toFixed(1),
  kd: (v) => v.toFixed(2)
};

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @returns {import('../render.js').VNode}
 */
export function AllTimePlayers(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const boardId = ALLTIME_BOARDS.some((b) => b.id === params.board) ? params.board : DEFAULT_BOARD;
  const legacy = selectPlayerLegacy(state);
  const summary = deriveLegacySummary(legacy);
  const rows = deriveAllTime(legacy, boardId);
  const board = ALLTIME_BOARDS.find((b) => b.id === boardId) || ALLTIME_BOARDS[0];

  const go = (screen, p) => (dispatch ? dispatch(navigate(screen, p || {})) : undefined);

  return h(
    'section',
    { class: 'screen screen--legends alltime', id: 'screen-legends' },
    h(
      'header',
      { class: 'screen__head' },
      h('h1', { class: 'screen__title' }, 'All-Time Players'),
      h('p', { class: 'screen__sub' },
        `${summary.tracked} player${summary.tracked === 1 ? '' : 's'} tracked across ${summary.seasonsBanked} banked season${summary.seasonsBanked === 1 ? '' : 's'}`)
    ),
    heroStrip(summary, go),
    tabs(boardId, go),
    rows.length
      ? leaderboard(board, rows, go)
      : h('p', { class: 'alltime__empty card__muted' }, 'No banked careers yet. Advance a full season to crown the first legends.')
  );
}

/* -------------------------------- hero ----------------------------------- */

function heroStrip(summary, go) {
  const cards = [];
  if (summary.mostTitles) {
    cards.push(heroCard('trophy', 'Most Titles', summary.mostTitles, (id) => go('career', { playerId: id })));
  }
  if (summary.mostMaps) {
    cards.push(heroCard('standings', 'Most Maps', summary.mostMaps, (id) => go('career', { playerId: id })));
  }
  if (!cards.length) return null;
  return h('div', { class: 'alltime__hero' }, cards);
}

function heroCard(icon, label, row, onClick) {
  return h(
    'button',
    { type: 'button', class: 'alltime__hero-card', onClick: () => onClick(row.playerId) },
    h('span', { class: 'alltime__hero-icon', 'aria-hidden': 'true' }, Icon(icon, { size: 20 })),
    h('span', { class: 'alltime__hero-body' },
      h('span', { class: 'alltime__hero-kicker' }, label),
      h('span', { class: 'alltime__hero-name' }, row.handle),
      h('span', { class: 'alltime__hero-value' }, `${row.value} · ${row.sub}`))
  );
}

/* -------------------------------- tabs ----------------------------------- */

function tabs(activeId, go) {
  return h(
    'div',
    { class: 'alltime__tabs', role: 'tablist' },
    ALLTIME_BOARDS.map((b) =>
      h(
        'button',
        {
          key: b.id,
          type: 'button',
          role: 'tab',
          'aria-selected': b.id === activeId ? 'true' : 'false',
          class: classNames('alltime__tab', b.id === activeId && 'alltime__tab--active'),
          onClick: () => go('legends', { board: b.id })
        },
        b.label
      )
    )
  );
}

/* ----------------------------- leaderboard ------------------------------- */

function leaderboard(board, rows, go) {
  const fmt = VALUE_FMT[board.id] || ((v) => String(v));
  const columns = [
    { key: 'rank', label: '#', numeric: true },
    { key: 'handle', label: 'Player', render: (r) => h('span', { class: 'alltime__player' },
      h('span', { class: 'alltime__player-name' }, r.handle),
      r.role ? h('span', { class: 'alltime__player-role' }, r.role) : null) },
    { key: 'value', label: board.label, numeric: true, render: (r) => h('span', { class: 'alltime__value' }, fmt(r.value)) },
    { key: 'sub', label: 'Detail', render: (r) => h('span', { class: 'card__muted' }, r.sub) }
  ];
  return h(
    'div',
    { class: 'card alltime__board-card' },
    h('h2', { class: 'card__title' }, board.label),
    DataTable({
      columns,
      rows,
      rowKey: (r) => r.playerId,
      onRow: (r) => go('career', { playerId: r.playerId }),
      class: 'alltime-board'
    })
  );
}
