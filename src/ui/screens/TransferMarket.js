/**
 * ui/screens/TransferMarket.js — squad management + the transfer market
 * (CONTRACTS-CAREER §4, id 'market').
 *
 * Pure `(state, dispatch, store) => VNode`. The one interactive career screen:
 * the manager runs their followed team's roster here. It shows
 *   - YOUR SQUAD: every rostered player with role/age/overall/contract, lineup
 *     controls (the first five are the starters the match engine fields, so
 *     ▲/▼ promote/bench), an Extend offer, and a Release (kept ≥ MIN_ROSTER),
 *   - FREE AGENTS: the unsigned pool sorted by market value, each Sign-able onto
 *     the bench while there's room (≤ MAX_ROSTER),
 *   - WINDOW MOVES: the log of moves brokered since the window opened.
 *
 * All buttons call the engine-touching commands (signPlayer / releasePlayer /
 * offerContract / moveRosterPlayer) via the forwarded `store`. With no `store`
 * (headless render-only tests) the buttons render inert — the view still
 * serializes via toHtml.
 *
 * SIGNATURE / WIRING CONTRACT:
 *   TransferMarket(state, dispatch, store) => VNode
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import {
  signPlayer,
  releasePlayer,
  offerContract,
  moveRosterPlayer,
  buyPlayer,
  hireCoach,
  fireCoach
} from '../../state/commands.js';
import { overall } from '../../engine/career/playerStats.js';
import { playerValue } from '../../engine/career/offseason/transfers.js';
import { salaryFor } from '../../engine/career/offseason/contracts.js';
import { BALANCE } from '../../config/balance.js';
import {
  selectFollowedTeam,
  selectRoster,
  selectSeasonIndex,
  selectTransferMoves,
  selectTeamFinances,
  selectTeamAttractiveness,
  selectBuyTargets
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
      h('h1', { class: 'screen__title' }, 'Transfer Market'),
      h('p', { class: 'card__muted' }, 'No team followed yet.')
    );
  }

  const roster = selectRoster(state, team.id);
  const moves = selectTransferMoves(state);
  const freeAgents = sortedFreeAgents(state);
  const rosterFull = roster.length >= MARKET.MAX_ROSTER;
  const attractiveness = selectTeamAttractiveness(state, team.id);
  const buyTargets = selectBuyTargets(state, team.id, 24);

  return h(
    'section',
    { class: 'screen screen--market', id: 'screen-market' },
    h(
      'header',
      { class: 'screen__head' },
      h('h1', { class: 'screen__title' }, `${team.name} — Transfer Market`),
      h('span', { class: 'badge market__season' }, `Season ${seasonIndex + 1}`),
      h('span', { class: classNames('badge', rosterFull && 'badge--cp') }, `Roster ${roster.length}/${MARKET.MAX_ROSTER}`),
      h('span', { class: 'badge market__budget' }, `Budget ${money(team.budget)}`),
      h('span', { class: 'badge', title: 'Club prestige — drives sponsorship and pull on talent' }, `Reputation ${Math.round(team.reputation)}`),
      h('span', { class: 'badge', title: 'How appealing your club is to players (prestige + success + money)' }, `Pull ${attractiveness}`)
    ),
    financesPanel(selectTeamFinances(state, team.id)),
    coachPanel(team, store),
    squadPanel(roster, store, dispatch),
    buyTargetsPanel(buyTargets, rosterFull, team, store),
    freeAgentPanel(freeAgents, freeAgentCount(state), rosterFull, team, store),
    movesPanel(moves)
  );
}

/* ------------------------------ coach -------------------------------- */

/** The head-coach / GM panel — current staff + hire/dismiss (P13). */
function coachPanel(team, store) {
  const coach = team.coach || null;
  const body = coach
    ? h(
      'div',
      { class: 'panel__body market__finances' },
      kpi('Coach', coach.name),
      kpi('Coaching', String(coach.rating)),
      kpi('Negotiation', String(coach.negotiation), coach.negotiation >= 70 ? 'good' : undefined),
      kpi('Salary', money(coach.salary)),
      h(
        'div',
        { class: 'market__actions' },
        actionBtn('Replace', 'Dismiss and hire a new coach', !!store, () => { if (store) { fireCoach(store, team.id); hireCoach(store, team.id); } }),
        actionBtn('Dismiss', 'Dismiss the coach', !!store, () => fireCoach(store, team.id), 'market__release')
      )
    )
    : h(
      'div',
      { class: 'panel__body' },
      h('p', { class: 'card__muted' }, 'No head coach. A good GM negotiates cheaper transfer fees and lifts squad chemistry.'),
      h('div', { class: 'market__actions' }, actionBtn('Hire Coach', 'Hire a head coach / GM', !!store, () => hireCoach(store, team.id), 'btn--primary'))
    );
  return h(
    'section',
    { class: 'panel market__panel' },
    h('header', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, 'Head Coach')),
    body
  );
}

/* -------------------------- transfer targets ------------------------- */

