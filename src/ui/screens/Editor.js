/**
 * ui/screens/Editor.js — the god-mode sandbox editor (CONTRACTS-POLISH P7d, id 'editor').
 *
 * Pure `(state, dispatch, store) => VNode`. The sandbox half of the locked
 * "god-mode sandbox + follow a team" decision: edit the followed team's identity
 * (name/tag/reputation/budget) and any of its players (the nine attributes, age,
 * potential, role, handle) live, plus god-mode quick-actions (heal, reset
 * fatigue, max morale). Every control routes through editPlayer/editTeam, which
 * re-validate + clamp via the domain factories. With no `store` (headless render
 * tests) the controls render inert.
 *
 * The selected player comes from `ui.route.params.playerId` (defaults to the
 * followed team's first roster slot).
 */

import { h } from '../render.js';
import { navigate } from '../../state/actions.js';
import { editPlayer, editTeam, healPlayer } from '../../state/commands.js';
import { selectFollowedTeam, selectTeam, selectTeams, selectRoster, selectPlayer, selectRoute } from '../../state/selectors.js';

/** The nine editable attributes (key + short label). */
const ATTRS = [
  ['aim', 'Aim'], ['movement', 'Move'], ['reaction', 'React'],
  ['composure', 'Comp'], ['consistency', 'Consist'], ['gameSense', 'Sense'],
  ['utility', 'Util'], ['trading', 'Trade'], ['igl', 'IGL']
];
const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

/** Parse an input value to a finite integer (fallback to current). */
function intOr(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @param {object} [store]
 * @returns {import('../render.js').VNode}
 */
export function Editor(state, dispatch, store) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const followed = selectFollowedTeam(state);
  const teams = selectTeams(state);
  // God mode works on ANY team — pick the route's team, else the followed team,
  // else the first team. The dropdown switches between all 48.
  const team = (params.teamId && selectTeam(state, params.teamId)) || followed || teams[0] || null;

  if (!team) {
    return h(
      'section',
      { class: 'screen screen--editor', id: 'screen-editor' },
      h('h1', { class: 'screen__title' }, 'God Mode'),
      h('p', { class: 'card__muted' }, 'No teams loaded.')
    );
  }

  const roster = selectRoster(state, team.id);
  const selId = params.playerId && roster.some((p) => p.id === params.playerId)
    ? params.playerId
    : (roster[0] && roster[0].id);
  const selected = selId ? selectPlayer(state, selId) : null;
  // Keep the selected team when switching players.
  const go = (p) => (dispatch ? dispatch(navigate('editor', { teamId: team.id, ...p })) : undefined);
  const onTeamChange = dispatch ? (e) => dispatch(navigate('editor', { teamId: e.target.value })) : null;

  return h(
    'section',
    { class: 'screen screen--editor', id: 'screen-editor' },
    h(
      'header',
      { class: 'screen__head' },
      h('h1', { class: 'screen__title' }, 'God Mode'),
      teamSelector(teams, team.id, onTeamChange)
    ),
    teamPanel(team, store),
    rosterTabs(roster, selId, go),
    selected ? playerPanel(selected, store) : h('p', { class: 'card__muted' }, 'No player selected.')
  );
}

/* --------------------------- team selector -------------------------- */

/** Dropdown of every team — switches which team God Mode is editing. */
function teamSelector(teams, selectedId, onChange) {
  return h(
    'label',
    { class: 'editor__field editor__teamselect' },
    h('span', { class: 'editor__field-label' }, 'Team'),
    h(
      'select',
      { class: 'editor__input editor__select', value: selectedId, onChange: onChange || undefined },
      teams.map((t) =>
        h(
          'option',
          { key: t.id, value: t.id, selected: t.id === selectedId ? true : undefined },
          `${t.tag ? t.tag + ' · ' : ''}${t.name}`
        )
      )
    )
  );
}

/* ------------------------------- team ------------------------------- */

