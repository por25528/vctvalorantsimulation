/**
 * tests/ui/screen-economy.test.mjs — economy UI, read-only (CONTRACTS-POLISH P7e).
 *
 * Headless via toHtml. The god-observer rework removed the user signing path (and
 * its budget gate); what remains is the read-only Finances panel on Market Watch
 * and the selectTeamFinances selector that feeds it.
 */

import { assert, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap } from '../../src/state/commands.js';
import { TransferMarket } from '../../src/ui/screens/TransferMarket.js';
import { selectFollowedTeam, selectTeamFinances } from '../../src/state/selectors.js';

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const team = selectFollowedTeam(store.getState());

  section('selectTeamFinances + Finances panel render');
  const fin = selectTeamFinances(store.getState(), team.id);
  assert(fin && typeof fin.budget === 'number' && typeof fin.wageBill === 'number', 'finances computed');
  assert(fin.wageBill > 0, 'a rostered team has a wage bill');
  const html = toHtml(TransferMarket(store.getState(), store.dispatch, store));
  assert(html.includes('Finances') && html.includes('Budget') && html.includes('Wage bill') && html.includes('Projected net'), 'finances panel renders');

  section('the panel is read-only — no signing controls');
  assert(!html.includes('>Sign<'), 'no sign control on the economy view');
}
