/**
 * ui/screens/TransferMarket.js — MARKET WATCH, read-only (id 'market').
 *
 * Pure `(state, dispatch, store) => VNode`. A spectator's window onto the market
 * around the team the camera is on — nothing to manage, just the state of play to
 * observe as the autonomous AI runs every club's business:
 *   - the club's finances (budget / sponsor / prize / wage bill / net),
 *   - its head coach / GM (if any),
 *   - its ROSTER (the first five are the starters the match engine fields),
 *   - the league-wide FREE-AGENT pool, value-sorted.
 *
 * There are NO actions here: no signing, releasing, buying, lineup changes, or
 * coach hiring. The observer watches; the engine decides. Player names click
 * through to the Player screen. Renders headlessly via toHtml.
 *
 * SIGNATURE / WIRING CONTRACT:
 *   TransferMarket(state, dispatch, store) => VNode
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { overall } from '../../engine/career/playerStats.js';
import { playerValue } from '../../engine/career/offseason/transfers.js';
import { salaryFor } from '../../engine/career/offseason/contracts.js';
import { BALANCE } from '../../config/balance.js';
import {
  selectFollowedTeam,
  selectRoster,
  selectSeasonIndex,
  selectTeamFinances,
  selectTeamAttractiveness
} from '../../state/selectors.js';

const MARKET = BALANCE.CAREER.MARKET;

/** Most free agents to list (the pool grows unbounded over seasons). */
const MAX_FREE_AGENTS_SHOWN = 50;

/** Compact money: 40000 -> "$40k". */
function money(n) {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return `$${Math.round(v / 1000)}k`;
}

/** Contract-expiry label (season-ordinal, 1-based) or an em dash. */
function expiresLabel(contract) {
  return contract && typeof contract.expires === 'number' ? `S${contract.expires + 1}` : '—';
}

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @param {object} [store]
 * @returns {import('../render.js').VNode}
 */
export function TransferMarket(state, dispatch, store) {
  const team = selectFollowedTeam(state);
  const seasonIndex = selectSeasonIndex(state);

  if (!team) {
    return h(
      'section',
      { class: 'screen screen--market', id: 'screen-market' },
      h('h1', { class: 'screen__title' }, 'Market Watch'),
      h('p', { class: 'card__muted' }, 'No team in focus — point the camera at a team to watch its market.')
    );
  }

  const roster = selectRoster(state, team.id);
  const freeAgents = sortedFreeAgents(state);
  const attractiveness = selectTeamAttractiveness(state, team.id);

  return h(
    'section',
    { class: 'screen screen--market', id: 'screen-market' },
    h(
      'header',
      { class: 'screen__head' },
      h('h1', { class: 'screen__title' }, `${team.name} — Market Watch`),
      h('span', { class: 'badge market__season' }, `Season ${seasonIndex + 1}`),
      h('span', { class: 'badge' }, `Roster ${roster.length}/${MARKET.MAX_ROSTER}`),
      h('span', { class: 'badge market__budget' }, `Budget ${money(team.budget)}`),
      h('span', { class: 'badge', title: 'Club prestige — drives sponsorship and pull on talent' }, `Reputation ${Math.round(team.reputation)}`),
      h('span', { class: 'badge', title: 'How appealing this club is to players (prestige + success + money)' }, `Pull ${attractiveness}`)
    ),
    financesPanel(selectTeamFinances(state, team.id)),
    coachPanel(team),
    squadPanel(roster, dispatch),
    freeAgentPanel(freeAgents, freeAgentCount(state))
  );
}

/* ------------------------------ coach -------------------------------- */

/** The head-coach / GM panel — read-only staff card. */
function coachPanel(team) {
  const coach = team.coach || null;
  const body = coach
    ? h(
      'div',
      { class: 'panel__body market__finances' },
      kpi('Coach', coach.name),
      kpi('Coaching', String(coach.rating)),
      kpi('Negotiation', String(coach.negotiation), coach.negotiation >= 70 ? 'good' : undefined),
      kpi('Salary', money(coach.salary))
    )
    : h(
      'div',
      { class: 'panel__body' },
      h('p', { class: 'card__muted' }, 'No head coach. A good GM negotiates cheaper transfer fees and lifts squad chemistry.')
    );
  return h(
    'section',
    { class: 'panel market__panel' },
    h('header', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, 'Head Coach')),
    body
  );
}

/* ----------------------------- finances ------------------------------ */

/** The club's finances: budget + this season's prize, wage bill and net (read-only). */
function financesPanel(f) {
  if (!f) return null;
  const net = f.net;
  return h(
    'section',
    { class: 'panel market__panel' },
    h('header', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, 'Finances')),
    h(
      'div',
      { class: 'panel__body market__finances' },
      kpi('Budget', money(f.budget)),
      kpi('Sponsor', money(f.sponsor)),
      kpi('Prize (season)', money(f.seasonPrize)),
      kpi('Wage bill', money(f.wageBill)),
      kpi('Projected net', (net >= 0 ? '+' : '−') + money(Math.abs(net)), net >= 0 ? 'good' : 'bad')
    )
  );
}

