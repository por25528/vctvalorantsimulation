/**
 * ui/screens/Offseason.js — the end-of-season TRANSFER WINDOW board (id 'offseason').
 *
 * Pure `(state, dispatch, store) => VNode`. The spectator's season-end review: a
 * league-wide picture of the off-season the AI just resolved, shown BEFORE the new
 * season plays. Centerpiece is the transfer market —
 *   - a summary strip (total fees moved, deals done, signings, biggest deal),
 *   - HEADLINE DEALS: the fee-paying buys, priciest first (who moved where, for how much),
 *   - CLUB SPENDING: per club, fees spent vs received and net (the "who splashed the cash" view),
 *   - MONEY LEADERS: the richest clubs after the window,
 * plus the classic cards (brightest risers, retirements, top newgens, free-agent signings).
 *
 * Read-only; names/budgets resolve against the post-window world. Clicking a club
 * opens its team page. Renders headlessly via toHtml (buttons inert without dispatch).
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import {
  selectOffseasonReport,
  selectTransferWindow,
  selectSeasonIndex
} from '../../state/selectors.js';

const ATTR_KEYS = ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl'];
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

/** Compact money: 40000 -> "$40k", 1_250_000 -> "$1.25M". */
function money(n) {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${Math.round(v / 1000)}k`;
}

/** Colored OVR pill badge: elite (80+) gold, good (70+) green, fair (60+) red, raw grey. */
function ovrBadge(n) {
  const v = Math.round(n || 0);
  if (!v) return null;
  const tier = v >= 80 ? 'elite' : v >= 70 ? 'good' : v >= 60 ? 'fair' : 'raw';
  return h('span', { class: `ovr-badge ovr-badge--${tier}` }, String(v));
}

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @param {object} [store]
 * @returns {import('../render.js').VNode}
 */
export function Offseason(state, dispatch, store) {
  const report = selectOffseasonReport(state);
  const seasonIndex = selectSeasonIndex(state);
  const world = state.world || { teams: {}, players: {} };
  const pname = (id) => {
    const p = world.players[id];
    return p ? `${p.handle || p.name} (${p.role}, ${p.age})` : id;
  };
  const tname = (id) => {
    const t = world.teams[id];
    return t ? t.name : id;
  };
  const goTeam = dispatch ? (id) => dispatch(navigate('team', { teamId: id })) : undefined;

  if (!report) {
    return h(
      'section',
      { class: 'screen screen--offseason', id: 'screen-offseason' },
      h('h1', { class: 'screen__title' }, 'Transfer Window'),
      h('p', { class: 'card__muted' }, 'No off-season has run yet — finish a season and hit Continue.')
    );
  }

  // The report's `season` is the year that just ended; the new season is +1.
  const seasonOf = report.season != null ? report.season : seasonIndex - 1;
  const title = `Transfer Window — after Season ${seasonOf + 1}`;
  const window = selectTransferWindow(state);

  const developed = (report.developed || []).slice(0, 8);
  const newgens = (report.newgens || [])
    .map((id) => world.players[id])
    .filter(Boolean)
    .sort((a, b) => b.potential - a.potential)
    .slice(0, 6);

  return h(
    'section',
    { class: 'screen screen--offseason', id: 'screen-offseason' },
    h('h1', { class: 'screen__title' }, title),
    summaryStrip(window),
    h(
      'div',
      { class: 'transfer-window__board' },
      dealsPanel(window, goTeam),
      spendingPanel(window, goTeam)
    ),
    moneyLeadersPanel(window, goTeam),
    h(
      'div',
      { class: 'offseason__grid' },
      card('Brightest Risers', developed.length
        ? list(developed.map((d) => `${pname(d.id)}  ${d.trajectory >= 0 ? '+' : ''}${d.trajectory.toFixed(1)} → OVR ${overall(world.players[d.id])}`))
        : muted('No notable development.')),
      card(`Retirements (${(report.retired || []).length})`, (report.retired || []).length
        ? list((report.retired || []).slice(0, 10).map((id) => pname(id)))
        : muted('Nobody hung up the mouse.')),
      card('Top Newgens', newgens.length
        ? list(newgens.map((p) => `${p.handle} (${p.role}, ${p.age}) — POT ${p.potential}`))
        : muted('No youth entered.')),
      card('Free-Agent Signings', (window && window.signings.length)
        ? list(window.signings.slice(0, 8).map((s) => `${s.player}${s.age ? ' (' + s.age + ')' : ''} — OVR ${Math.round(s.ovr || 0)} → ${s.to}  (${money(s.salary)} wage)`))
        : muted('A quiet free-agent market.'))
    )
  );
}

/* ------------------------------ transfer board ------------------------------ */

/** The headline KPI strip: total fees, deals, signings, biggest deal. */
function summaryStrip(w) {
  if (!w) return null;
  const big = w.biggest;
  return h(
    'div',
    { class: 'transfer-window__summary' },
    kpi(money(w.totalFees), 'Total fees moved'),
    kpi(String(w.count), 'Transfers (with fee)'),
    kpi(String(w.signingCount), 'Free-agent signings'),
    kpi(big ? `${money(big.fee)}` : '—', big ? `Biggest: ${big.player} (OVR ${Math.round(big.ovr || 0)}) → ${big.toTag}` : 'No fee deals')
  );
}

/** A KPI tile. */
function kpi(value, label) {
  return h(
    'div',
    { class: 'kpi transfer-window__kpi' },
    h('span', { class: 'kpi__value' }, value),
    h('span', { class: 'kpi__label' }, label)
  );
}

/** HEADLINE DEALS — the fee-paying buys, priciest first. */
function dealsPanel(w, goTeam) {
  const deals = (w && w.deals) || [];
  if (deals.length === 0) {
    return panel('Headline Deals', 'no fee deals', h('p', { class: 'card__muted' }, 'No clubs paid a transfer fee this window — the market moved on free transfers only.'));
  }
  const rows = deals.slice(0, 12).map((d, i) =>
    h(
      'tr',
      { key: i, class: 'table__row' },
      h('td', { class: 'table__cell' },
        h('span', { class: 'transfer-window__player-name' }, d.player),
        d.age ? h('span', { class: 'transfer-window__player-age' }, ` ${d.age}`) : null
      ),
      h('td', { class: 'table__cell' }, d.role),
      h('td', { class: 'table__cell table__cell--num' }, ovrBadge(d.ovr)),
      h(
        'td',
        { class: 'table__cell transfer-window__route' },
        clubLink(d.fromTag, d.from, goTeam, d.fromId),
        h('span', { class: 'transfer-window__arrow' }, ' → '),
        clubLink(d.toTag, d.to, goTeam, d.toId)
      ),
      h('td', { class: 'table__cell table__cell--num transfer-window__fee' }, money(d.fee)),
      h('td', { class: 'table__cell table__cell--num' }, money(d.salary))
    )
  );
  return panel(
    'Headline Deals',
    `${deals.length} fee deal${deals.length === 1 ? '' : 's'}`,
    h(
      'table',
      { class: 'table data-table' },
      h('thead', { class: 'table__head' }, h('tr', { class: 'table__row' },
        ['Player', 'Role', 'OVR', 'Move', 'Fee', 'Wage'].map((hd, i) =>
          h('th', { key: i, class: classNames('table__cell', (i === 2 || i >= 4) && 'table__cell--num'), scope: 'col' }, hd)))),
      h('tbody', null, rows)
    )
  );
}

/** CLUB SPENDING — fees out vs in, net, sorted by spend. */
function spendingPanel(w, goTeam) {
  const byClub = (w && w.byClub) || [];
  if (byClub.length === 0) {
    return panel('Club Spending', 'quiet window', h('p', { class: 'card__muted' }, 'No club spent on fees this window.'));
  }
  const rows = byClub.slice(0, 14).map((c) =>
    h(
      'tr',
      { key: c.teamId, class: 'table__row' },
      h('td', { class: 'table__cell' }, clubLink(c.tag, c.name, goTeam, c.teamId)),
      h('td', { class: 'table__cell table__cell--num' }, c.buys ? money(c.spent) : '—'),
      h('td', { class: 'table__cell table__cell--num' }, c.sales ? money(c.received) : '—'),
      h('td', { class: classNames('table__cell', 'table__cell--num', c.net >= 0 ? 'transfer-window__net--pos' : 'transfer-window__net--neg') },
        (c.net >= 0 ? '+' : '−') + money(Math.abs(c.net)))
    )
  );
  return panel(
    'Club Spending',
    'fees out vs in',
    h(
      'table',
      { class: 'table data-table' },
      h('thead', { class: 'table__head' }, h('tr', { class: 'table__row' },
        ['Club', 'Spent', 'Received', 'Net'].map((hd, i) =>
          h('th', { key: i, class: classNames('table__cell', i >= 1 && 'table__cell--num'), scope: 'col' }, hd)))),
      h('tbody', null, rows)
    )
  );
}

/** MONEY LEADERS — the richest clubs after the window. */
function moneyLeadersPanel(w, goTeam) {
  const leaders = (w && w.moneyLeaders) || [];
  if (leaders.length === 0) return null;
  const top = leaders.slice(0, 10);
  return panel(
    'Money Leaders',
    'biggest war-chests entering the new season',
    h(
      'ol',
      { class: 'transfer-window__money' },
      top.map((t, i) =>
        h(
          'li',
          { key: t.teamId, class: 'transfer-window__money-row' },
          h('span', { class: 'transfer-window__money-rank' }, `${i + 1}`),
          clubLink(t.tag, t.name, goTeam, t.teamId),
          h('span', { class: 'transfer-window__money-val' }, money(t.budget))
        )
      )
    )
  );
}

/** A clickable club chip (tag badge + name); inert without a goTeam handler. */
function clubLink(tag, name, goTeam, teamId) {
  return h(
    'button',
    {
      type: 'button',
      class: 'link transfer-window__club',
      onClick: goTeam && teamId ? () => goTeam(teamId) : undefined,
      title: name
    },
    h('span', { class: 'badge badge--seed' }, tag),
    ' ',
    name
  );
}

/* ------------------------------ helpers ------------------------------ */

/** A titled panel with a sub-line and a body VNode. */
function panel(title, sub, body) {
  return h(
    'section',
    { class: 'panel transfer-window__panel' },
    h(
      'header',
      { class: 'panel__head' },
      h('h2', { class: 'panel__title' }, title),
      sub ? h('span', { class: 'panel__sub' }, sub) : null
    ),
    h('div', { class: 'panel__body' }, body)
  );
}

/** A titled card wrapping a body VNode. */
function card(title, body) {
  return h(
    'div',
    { class: 'card offseason__card' },
    h('h2', { class: 'card__title' }, title),
    body
  );
}

/** An unordered list of strings. */
function list(items) {
  return h('ul', { class: 'offseason__list' }, items.map((t, i) => h('li', { key: i, class: 'offseason__item' }, t)));
}

/** A muted empty-state paragraph. */
function muted(text) {
  return h('p', { class: 'card__muted' }, text);
}
