/**
 * tests/ui/screen-injuries.test.mjs — P7c injury UI surfacing (CONTRACTS-POLISH P7c).
 *
 * Headless via toHtml. Injects an injury onto the followed team and checks the
 * Squad chip + injured-row styling, and that an injury news item renders in the
 * inbox feed with its glyph.
 */

import { assert, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap } from '../../src/state/commands.js';
import { appendNews } from '../../src/state/actions.js';
import { setPlayer } from '../../src/state/slices/world.js';
import { Squad } from '../../src/ui/screens/Squad.js';
import { News } from '../../src/ui/screens/News.js';
import { selectFollowedTeam, selectRoster } from '../../src/state/selectors.js';

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });

  section('Squad — an injured player shows the chip + injured styling');
  const team = selectFollowedTeam(store.getState());
  const roster = selectRoster(store.getState(), team.id);
  const p = roster[0];
  // Healthy first: no chip.
  let html = toHtml(Squad(store.getState(), store.dispatch, store));
  assert(!html.includes('squad__row--injured'), 'no injuries before one is set');

  store.dispatch(setPlayer({ ...p, injury: { weeks: 2, type: 'wrist strain' } }));
  html = toHtml(Squad(store.getState(), store.dispatch, store));
  assert(html.includes('squad__row--injured'), 'the injured row is flagged');
  // The chip is an inline-SVG icon (icons, not emoji), wrapped in .squad__injury.
  assert(html.includes('squad__injury') && html.includes('<svg'), 'the injury chip renders as an icon');
  assert(html.includes('wrist strain') && html.includes('out ~2 events'), 'the chip tooltip describes the injury');

  section('News — an injury item renders with its glyph');
  store.dispatch(appendNews([{ kind: 'injury', seasonIndex: 0, slotId: 'stage1', headline: `${p.handle} picks up a wrist strain — out ~2 events`, teamId: team.id, playerId: p.id, tone: 'bad' }]));
  html = toHtml(News(store.getState(), store.dispatch));
  assert(html.includes('🩹'), 'injury glyph in the feed');
  assert(html.includes('picks up a wrist strain'), 'injury headline in the feed');
  assert(html.includes('news__item--bad'), 'injury news carries the bad tone');
}