/** A KPI tile (value + label), optionally tinted good/bad. */
function kpi(label, value, tone) {
  return h(
    'div',
    { class: classNames('kpi', tone && `market__kpi--${tone}`) },
    h('span', { class: 'kpi__value' }, value),
    h('span', { class: 'kpi__label' }, label)
  );
}

/* ------------------------------- squad ------------------------------- */

/** The roster panel — read-only; the first five are the starters the engine fields. */
function squadPanel(roster, dispatch) {
  const min = MARKET.MIN_ROSTER;

  const rows = roster.map((p, i) =>
    h(
      'tr',
      { key: p.id, class: classNames('table__row', 'market__squad-row', i < min && 'market__squad-row--starter') },
      h('td', { class: 'table__cell' }, h('span', { class: classNames('badge', i < min ? 'badge--qual' : 'badge--seed') }, i < min ? 'XI' : 'SUB')),
      h(
        'td',
        { class: 'table__cell' },
        h(
          'button',
          { type: 'button', class: 'link', onClick: dispatch ? () => dispatch(navigate('player', { playerId: p.id })) : undefined },
          p.handle || p.name
        )
      ),
      h('td', { class: 'table__cell' }, p.role),
      h('td', { class: 'table__cell table__cell--num' }, String(p.age)),
      h('td', { class: 'table__cell table__cell--num' }, String(Math.round(overall(p)))),
      h('td', { class: 'table__cell table__cell--num' }, String(p.potential)),
      h('td', { class: 'table__cell table__cell--num' }, money(p.contract && p.contract.salary)),
      h('td', { class: 'table__cell table__cell--num' }, expiresLabel(p.contract))
    )
  );

  return panel(
    'Roster',
    `${roster.length} players · first ${min} start`,
    h(
      'table',
      { class: 'table data-table market__table' },
      h(
        'thead',
        { class: 'table__head' },
        h(
          'tr',
          { class: 'table__row' },
          ['', 'Player', 'Role', 'Age', 'OVR', 'POT', 'Salary', 'Expires'].map((hd, i) =>
            h('th', { key: i, class: classNames('table__cell', (i >= 3 && i <= 7) && 'table__cell--num'), scope: 'col' }, hd)
          )
        )
      ),
      h('tbody', null, rows)
    )
  );
}

/* ---------------------------- free agents ---------------------------- */

/** "Free Agents" panel — the unsigned league pool, value-sorted. Read-only. */
function freeAgentPanel(freeAgents, total) {
  if (freeAgents.length === 0) {
    return panel(
      'Free Agents',
      '0 available',
      h('p', { class: 'card__muted' }, 'No free agents on the market. The pool fills after the off-season — released veterans and un-signed newgens land here.')
    );
  }

  const rows = freeAgents.map((p) =>
    h(
      'tr',
      { key: p.id, class: 'table__row market__fa-row' },
      h('td', { class: 'table__cell' }, p.handle || p.name),
      h('td', { class: 'table__cell' }, p.role),
      h('td', { class: 'table__cell table__cell--num' }, String(p.age)),
      h('td', { class: 'table__cell table__cell--num' }, String(Math.round(overall(p)))),
      h('td', { class: 'table__cell table__cell--num' }, String(p.potential)),
      h('td', { class: 'table__cell table__cell--num' }, String(Math.round(playerValue(p)))),
      h('td', { class: 'table__cell table__cell--num' }, money(salaryFor(p)))
    )
  );

  const sub = total > freeAgents.length
    ? `${freeAgents.length} of ${total} shown · top by market value`
    : `${total} available · sorted by market value`;

  return panel(
    'Free Agents',
    sub,
    h(
      'table',
      { class: 'table data-table market__table' },
      h(
        'thead',
        { class: 'table__head' },
        h(
          'tr',
          { class: 'table__row' },
          ['Player', 'Role', 'Age', 'OVR', 'POT', 'Value', 'Asking'].map((hd, i) =>
            h('th', { key: i, class: classNames('table__cell', (i >= 2 && i <= 6) && 'table__cell--num'), scope: 'col' }, hd)
          )
        )
      ),
      h('tbody', null, rows)
    )
  );
}

/* ------------------------------ helpers ------------------------------ */

/** A titled panel with a sub-line and a body VNode. */
function panel(title, sub, body) {
  return h(
    'section',
    { class: 'panel market__panel' },
    h(
      'header',
      { class: 'panel__head' },
      h('h2', { class: 'panel__title' }, title),
      sub ? h('span', { class: 'panel__sub market__panel-sub' }, sub) : null
    ),
    h('div', { class: 'panel__body' }, body)
  );
}

/** Count of all free agents in the world. */
function freeAgentCount(state) {
  const players = (state.world && state.world.players) || {};
  let n = 0;
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (p && p.contract && p.contract.status === 'free_agent') n += 1;
  }
  return n;
}

/** The free-agent pool sorted by market value (desc), capped for display. */
function sortedFreeAgents(state) {
  const players = (state.world && state.world.players) || {};
  const out = [];
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (p && p.contract && p.contract.status === 'free_agent') out.push(p);
  }
  out.sort((a, b) => playerValue(b) - playerValue(a) || (a.id < b.id ? -1 : 1));
  return out.slice(0, MAX_FREE_AGENTS_SHOWN);
}
