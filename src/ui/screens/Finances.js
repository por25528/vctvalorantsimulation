/**
 * ui/screens/Finances.js — a club's books, read-only (id 'finances').
 *
 * Pure `(state, dispatch, store) => VNode`. A spectator's window into the
 * currently-viewed club's finances — nothing to manage, just numbers to stare
 * at as the autonomous world runs:
 *   - Current budget reserve
 *   - Projected season income (sponsor + prize) and wage bill
 *   - Per-player payroll breakdown (salary + contract length)
 *   - Transfer-window balance (fees received vs. fees spent this window)
 *
 * No GM actions: the observer does not sell, release, or manage anyone — every
 * roster move is the engine's. This is a ledger to read, not a control panel.
 */

import { h, classNames } from '../render.js';
import {
  selectFollowedTeam,
  selectTeamFinances,
  selectPayrollBreakdown,
  selectTransferBalance,
  selectSeasonIndex
} from '../../state/selectors.js';

/** Compact money: 40000 -> "$40k". */
function money(n) {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return `$${Math.round(v / 1000)}k`;
}

/** Contract-expiry label (1-based season ordinal). */
function expiresLabel(expires) {
  return typeof expires === 'number' ? `S${expires + 1}` : '—';
}

/** Positive or negative class for a net figure. */
function netClass(n) {
  return classNames('finances__net', n >= 0 ? 'finances__net--pos' : 'finances__net--neg');
}

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @param {object} [store]
 * @returns {import('../render.js').VNode}
 */
export function FinancesScreen(state, dispatch, store) {
  const team = selectFollowedTeam(state);

  if (!team) {
    return h(
      'section',
      { class: 'screen screen--finances', id: 'screen-finances' },
      h('h1', { class: 'screen__title' }, 'Finances'),
      h('p', { class: 'card__muted' }, 'No team followed yet.')
    );
  }

  const finances = selectTeamFinances(state, team.id);
  const payroll = selectPayrollBreakdown(state, team.id);
  const tBal = selectTransferBalance(state, team.id);
  const seasonIndex = selectSeasonIndex(state);

  return h(
    'section',
    { class: 'screen screen--finances', id: 'screen-finances' },
    h('h1', { class: 'screen__title' }, `Finances — ${team.name}`),

    // Budget summary card
    h(
      'div',
      { class: 'card finances__summary' },
      h('h2', { class: 'card__title' }, 'Season Budget'),
      h(
        'div',
        { class: 'finances__summary-grid' },
        summaryItem('Budget reserve', money(finances ? finances.budget : 0), 'finances__budget'),
        summaryItem('Sponsor income', money(finances ? finances.sponsor : 0)),
        summaryItem('Prize earned', money(finances ? finances.seasonPrize : 0)),
        summaryItem('Wage bill', money(finances ? finances.wageBill : 0)),
        h(
          'div',
          { class: classNames('finances__summary-item', 'finances__summary-item--wide') },
          h('span', { class: 'finances__label' }, 'Projected net'),
          h('span', { class: netClass(finances ? finances.net : 0) }, money(finances ? finances.net : 0))
        )
      )
    ),

    // Transfer-window balance
    tBal && (tBal.received > 0 || tBal.spent > 0)
      ? h(
          'div',
          { class: 'card finances__transfers' },
          h('h2', { class: 'card__title' }, 'Transfer Window'),
          h(
            'div',
            { class: 'finances__summary-grid' },
            summaryItem('Fees received', money(tBal.received)),
            summaryItem('Fees spent', money(tBal.spent)),
            h(
              'div',
              { class: classNames('finances__summary-item', 'finances__summary-item--wide') },
              h('span', { class: 'finances__label' }, 'Window net'),
              h('span', { class: netClass(tBal.net) }, money(tBal.net))
            )
          )
        )
      : null,

    // Payroll breakdown
    h(
      'div',
      { class: 'card finances__payroll' },
      h('h2', { class: 'card__title' }, `Payroll — ${payroll.length} players`),
      payroll.length === 0
        ? h('p', { class: 'card__muted' }, 'No roster data.')
        : h(
            'table',
            { class: 'data-table finances__payroll-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', { class: 'col-player' }, 'Player'),
                h('th', { class: 'col-role' }, 'Role'),
                h('th', { class: 'col-salary' }, 'Salary'),
                h('th', { class: 'col-expires' }, 'Contract')
              )
            ),
            h('tbody', null, payroll.map((row) => payrollRow(row, seasonIndex)))
          )
    )
  );
}

/** A single summary key-value pair. */
function summaryItem(label, value, extraClass) {
  return h(
    'div',
    { class: classNames('finances__summary-item', extraClass) },
    h('span', { class: 'finances__label' }, label),
    h('span', { class: 'finances__value' }, value)
  );
}

/** One payroll row: read-only player + salary + contract info. */
function payrollRow(row, seasonIndex) {
  const { player, salary, expires } = row;
  const label = player.handle || player.name || player.id;
  const isExpiring = typeof expires === 'number' && expires <= seasonIndex + 1;

  return h(
    'tr',
    { key: player.id, class: classNames('finances__payroll-row', isExpiring && 'finances__payroll-row--expiring') },
    h('td', { class: 'col-player' }, label),
    h('td', { class: 'col-role' }, player.role || ''),
    h('td', { class: 'col-salary finances__salary' }, money(salary)),
    h(
      'td',
      { class: classNames('col-expires', isExpiring && 'finances__expiring-tag') },
      expiresLabel(expires),
      isExpiring ? h('span', { class: 'badge badge--warn finances__expiry-badge' }, 'Exp') : null
    )
  );
}
