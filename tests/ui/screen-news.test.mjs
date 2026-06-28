/**
 * tests/ui/screen-news.test.mjs — P7b News inbox integration (CONTRACTS-POLISH P7b).
 *
 * Headless via toHtml. Drives the real store: bootstrap (empty feed) → play slots
 * (news accumulates) → render the News screen + Home card + Sidebar badge → mark
 * read → persistence round-trip preserves the inbox → v2→v3 migration adds it.
 */

import { assert, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason, exportCurrent, importSave } from '../../src/state/commands.js';
import { navigate, markNewsRead } from '../../src/state/actions.js';
import { News } from '../../src/ui/screens/News.js';
import { HomeInbox } from '../../src/ui/screens/HomeInbox.js';
import { Sidebar } from '../../src/ui/components/Sidebar.js';
import { RouterOutlet } from '../../src/ui/router.js';
import { NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { migrate, SCHEMA_VERSION } from '../../src/persistence/migrations.js';
import { selectInbox, selectUnreadNews, selectSeason } from '../../src/state/selectors.js';

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });

  section('News — empty before play');
  assert(selectInbox(store.getState()).length === 0, 'fresh career has an empty inbox');
  let html = toHtml(News(store.getState(), store.dispatch));
  assert(html.includes('screen--news') && html.includes('The world is quiet'), 'world feed empty-state renders');

  section('News — accumulates as slots are played');
  continueSeason(store, { simEvent: true }); // Kickoff slot (4 regional events)
  const afterKickoff = selectInbox(store.getState());
  assert(afterKickoff.length > 0, 'playing a slot produced news');
  assert(afterKickoff.every((i) => typeof i.id === 'string' && i.read === false), 'items stamped with id + unread');
  assert(afterKickoff.some((i) => i.kind === 'result' && /win Kickoff/.test(i.headline)), 'a Kickoff winner headline appeared');
  assert(selectUnreadNews(store.getState()) === afterKickoff.length, 'all new items count as unread');

  section('News screen + Home card + Sidebar badge render');
  html = toHtml(News(store.getState(), store.dispatch));
  assert(html.includes('news__feed') && html.includes('new'), 'feed + unread badge render');
  assert(toHtml(HomeInbox(store.getState(), store.dispatch, store)).includes('Latest News'), 'home shows a Latest News card');
  const sidebarHtml = toHtml(Sidebar({ route: { screen: 'home' }, unread: selectUnreadNews(store.getState()) }));
  assert(sidebarHtml.includes('sidebar__badge'), 'sidebar shows an unread badge');
  assert(NAV_ITEMS.some((i) => i.screen === 'news'), 'sidebar exposes an Inbox nav item');

  section('mark all read clears the unread state');
  store.dispatch(markNewsRead());
  assert(selectUnreadNews(store.getState()) === 0, 'all items marked read');
  assert(!toHtml(Sidebar({ route: { screen: 'home' }, unread: selectUnreadNews(store.getState()) })).includes('sidebar__badge'), 'badge gone when nothing unread');

  section('champion + award news at season end');
  let guard = 0;
  while (!selectSeason(store.getState()).complete && guard++ < 20) continueSeason(store, { simEvent: true });
  const feed = selectInbox(store.getState());
  assert(feed.some((i) => i.kind === 'champion'), 'a world-champion headline was generated');
  assert(feed.some((i) => i.kind === 'award' && /Season MVP/.test(i.headline)), 'a Season MVP award item was generated');

  section('off-season news after the break');
  continueSeason(store, { simEvent: true }); // resolve off-season
  const feed2 = selectInbox(store.getState());
  assert(feed2.some((i) => i.kind === 'retirement' || i.kind === 'transfer' || i.kind === 'newgen'), 'off-season produced transfer/retirement/newgen news');

  section('persistence — the inbox round-trips through export/import');
  const before = selectInbox(store.getState());
  const json = exportCurrent(store);
  const store2 = buildStore();
  importSave(store2, json);
  const after = selectInbox(store2.getState());
  assert(after.length === before.length, 'inbox length preserved across export/import');
  assert(after[0].headline === before[0].headline, 'inbox content preserved');

  section('router + v2->v3 migration');
  store.dispatch(navigate('news'));
  assert(toHtml(RouterOutlet(store.getState(), store.dispatch, store)).includes('screen--news'), 'router routes to News');
  const v2 = {
    meta: { id: 'x', name: 'legacy2', schemaVersion: 2, seed: 2026, slotIndex: 0, createdAt: 0, lastPlayed: 0 },
    world: { leagues: {}, teams: {}, players: {} },
    season: { seed: 2026, slotIndex: 0, events: [], complete: false },
    career: { seed: 2026, seasonIndex: 0, history: [], offseason: null, phase: 'inSeason' },
    settings: { followedTeamId: null }
  };
  const migrated = migrate(v2);
  assert(migrated.meta.schemaVersion === SCHEMA_VERSION, 'migrated to current schema');
  assert(Array.isArray(migrated.inbox) && migrated.inbox.length === 0, 'v2->v3 adds an empty inbox');
}
