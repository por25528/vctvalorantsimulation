/**
 * tests/ui/screen-career.test.mjs — P6 career UI (CONTRACTS-CAREER §4).
 *
 * Headless via toHtml. Drives the real store through a full season into the
 * off-season, then renders the new Squad + Off-season screens, checks the router
 * resolves them and the Sidebar exposes Squad, and verifies the v1→v2 save
 * migration adds the career block.
 */

import { assert, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { navigate } from '../../src/state/actions.js';
import { Squad } from '../../src/ui/screens/Squad.js';
import { Offseason } from '../../src/ui/screens/Offseason.js';
import { RouterOutlet } from '../../src/ui/router.js';
import { NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { migrate, SCHEMA_VERSION } from '../../src/persistence/migrations.js';
import {
  selectSeason,
  selectFollowedTeam,
  selectCareerPhase,
  selectSeasonIndex,
  selectOffseasonReport
} from '../../src/state/selectors.js';

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });

  section('Squad — followed team roster with dynamics + contract columns');
  let html = toHtml(Squad(store.getState(), store.dispatch, store));
  assert(html.includes('screen--squad'), 'squad screen renders');
  const team = selectFollowedTeam(store.getState());
  assert(html.includes(team.name), 'squad titles the followed team');
  assert(html.includes('Form') && html.includes('Fatigue') && html.includes('Salary'), 'squad shows dynamics + contract columns');
  assert((html.match(/squad__row/g) || []).length === 5, 'squad lists the 5 starters');
  assert(NAV_ITEMS.some((i) => i.screen === 'squad'), 'sidebar exposes a Squad nav item');

  section('career — play a full season, then resolve the off-season');
  let guard = 0;
  while (!selectSeason(store.getState()).complete && guard++ < 20) continueSeason(store, { simEvent: true });
  assert(selectCareerPhase(store.getState()) === 'offseason', 'a finished season pauses in the off-season phase');
  continueSeason(store, { simEvent: true }); // resolve the off-season -> season 1
  assert(selectSeasonIndex(store.getState()) === 1, 'the career rolled into season 1');
  const report = selectOffseasonReport(store.getState());
  assert(report && Array.isArray(report.newgens) && report.newgens.length > 0, 'an off-season report with newgens is recorded');

  section('Off-season screen renders the report');
  html = toHtml(Offseason(store.getState(), store.dispatch, store));
  assert(html.includes('screen--offseason'), 'off-season screen renders');
  assert(html.includes('Risers') && html.includes('Retirements') && html.includes('Newgens') && html.includes('Signings'), 'report sections present');

  section('router resolves the new career routes');
  store.dispatch(navigate('squad'));
  assert(toHtml(RouterOutlet(store.getState(), store.dispatch, store)).includes('screen--squad'), 'router routes to Squad');
  store.dispatch(navigate('offseason'));
  assert(toHtml(RouterOutlet(store.getState(), store.dispatch, store)).includes('screen--offseason'), 'router routes to Off-season');

  section('persistence — v1 save migrates to v2 with a career block');
  const v1 = {
    meta: { id: 'x', name: 'legacy', schemaVersion: 1, seed: 2026, slotIndex: 0, createdAt: 0, lastPlayed: 0 },
    world: { leagues: {}, teams: {}, players: {} },
    season: { seed: 2026, slotIndex: 8, events: [], complete: true },
    settings: { followedTeamId: null }
  };
  const migrated = migrate(v1);
  assert(migrated.meta.schemaVersion === SCHEMA_VERSION, 'migrated to the current schema version');
  assert(migrated.career && migrated.career.seasonIndex === 0, 'a v1 save becomes season 0 of a career');
  assert(migrated.career.phase === 'offseason', 'a complete v1 season migrates into the off-season phase');
}