/** Contracted players at other clubs the manager can BUY for a fee (P13). */
function buyTargetsPanel(targets, rosterFull, team, store) {
  if (!targets || targets.length === 0) {
    return panel('Transfer Targets', 'none', h('p', { class: 'card__muted' }, 'No contracted players to bid for right now.'));
  }
  const budget = Number(team.budget) || 0;
  const rows = targets.map(({ player: p, seller, fee, wage }) => {
    const affordable = !rosterFull && fee <= budget && budget - fee >= wage;
    const why = rosterFull ? `Roster full (${MARKET.MAX_ROSTER} max)` : fee > budget ? "Fee exceeds your budget" : budget - fee < wage ? "Can't carry the wage after the fee" : `Bid ${money(fee)} to sign ${p.handle || p.name}`;
    return h(
      'tr',
      { key: p.id, class: 'table__row market__fa-row' },
      h('td', { class: 'table__cell' }, p.handle || p.name),
      h('td', { class: 'table__cell' }, p.role),
      h('td', { class: 'table__cell table__cell--num' }, String(Math.round(overall(p)))),
      h('td', { class: 'table__cell' }, seller.name),
      h('td', { class: 'table__cell table__cell--num' }, money(fee)),
      h('td', { class: 'table__cell table__cell--num' }, money(wage)),
      h('td', { class: 'table__cell market__actions' }, actionBtn('Buy', why, store && affordable, () => buyPlayer(store, p.id), 'btn--primary'))
    );
  });
  return panel(
    'Transfer Targets',
    `${targets.length} listed · fees reflect your coach`,
    h(
      'table',
      { class: 'table data-table market__table' },
      h('thead', { class: 'table__head' }, h('tr', { class: 'table__row' },
        ['Player', 'Role', 'OVR', 'Club', 'Fee', 'Wage', ''].map((hd, i) =>
          h('th', { key: i, class: classNames('table__cell', (i >= 2 && i <= 5) && 'table__cell--num'), scope: 'col' }, hd)))),
      h('tbody', null, rows)
    )
  );
}

/* ----------------------------- finances ------------------------------ */

/** The club's finances: budget + this season's prize, wage bill and net (P7e). */
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

/** "Your Squad" panel — roster with lineup controls + Extend / Release. */
function squadPanel(roster, store, dispatch) {
  const min = MARKET.MIN_ROSTER;
  const canRelease = roster.length > min;

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
      h('td', { class: 'table__cell table__cell--num' }, expiresLabel(p.contract)),
      h(
        'td',
        { class: 'table__cell market__actions' },
        actionBtn('▲', 'Promote toward the starting five', store && i > 0, () => moveRosterPlayer(store, p.id, -1)),
        actionBtn('▼', 'Bench', store && i < roster.length - 1, () => moveRosterPlayer(store, p.id, +1)),
        actionBtn('Extend', 'Offer a contract extension', !!store, () => offerContract(store, p.id)),
        actionBtn('Release', canRelease ? 'Release to free agency' : `Roster can't drop below ${min}`, store && canRelease, () => releasePlayer(store, p.id), 'market__release')
      )
    )
  );

  return panel(
    'Your Squad',
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
          ['', 'Player', 'Role', 'Age', 'OVR', 'POT', 'Salary', 'Expires', 'Actions'].map((hd, i) =>
            h('th', { key: i, class: classNames('table__cell', (i >= 3 && i <= 7) && 'table__cell--num'), scope: 'col' }, hd)
          )
        )
      ),
      h('tbody', null, rows)
    )
  );
}

/* ---------------------------- free agents ---------------------------- */

/** "Free Agents" panel — the unsigned pool, value-sorted, each Sign-able. */
function freeAgentPanel(freeAgents, total, rosterFull, team, store) {
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
      h('td', { class: 'table__cell table__cell--num' }, money(salaryFor(p))),
      h(
        'td',
        { class: 'table__cell market__actions' },
        actionBtn('Sign', rosterFull ? `Roster full (${MARKET.MAX_ROSTER} max)` : `Sign to ${team.name}`, store && !rosterFull, () => signPlayer(store, p.id), 'btn--primary')
      )
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
          ['Player', 'Role', 'Age', 'OVR', 'POT', 'Value', 'Asking', ''].map((hd, i) =>
            h('th', { key: i, class: classNames('table__cell', (i >= 2 && i <= 6) && 'table__cell--num'), scope: 'col' }, hd)
          )
        )
      ),
      h('tbody', null, rows)
    )
  );
}

/* ------------------------------ moves -------------------------------- */

/** "Window Moves" panel — the brokered-move log for this window. */
function movesPanel(moves) {
  if (!moves || moves.length === 0) {
    return panel('Window Moves', 'none yet', h('p', { class: 'card__muted' }, 'Moves you make this window appear here.'));
  }
  const items = moves
    .slice()
    .reverse()
    .map((m, i) => h('li', { key: i, class: classNames('market__move', `market__move--${m.kind}`) }, moveLabel(m)));
  return panel('Window Moves', `${moves.length} this window`, h('ul', { class: 'market__moves' }, items));
}

/** Human label for a logged Move. */
function moveLabel(m) {
  const name = m.name || m.playerId;
  if (m.kind === 'release') return `Released ${name}`;
  if (m.kind === 'renew') return `Extended ${name} (${money(m.salary)})`;
  if (m.kind === 'transfer') return `Bought ${name} (${money(m.fee)} fee, ${money(m.salary)} wage)`;
  return `Signed ${name} (${money(m.salary)})`;
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

/** A compact action button (inert + dimmed when `enabled` is falsy). */
function actionBtn(label, title, enabled, onClick, extra) {
  return h(
    'button',
    {
      type: 'button',
      class: classNames('btn', 'btn--sm', extra, !enabled && 'btn--disabled'),
      title,
      disabled: enabled ? undefined : true,
      onClick: enabled ? onClick : undefined
    },
    label
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
