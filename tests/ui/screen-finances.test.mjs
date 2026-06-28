/**
 * tests/ui/screen-finances.test.mjs — read-only Finances screen (spectator).
 *
 * Headless via toHtml. The god-observer rework removed all GM actions: there is
 * no sell/release/sign. Finances is now a read-only ledger to stare at. Covers:
 *   - Finances screen renders with budget / payroll / sponsor data
 *   - Finances nav item present in Sidebar
 *   - selectPayrollBreakdown and selectTransferBalance selectors
 *   - NO action controls (Sell/Release/Actions) are rendered
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap } from '../../src/state/commands.js';
import { navigate } from '../../src/state/actions.js';
import { FinancesScreen } from '../../src/ui/screens/Finances.js';
import { RouterOutlet } from '../../src/ui/router.js';
import { NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import {
  selectFollowedTeam,
  selectTeamFinances,
  selectPayrollBreakdown,
  selectTransferBalance
} from '../../src/state/selectors.js';

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const team = selectFollowedTeam(store.getState());

  /* ------------------------------------------------------------------ */
  section('Finances nav item in sidebar');
  const finItem = NAV_ITEMS.find((it) => it.screen === 'finances');
  assert(finItem, 'finances nav item exists');
  assertEqual(finItem.icon, 'finance', 'uses the finance icon');

  /* ------------------------------------------------------------------ */
  section('Finances screen renders key sections');
  store.dispatch(navigate('finances'));
  const html = toHtml(FinancesScreen(store.getState(), store.dispatch, store));
  assert(html.includes('Finances'), 'title renders');
  assert(html.includes('Budget'), 'budget section renders');
  assert(html.includes('Sponsor'), 'sponsor income renders');
  assert(html.includes('Wage bill') || html.includes('Payroll'), 'payroll section renders');

  /* ------------------------------------------------------------------ */
  section('Finances is read-only — no GM action controls');
  assert(!html.includes('>Release<'), 'no release button');
  assert(!html.includes('>Sell<'), 'no sell button');
  assert(!html.includes('>Actions<'), 'no actions column');

  /* ------------------------------------------------------------------ */
  section('Finances screen via RouterOutlet');
  const routeHtml = toHtml(RouterOutlet(store.getState(), store.dispatch, store));
  assert(routeHtml.includes('Finances'), 'RouterOutlet resolves finances route');

  /* ------------------------------------------------------------------ */
  section('selectPayrollBreakdown');
  const payroll = selectPayrollBreakdown(store.getState(), team.id);
  assert(Array.isArray(payroll) && payroll.length > 0, 'payroll is non-empty for a rostered team');
  // Sorted by salary descending
  for (let i = 1; i < payroll.length; i++) {
    assert(payroll[i].salary <= payroll[i - 1].salary, `payroll row ${i} sorted by salary desc`);
  }
  assert(typeof payroll[0].player === 'object', 'each row has a player object');
  assert(typeof payroll[0].salary === 'number', 'each row has a salary');

  /* ------------------------------------------------------------------ */
  section('selectTransferBalance — empty at start');
  const bal0 = selectTransferBalance(store.getState(), team.id);
  assertEqual(bal0.received, 0, 'no fees received at window open');
  assertEqual(bal0.spent, 0, 'no fees spent at window open');
  assertEqual(bal0.net, 0, 'net is zero at window open');

  /* ------------------------------------------------------------------ */
  section('selectTeamFinances includes expected fields');
  const fin = selectTeamFinances(store.getState(), team.id);
  assert(fin && typeof fin.budget === 'number', 'budget present');
  assert(typeof fin.wageBill === 'number' && fin.wageBill > 0, 'wage bill > 0 for rostered team');
  assert(typeof fin.sponsor === 'number' && fin.sponsor > 0, 'sponsor income > 0');
}
