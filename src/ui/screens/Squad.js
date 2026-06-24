/**
 * ui/screens/Squad.js — the followed team's roster (CONTRACTS-CAREER §4, id 'squad').
 *
 * Pure `(state, dispatch, store) => VNode`. A squad-management view: each player's
 * role/age, overall + potential, the live form/morale/fatigue dynamics that feed
 * the match engine, and their contract (salary + expiry season). Rows click
 * through to the Player screen. Read-only in this phase.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import {
  selectFollowedTeam,
  selectRoster,
  selectSeasonIndex
} from '../../state/selectors.js';

const ATTR_KEYS = ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl'];

/** A player's overall (mean of the nine attributes), rounded. */
function overall(p) {
  const a = (p && p.attributes) || {};
  let sum = 0;
  let n = 0;
  for (const k of ATTR_KEYS) {
    if (typeof a[k] === 'number') {
      sum += a[k];
      n += 1;
    }
  }
  return n > 0 ? Math.round(sum / n) : 0;
}

/** Round a possibly-undefined number for display. */
const r0 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @param {object} [store]
 * @returns {import('../render.js').VNode}
 */
export function Squad(state, dispatch, store) {
  const team = selectFollowedTeam(state);
  const seasonIndex = selectSeasonIndex(state);
  const go = (screen, params) => (dispatch ? dispatch(navigate(screen, params || {})) : undefined);

  if (!team) {
    return h(
      'section',
      { class: 'screen screen--squad', id: 'screen-squad' },
      h('h1', { class: 'screen__title' }, 'Squad'),
      h('p', { class: 'card__muted' }, 'No team followed yet.')
    );
  }

  const roster = selectRoster(state, team.id);
  const headers = ['Player', 'Role', 'Age', 'OVR', 'POT', 'Form', 'Morale', 'Fatigue', 'Salary', 'Expires'];

  return h(
    'section',
    { class: 'screen screen--squad', id: 'screen-squad' },
    h(
      'header',
      { class: 'screen__head' },
      h('h1', { class: 'screen__title' }, `${team.name} — Squad`),
      h('span', { class: 'badge squad__season' }, `Season ${seasonIndex + 1}`),
      h(
        'button',
        { type: 'button', class: 'link squad__market-link', onClick: () => go('market') },
        'Manage in Transfer Market →'
      )
    ),
    h(
      'table',
      { class: 'data-table squad__table' },
      h(
        'thead',
        null,
        h('tr', null, headers.map((hd) => h('th', { key: hd }, hd)))
      ),
      h('tbody', null, roster.map((p) => playerRow(p, go)))
    )
  );
}

/** One roster row. */
function playerRow(p, go) {
  const d = (p && p.dynamics) || {};
  const c = (p && p.contract) || {};
  const form = r0(d.form);
  const injury = p && p.injury;
  return h(
    'tr',
    { key: p.id, class: classNames('squad__row', injury && 'squad__row--injured') },
    h(
      'td',
      null,
      h(
        'button',
        { type: 'button', class: 'link squad__name', onClick: () => go('player', { playerId: p.id }) },
        p.handle || p.name
      ),
      injury
        ? h('span', { class: 'squad__injury', title: `${injury.type} — out ~${injury.weeks} event${injury.weeks > 1 ? 's' : ''}` }, ' 🩹')
        : null
    ),
    h('td', null, p.role),
    h('td', null, String(p.age)),
    h('td', { class: 'squad__ovr' }, String(overall(p))),
    h('td', null, String(p.potential)),
    h(
      'td',
      { class: classNames('squad__form', form > 0 && 'squad__form--up', form < 0 && 'squad__form--down') },
      (form > 0 ? '+' : '') + form
    ),
    h('td', null, String(r0(d.morale))),
    h('td', null, String(r0(d.fatigue))),
    h('td', null, `$${Math.round((c.salary || 0) / 1000)}k`),
    h('td', null, typeof c.expires === 'number' ? `S${c.expires + 1}` : '—')
  );
}
