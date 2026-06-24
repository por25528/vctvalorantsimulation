/**
 * ui/components/StandingsTable.js — ranked standings table (CONTRACTS-UI §6).
 * Phase 3 (UI shell). Pure props -> VNode; emits the `.standings` / `.table`
 * BEM classes from styles/main.css.
 *
 * Columns: #, team, W-L, map diff, round diff.
 */

import { h, classNames } from '../render.js';

/**
 * @typedef {object} StandingsRow
 * @property {number} rank
 * @property {string} teamId
 * @property {string} [teamName]    display name (falls back to teamId)
 * @property {string} [teamTag]     short tag/abbrev (optional)
 * @property {number} w             series/match wins
 * @property {number} l             series/match losses
 * @property {number} [mapW]        maps won
 * @property {number} [mapL]        maps lost
 * @property {number} [mapDiff]     map differential (defaults to mapW - mapL)
 * @property {number} [roundDiff]   round differential
 * @property {boolean} [me]         followed-team emphasis
 */

/**
 * @param {object} props
 * @param {StandingsRow[]} props.rows
 * @param {(teamId:string)=>void} [props.onTeam] row/team click handler
 * @returns {*} VNode
 */
export function StandingsTable(props) {
  const { rows = [], onTeam = null } = props || {};

  const head = h(
    'thead',
    { class: 'table__head' },
    h(
      'tr',
      { class: 'table__row' },
      h('th', { class: 'table__cell', scope: 'col' }, '#'),
      h('th', { class: 'table__cell', scope: 'col' }, 'Team'),
      h('th', { class: 'table__cell table__cell--num', scope: 'col' }, 'W-L'),
      h('th', { class: 'table__cell table__cell--num', scope: 'col' }, 'Map +/-'),
      h('th', { class: 'table__cell table__cell--num', scope: 'col' }, 'Rnd +/-')
    )
  );

  const body = h(
    'tbody',
    null,
    rows.map((row) => standingsRow(row, onTeam))
  );

  return h('table', { class: 'table standings' }, head, body);
}

/** Render one standings row. */
function standingsRow(row, onTeam) {
  const teamId = row.teamId;
  const name = row.teamName != null ? row.teamName : teamId;
  const mapDiff =
    row.mapDiff != null
      ? row.mapDiff
      : Number(row.mapW || 0) - Number(row.mapL || 0);
  const roundDiff = Number(row.roundDiff || 0);

  return h(
    'tr',
    {
      key: String(teamId),
      class: classNames(
        'table__row',
        onTeam && 'table__row--clickable',
        row.me && 'table__row--me',
        row.adv && 'standings__row--adv',
        row.cut && 'standings__row--cut'
      ),
      onClick: onTeam ? () => onTeam(teamId) : undefined
    },
    h('td', { class: 'table__cell standings__rank' }, String(row.rank)),
    h(
      'td',
      { class: 'table__cell standings__team' },
      row.teamTag ? h('span', { class: 'badge badge--seed' }, row.teamTag) : null,
      ' ',
      name
    ),
    h('td', { class: 'table__cell table__cell--num standings__wl' }, `${row.w}-${row.l}`),
    h(
      'td',
      { class: 'table__cell table__cell--num' },
      diffSpan(mapDiff)
    ),
    h(
      'td',
      { class: 'table__cell table__cell--num' },
      diffSpan(roundDiff)
    )
  );
}

/** A signed differential with positive/negative tint. */
function diffSpan(value) {
  const v = Number(value) || 0;
  const cls = v > 0 ? 'standings__diff--pos' : v < 0 ? 'standings__diff--neg' : null;
  const text = v > 0 ? `+${v}` : String(v);
  return h('span', { class: classNames(cls) }, text);
}
