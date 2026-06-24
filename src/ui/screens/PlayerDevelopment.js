/**
 * ui/screens/PlayerDevelopment.js — a player's growth/age story
 * (CONTRACTS-CAREER §4, id 'development').
 *
 * Pure `(state, dispatch) => VNode`. Resolves a player from
 * `ui.route.params.playerId` and narrates how they are aging: their career PHASE
 * (developing → prime → declining, off the development peakAge/declineAge), the
 * last off-season's overall TRAJECTORY (↑/→/↓), the POTENTIAL headroom still to
 * realise, and the nine attributes grouped into PHYSICAL (declines first),
 * MENTAL (declines slowest, can still tick up late) and CRAFT — so the user can
 * read where a veteran is fading and where a youngster is climbing.
 *
 * Read-only; renders headlessly via toHtml (no DOM access).
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { overall } from '../../engine/career/playerStats.js';
import {
  selectRoute,
  selectPlayer,
  selectTeam
} from '../../state/selectors.js';

/** The screen id (route key) this screen serves. */
export const SCREEN_ID = 'development';

/** Attribute groups by how aging treats them (CONTRACTS-CAREER §1.2). */
const ATTR_GROUPS = [
  { key: 'physical', label: 'Physical', hint: 'fades first', keys: ['aim', 'movement', 'reaction'] },
  { key: 'mental', label: 'Mental', hint: 'ages slowest', keys: ['gameSense', 'igl', 'composure'] },
  { key: 'craft', label: 'Craft', hint: 'role & utility', keys: ['utility', 'trading', 'consistency'] }
];

/** Pretty attribute labels. */
const ATTR_LABEL = {
  aim: 'Aim', movement: 'Movement', reaction: 'Reaction',
  gameSense: 'Game Sense', igl: 'IGL', composure: 'Composure',
  utility: 'Utility', trading: 'Trading', consistency: 'Consistency'
};

/** Round for display. */
const r0 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @returns {import('../render.js').VNode}
 */
export function PlayerDevelopment(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const player = params.playerId ? selectPlayer(state, params.playerId) : null;

  if (!player) {
    return h(
      'section',
      { class: 'screen screen--development', id: 'screen-development' },
      h('h1', { class: 'screen__title' }, 'Player Development'),
      h('p', { class: 'card__muted' }, 'No player selected. Open a player, then view their development.')
    );
  }

  const dev = player.development || {};
  const ovr = r0(overall(player));
  const pot = typeof player.potential === 'number' ? player.potential : ovr;
  const headroom = Math.max(0, pot - ovr);
  const phase = careerPhase(player.age, dev);
  const teamId = player.contract && player.contract.teamId;
  const team = teamId ? selectTeam(state, teamId) : null;

  const go = (screen, p) => (dispatch ? dispatch(navigate(screen, p || {})) : undefined);

  return h(
    'section',
    { class: 'screen screen--development', id: 'screen-development' },
    header(player, team, go),
    h(
      'div',
      { class: 'development__grid' },
      phaseCard(player, dev, phase),
      potentialCard(ovr, pot, headroom),
      trajectoryCard(dev),
      ageCurveCard(player.age, dev)
    ),
    attributesCard(player.attributes || {})
  );
}

/* ------------------------------- header ------------------------------ */

function header(player, team, go) {
  return h(
    'header',
    { class: 'screen__head development__head' },
    h(
      'div',
      null,
      h('h1', { class: 'screen__title' }, `${player.handle || player.name} — Development`),
      h(
        'p',
        { class: 'screen__sub' },
        `${player.role} · Age ${player.age}${team ? ' · ' + team.name : ''}`
      )
    ),
    h(
      'button',
      { type: 'button', class: 'link', onClick: () => go('player', { playerId: player.id }) },
      '← Player profile'
    )
  );
}

/* ------------------------------- cards ------------------------------- */

/** Career phase (developing / prime / declining) with the boundary ages. */
function phaseCard(player, dev, phase) {
  const peak = dev.peakAge != null ? dev.peakAge : 24;
  const decline = dev.declineAge != null ? dev.declineAge : 28;
  return card(
    'Career Phase',
    h('div', { class: classNames('development__phase', `development__phase--${phase.key}`) }, phase.label),
    h('p', { class: 'card__muted' }, `Peaks at ${peak}, declines from ${decline}. Now ${player.age}.`)
  );
}