function teamPanel(team, store) {
  const edit = (patch) => (store ? editTeam(store, team.id, patch) : undefined);
  return panel(
    'Team',
    h(
      'div',
      { class: 'editor__grid' },
      textField('Name', team.name, store ? (e) => edit({ name: e.target.value }) : null),
      textField('Tag', team.tag, store ? (e) => edit({ tag: e.target.value }) : null),
      numField('Reputation', team.reputation, 0, 100, store ? (e) => edit({ reputation: intOr(e.target.value, team.reputation) }) : null),
      numField('Budget ($)', team.budget, 0, 100000000, store ? (e) => edit({ budget: intOr(e.target.value, team.budget) }) : null)
    )
  );
}

/* ----------------------------- roster tabs -------------------------- */

function rosterTabs(roster, selId, go) {
  return h(
    'div',
    { class: 'editor__tabs' },
    roster.map((p) =>
      h(
        'button',
        {
          key: p.id,
          type: 'button',
          class: 'btn btn--sm' + (p.id === selId ? ' btn--primary' : ''),
          onClick: () => go({ playerId: p.id })
        },
        p.handle || p.name
      )
    )
  );
}

/* ------------------------------ player ------------------------------ */

function playerPanel(p, store) {
  const edit = (patch) => (store ? editPlayer(store, p.id, patch) : undefined);
  const a = p.attributes || {};

  return panel(
    `Edit ${p.handle || p.name}`,
    h(
      'div',
      { class: 'editor__player' },
      h(
        'div',
        { class: 'editor__grid' },
        textField('Handle', p.handle, store ? (e) => edit({ handle: e.target.value }) : null),
        selectField('Role', ROLES, p.role, store ? (e) => edit({ role: e.target.value }) : null),
        numField('Age', p.age, 14, 60, store ? (e) => edit({ age: intOr(e.target.value, p.age) }) : null),
        numField('Potential', p.potential, 0, 100, store ? (e) => edit({ potential: intOr(e.target.value, p.potential) }) : null)
      ),
      h('h3', { class: 'editor__subhead' }, 'Attributes'),
      h(
        'div',
        { class: 'editor__attrs' },
        ATTRS.map(([key, label]) =>
          numField(label, a[key], 0, 100, store ? (e) => edit({ attributes: { [key]: intOr(e.target.value, a[key]) } }) : null, key)
        )
      ),
      h(
        'div',
        { class: 'editor__actions' },
        godBtn('Heal', store ? () => healPlayer(store, p.id) : null),
        godBtn('Reset Fatigue', store ? () => edit({ dynamics: { fatigue: 0 } }) : null),
        godBtn('Max Morale', store ? () => edit({ dynamics: { morale: 100 } }) : null),
        godBtn('Peak Form', store ? () => edit({ dynamics: { form: 100 } }) : null)
      ),
      p.injury ? h('p', { class: 'editor__injury' }, `🩹 Injured: ${p.injury.type} (out ~${p.injury.weeks})`) : null
    )
  );
}

/* ------------------------------ controls ---------------------------- */

function textField(label, value, onChange) {
  return h(
    'label',
    { class: 'editor__field' },
    h('span', { class: 'editor__field-label' }, label),
    h('input', { type: 'text', class: 'editor__input', value: value == null ? '' : String(value), onChange: onChange || undefined })
  );
}

function numField(label, value, min, max, onChange, key) {
  return h(
    'label',
    { class: 'editor__field', key: key || label },
    h('span', { class: 'editor__field-label' }, label),
    h('input', { type: 'number', class: 'editor__input editor__input--num', value: String(value == null ? 0 : value), min, max, onChange: onChange || undefined })
  );
}

function selectField(label, options, value, onChange) {
  return h(
    'label',
    { class: 'editor__field' },
    h('span', { class: 'editor__field-label' }, label),
    h(
      'select',
      { class: 'editor__input editor__select', value, onChange: onChange || undefined },
      options.map((o) => h('option', { key: o, value: o, selected: o === value ? true : undefined }, o))
    )
  );
}

function godBtn(label, onClick) {
  return h('button', { type: 'button', class: 'btn btn--sm', onClick: onClick || undefined, disabled: onClick ? undefined : true }, label);
}

function panel(title, body) {
  return h(
    'section',
    { class: 'panel editor__panel' },
    h('header', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, title)),
    h('div', { class: 'panel__body' }, body)
  );
}
