/**
 * tests/ui/screen-transfers-p13.test.mjs — Market Watch coach + badges, read-only.
 *
 * The god-observer rework removed the user-facing transfer depth (coach
 * hire/dismiss, buying contracted players). What remains is observation: the
 * coach card, finances, and reputation/pull badges render, and there are NO
 * action controls. Headless via toHtml.
 */

import { assert, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap } from '../../src/state/commands.js';
import { TransferMarket } from '../../src/ui/screens/TransferMarket.js';
import { selectFollowedTeam } from '../../src/state/selectors.js';

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const team = selectFollowedTeam(store.getState());

  section('Market Watch renders the read-only coach panel & badges');
  const html = toHtml(TransferMarket(store.getState(), store.dispatch, store));
  assert(html.includes('Head Coach'), 'coach panel renders');
  assert(html.includes('Finances'), 'finances panel renders');
  assert(html.includes('Reputation') && html.includes('Pull'), 'reputation & pull badges render');

  section('every club is seeded with a head coach');
  assert(team.coach && typeof team.coach.negotiation === 'number', 'the followed club has a coach with a negotiation rating');

  section('no GM controls — pure observation');
  assert(!html.includes('Hire Coach'), 'no hire-coach control');
  assert(!html.includes('>Dismiss<') && !html.includes('>Replace<'), 'no coach dismiss/replace controls');
  assert(!html.includes('Transfer Targets'), 'no buy-targets panel');
  assert(!html.includes('>Buy<'), 'no buy control');
}
