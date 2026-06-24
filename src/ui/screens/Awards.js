/**
 * ui/screens/Awards.js — end-of-season awards (CONTRACTS-POLISH §1, id 'awards').
 *
 * Pure `(state, dispatch) => VNode`. Renders the CURRENT (in-progress / just
 * finished) season's awards — Season MVP, Finals MVP, Rookie of the Year, the
 * All-Pro First & Second teams, and per-region MVPs — plus a "Past Seasons" roll
 * of every prior year's champion + MVP (read from career history). Winner names
 * click through to the Player screen. Read-only; serializes headlessly via toHtml.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { DataTable } from '../components/DataTable.js';
import {
  selectSeasonAwards,
  selectSeasonIndex,
  selectCareerHistory,
  selectTeam
} from '../../state/selectors.js';

/** Region display labels (no engine import). */
const REGION_LABELS = { pacific: 'Pacific', americas: 'Americas', emea: 'EMEA', china: 'China' };

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @returns {import('../render.js').VNode}
 */
export function Awards(state, dispatch) {
  const awards = selectSeasonAwards(state);
  const seasonIndex = selectSeasonIndex(state);
  const history = selectCareerHistory(state);
  const go = (screen, params) => (dispatch ? dispatch(navigate(screen, params || {})) : undefined);
  const teamName = (id) => {
    const t = id ? selectTeam(state, id) : null;
    return (t && t.name) || id || '—';
  };

  const hasAwards = awards && awards.mvp;

  return h(
    'section',
    { class: 'screen screen--awards', id: 'screen-awards' },
    h(
      'header',
      { class: 'screen__head' },
      h('h1', { class: 'screen__title' }, 'Awards'),
      h('span', { class: 'badge awards__season' }, `Season ${seasonIndex + 1}`)
    ),
    hasAwards
      ? h(
          'div',
          null,
          h(
            'div',
            { class: 'awards__headline' },
            trophyCard('Season MVP', '🏆', awards.mvp, teamName, go, 'mvp'),
            trophyCard('Finals MVP', '🔥', awards.finalsMvp, teamName, go, 'finals'),
            trophyCard('Rookie of the Year', '🌱', awards.rookieOfYear, teamName, go, 'rookie')
          ),
          allProPanel('All-Pro First Team', awards.allProFirst, teamName, go),
          allProPanel('All-Pro Second Team', awards.allProSecond, teamName, go),
          regionPanel(awards.regionMvps, teamName, go)
        )
      : h('p', { class: 'card__muted awards__empty' }, 'Awards populate as the season is played — hit Continue to begin.'),
    pastSeasonsPanel(history, teamName, go)
  );
}

/* ----------------------------- trophy cards ---------------------------- */

/** A headline award card (MVP / Finals MVP / Rookie). */
function trophyCard(title, glyph, winner, teamName, go, kind) {
  return h(
    'div',
    { class: classNames('card', 'awards__trophy', `awards__trophy--${kind}`) },
    h('div', { class: 'awards__trophy-glyph', 'aria-hidden': 'true' }, glyph),
    h('div', { class: 'awards__trophy-title' }, title),
    winner
      ? h(
          'div',
          { class: 'awards__trophy-body' },
          h(
            'button',
            { type: 'button', class: 'link awards__winner-name', onClick: () => go('player', { playerId: winner.playerId }) },
            winner.handle
          ),
          h('div', { class: 'awards__trophy-meta' }, `${winner.role || '—'} · ${teamName(winner.teamId)}`),
          h('div', { class: 'awards__trophy-stat' }, `${winner.acs} ACS · ${winner.maps} maps`)
        )
      : h('div', { class: 'card__muted' }, 'Not awarded')
  );
}

/* ------------------------------ all-pro -------------------------------- */

/** An All-Pro team table (rating-ordered winners). */
function allProPanel(title, team, teamName, go) {
  if (!team || team.length === 0) {
    return panel(title, h('p', { class: 'card__muted' }, 'Not enough qualified players yet.'));
  }
  const rows = team.map((w, i) => ({ ...w, rank: i + 1, teamName: teamName(w.teamId) }));
  const columns = [
    { key: 'rank', label: '#', numeric: true },
    { key: 'handle', label: 'Player', render: (r) => h('button', { type: 'button', class: 'link', onClick: () => go('player', { playerId: r.playerId }) }, r.handle) },
    { key: 'role', label: 'Role', render: (r) => r.role || '—' },
    { key: 'teamName', label: 'Team' },
    { key: 'maps', label: 'Maps', numeric: true },
    { key: 'acs', label: 'ACS', numeric: true, render: (r) => String(r.acs) }
  ];
  return panel(title, DataTable({ columns, rows, rowKey: (r) => r.playerId, class: 'awards__table' }));
}

/* ---------------------------- region MVPs ------------------------------ */

/** Per-region MVP cards. */
function regionPanel(regionMvps, teamName, go) {
  const regions = Object.keys(regionMvps || {});
  return panel(
    'Regional MVPs',
    h(
      'div',
      { class: 'awards__regions' },
      regions.map((r) =>
        h(
          'div',
          { key: r, class: 'card awards__region' },
          h('div', { class: 'awards__region-name' }, REGION_LABELS[r] || r),
          regionMvps[r]
            ? h(
                'div',
                null,
                h('button', { type: 'button', class: 'link awards__winner-name', onClick: () => go('player', { playerId: regionMvps[r].playerId }) }, regionMvps[r].handle),
                h('div', { class: 'awards__trophy-meta' }, `${regionMvps[r].role || '—'} · ${teamName(regionMvps[r].teamId)} · ${regionMvps[r].acs} ACS`)
              )
            : h('div', { class: 'card__muted' }, '—')
        )
      )
    )
  );
}

/* --------------------------- past seasons ------------------------------ */

/** A roll of past seasons: champion + MVP per year (from career history). */
function pastSeasonsPanel(history, teamName, go) {
  if (!history || history.length === 0) {
    return panel('Past Seasons', h('p', { class: 'card__muted' }, 'No completed seasons yet.'));
  }
  const items = history
    .slice()
    .reverse()
    .map((s) => {
      const a = s.awards || {};
      const mvp = a.mvp;
      return h(
        'li',
        { key: s.seasonIndex, class: 'awards__past-item' },
        h('span', { class: 'awards__past-season' }, `Season ${s.seasonIndex + 1}`),
        h('span', { class: 'awards__past-champ' }, `🏆 ${teamName(s.champion)}`),
        mvp
          ? h(
              'span',
              { class: 'awards__past-mvp' },
              'MVP: ',
              h('button', { type: 'button', class: 'link', onClick: () => go('player', { playerId: mvp.playerId }) }, mvp.handle),
              ` (${mvp.acs} ACS)`
            )
          : h('span', { class: 'awards__past-mvp card__muted' }, 'MVP: —')
      );
    });
  return panel('Past Seasons', h('ul', { class: 'awards__past' }, items));
}

/* ------------------------------ helpers -------------------------------- */

/** A titled panel wrapping a body VNode. */
function panel(title, body) {
  return h(
    'section',
    { class: 'panel awards__panel' },
    h('header', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, title)),
    h('div', { class: 'panel__body' }, body)
  );
}