/** Potential headroom: current overall vs the ceiling. */
function potentialCard(ovr, pot, headroom) {
  const pct = pot > 0 ? Math.max(0, Math.min(100, (ovr / pot) * 100)) : 100;
  return card(
    'Potential',
    h(
      'div',
      { class: 'development__pot' },
      h('span', { class: 'development__pot-now' }, String(ovr)),
      h('span', { class: 'development__pot-sep' }, '/'),
      h('span', { class: 'development__pot-cap' }, String(pot))
    ),
    h(
      'div',
      { class: 'development__bar', role: 'progressbar', 'aria-valuenow': r0(pct) },
      h('div', { class: 'development__bar-fill', style: { width: `${r0(pct)}%` } })
    ),
    h('p', { class: 'card__muted' }, headroom > 0 ? `${headroom} points of headroom remain` : 'At their ceiling')
  );
}

/** Last off-season's overall trajectory (↑/→/↓). */
function trajectoryCard(dev) {
  const t = typeof dev.trajectory === 'number' ? dev.trajectory : 0;
  const dir = t > 0.5 ? 'up' : t < -0.5 ? 'down' : 'flat';
  const glyph = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬';
  return card(
    'Last Off-season',
    h('div', { class: classNames('development__traj', `development__traj--${dir}`) }, `${glyph} ${t >= 0 ? '+' : ''}${t.toFixed(1)}`),
    h('p', { class: 'card__muted' }, dir === 'up' ? 'Improving' : dir === 'down' ? 'Regressing' : 'Holding steady')
  );
}

/** A mini age timeline marking peak/decline against the player's current age. */
function ageCurveCard(age, dev) {
  const peak = dev.peakAge != null ? dev.peakAge : 24;
  const decline = dev.declineAge != null ? dev.declineAge : 28;
  // Track spans a typical pro window [16, 34]; clamp positions into it.
  const lo = 16;
  const hi = 34;
  const pos = (a) => r0(Math.max(0, Math.min(100, ((a - lo) / (hi - lo)) * 100)));
  return card(
    'Age Curve',
    h(
      'div',
      { class: 'development__curve' },
      h('div', { class: 'development__curve-track' },
        marker('peak', pos(peak), `Peak ${peak}`),
        marker('decline', pos(decline), `Decline ${decline}`),
        marker('now', pos(age), `Now ${age}`)
      )
    ),
    h('p', { class: 'card__muted' }, `${lo}–${hi} career window`)
  );
}

/** One labelled marker on the age track. */
function marker(kind, leftPct, label) {
  return h(
    'div',
    { class: classNames('development__mark', `development__mark--${kind}`), style: { left: `${leftPct}%` }, title: label },
    h('span', { class: 'development__mark-dot' }),
    h('span', { class: 'development__mark-label' }, label)
  );
}

/** The nine attributes grouped by aging behaviour, each as a labelled bar. */
function attributesCard(attributes) {
  return h(
    'div',
    { class: 'card development__attrs-card' },
    h('h2', { class: 'card__title' }, 'Attributes'),
    h(
      'div',
      { class: 'development__attr-groups' },
      ATTR_GROUPS.map((g) =>
        h(
          'div',
          { key: g.key, class: 'development__attr-group' },
          h(
            'h3',
            { class: 'development__attr-group-title' },
            g.label,
            h('span', { class: 'development__attr-group-hint' }, g.hint)
          ),
          h('ul', { class: 'development__attr-list' }, g.keys.map((k) => attrRow(k, attributes[k])))
        )
      )
    )
  );
}

/** A single attribute bar + value. */
function attrRow(key, raw) {
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  const tier = v >= 85 ? 'elite' : v >= 75 ? 'high' : v >= 60 ? 'mid' : 'low';
  return h(
    'li',
    { key, class: classNames('development__attr', `development__attr--${tier}`) },
    h('span', { class: 'development__attr-label' }, ATTR_LABEL[key] || key),
    h('span', { class: 'development__attr-bar' }, h('span', { class: 'development__attr-fill', style: { width: `${r0(Math.max(0, Math.min(100, v)))}%` } })),
    h('span', { class: 'development__attr-value' }, String(r0(v)))
  );
}

/* ------------------------------ helpers ------------------------------ */

/** A titled card wrapping body VNodes. */
function card(title, ...body) {
  return h(
    'div',
    { class: 'card development__card' },
    h('h2', { class: 'card__title' }, title),
    ...body
  );
}

/**
 * The player's career phase from age vs development boundaries.
 * @returns {{key:'developing'|'prime'|'declining', label:string}}
 */
function careerPhase(age, dev) {
  const peak = dev && dev.peakAge != null ? dev.peakAge : 24;
  const decline = dev && dev.declineAge != null ? dev.declineAge : 28;
  if (age < peak) return { key: 'developing', label: 'Developing' };
  if (age < decline) return { key: 'prime', label: 'Prime' };
  return { key: 'declining', label: 'Declining' };
}
