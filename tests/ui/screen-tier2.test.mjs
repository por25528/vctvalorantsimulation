/**
 * tests/ui/screen-tier2.test.mjs — Tier-2 (Challengers) screen + selector
 *
 * Targeted tests for the new T2 surface:
 *   1. Selector (selectT2Standings): pre-season empty state; post-season data
 *      shape; per-region team count; standings sorted by CP desc; CP=0 teams
 *      still present (all 12 per region appear).
 *   2. Screen (Tier2Screen): empty-state render (no crash, has title); mid-season
 *      render (standings tables, region filter, promo-zone markers); region filter
 *      narrows to the correct section.
 *   3. Router: 'tier2' route is registered; the screen id export is correct.
 *   4. Sidebar: 'tier2' nav item is in NAV_ITEMS.
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { selectT2Standings, selectSeason } from '../../src/state/selectors.js';
import { Tier2Screen, id as tier2Id } from '../../src/ui/screens/Tier2.js';
import { ROUTES } from '../../src/ui/router.js';
import { NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { BALANCE } from '../../src/config/balance.js';
import { TIER2_TEAMS_BY_REGION, TIER2_REGION_ORDER } from '../../src/data/seed/tier2.js';

const REGIONS = TIER2_REGION_ORDER;
const TEAMS_PER_REGION = BALANCE.CAREER.TIER2.TEAMS_PER_REGION;
const PROMOTE_PER_REGION = BALANCE.CAREER.TIER2.PROMOTE_PER_REGION;

export default async function screenTier2Test() {
  section('ui/screen-tier2 — registration');

  // Screen id export
  assertEqual(tier2Id, 'tier2', "Tier2Screen exports id 'tier2'");

  // Router registration
  assert(typeof ROUTES.tier2 === 'function', "ROUTES['tier2'] is registered");
  assert(ROUTES.tier2 === Tier2Screen, "ROUTES['tier2'] points to Tier2Screen");

  // Sidebar registration
  const navItem = NAV_ITEMS.find((item) => item.screen === 'tier2');
  assert(navItem != null, "NAV_ITEMS contains a 'tier2' entry");
  assert(typeof navItem.label === 'string' && navItem.label.length > 0, 'tier2 nav item has a label');
  assert(typeof navItem.icon === 'string', 'tier2 nav item has an icon');

  section('ui/screen-tier2 — selectT2Standings: pre-season empty state');

  const store = buildStore();
  await bootstrap(store, { fresh: true });
  let state = store.getState();

  const preResult = selectT2Standings(state);
  assert(!preResult.hasData, 'selectT2Standings returns hasData=false before any T2 event');
  assertEqual(typeof preResult.byRegion, 'object', 'byRegion is an object even pre-season');

  section('ui/screen-tier2 — Tier2Screen: empty state renders without crash');

  {
    const html = toHtml(Tier2Screen(state, store.dispatch));
    assert(html.includes('Challengers'), 'empty-state screen has title "Challengers"');
    assert(html.includes('screen__empty'), 'empty-state screen shows the empty placeholder');
    assert(!html.includes('t2-standings'), 'empty-state screen renders no standings table');
  }

  section('ui/screen-tier2 — play a regional slot and verify standings');

  // Advance exactly ONE slot so at least one T2 event runs (the first REGIONAL
  // slot simulates all four T2 leagues; standings should then be non-empty).
  // Guard: the first slot should always be regional; advance until T2 has data.
  let guard = 0;
  while (!selectT2Standings(store.getState()).hasData && guard < 10) {
    continueSeason(store, { simEvent: true });
    guard += 1;
  }
  state = store.getState();
  const afterSlot = selectT2Standings(state);
  assert(afterSlot.hasData, `selectT2Standings hasData after ${guard} slots`);

  // Shape: all four regions present.
  assertEqual(Object.keys(afterSlot.byRegion).sort(), [...REGIONS].sort(), 'all four regions in byRegion');

  for (const region of REGIONS) {
    const rows = afterSlot.byRegion[region];
    assert(Array.isArray(rows), `byRegion[${region}] is an array`);
    assertEqual(rows.length, TEAMS_PER_REGION, `${region}: exactly ${TEAMS_PER_REGION} teams`);

    // Every team in the seed data appears in standings (even those with CP 0).
    const seedIds = new Set((TIER2_TEAMS_BY_REGION[region] || []).map((m) => m.id));
    for (const row of rows) {
      assert(seedIds.has(row.teamId), `${region}: ${row.teamId} is a known T2 team`);
      assert(typeof row.teamName === 'string' && row.teamName.length > 0, `${region}: ${row.teamId} has a name`);
      assert(typeof row.teamTag === 'string' && row.teamTag.length > 0, `${region}: ${row.teamId} has a tag`);
      assert(typeof row.cp === 'number' && row.cp >= 0, `${region}: ${row.teamId} has non-negative CP`);
      assert(typeof row.rank === 'number' && row.rank >= 1, `${region}: ${row.teamId} has a rank`);
    }

    // Standings are sorted CP desc (ties broken by teamId asc).
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      assert(
        prev.cp > curr.cp || (prev.cp === curr.cp && prev.teamId <= curr.teamId),
        `${region}: rows[${i - 1}].cp >= rows[${i}].cp (or tiebreak)`
      );
    }

    // Ranks are 1..N consecutive.
    for (let i = 0; i < rows.length; i++) {
      assertEqual(rows[i].rank, i + 1, `${region}: row ${i} has rank ${i + 1}`);
    }
  }

  section('ui/screen-tier2 — Tier2Screen: mid-season render');

  const html = toHtml(Tier2Screen(state, store.dispatch));

  // Title + subtitle present.
  assert(html.includes('Challengers'), 'screen title present');
  assert(html.includes('screen__subtitle'), 'screen subtitle present');

  // Region filter bar present with all chips.
  assert(html.includes('t2__filters'), 'region filter bar rendered');
  for (const region of REGIONS) {
    const label = region === 'emea' ? 'EMEA' : region.charAt(0).toUpperCase() + region.slice(1);
    assert(html.includes(`>${label}<`), `filter chip for ${label} rendered`);
  }

  // All four region sections (each has a h2 with the region label).
  for (const region of REGIONS) {
    const label = region === 'emea' ? 'EMEA' : region.charAt(0).toUpperCase() + region.slice(1);
    assert(html.includes(label), `${region} section heading rendered`);
  }

  // Standings tables exist.
  assert(html.includes('t2-standings'), 'at least one t2-standings table rendered');

  // Promo-zone rows: each region should have PROMOTE_PER_REGION rows marked.
  const promoBadges = (html.match(/t2__promo-badge/g) || []).length;
  assert(
    promoBadges >= PROMOTE_PER_REGION * REGIONS.length,
    `at least ${PROMOTE_PER_REGION * REGIONS.length} promo-zone badges rendered (got ${promoBadges})`
  );

  // Known team tags appear in the HTML.
  for (const region of REGIONS) {
    const firstTeamTag = (TIER2_TEAMS_BY_REGION[region] || [])[0] && TIER2_TEAMS_BY_REGION[region][0].tag;
    if (firstTeamTag) {
      // At least some team tags from each region should appear (those with CP may
      // not be in the first few rows, but all are rendered in the "all" view).
      const rows = afterSlot.byRegion[region] || [];
      const topTag = rows[0] && rows[0].teamTag;
      if (topTag) assert(html.includes(`>${topTag}<`), `top-CP team tag '${topTag}' in ${region} visible`);
    }
  }

  section('ui/screen-tier2 — region filter selects one section');

  // When rendered with a pacific route param, only the Pacific section is shown.
  const pacState = withRoute(state, 'tier2', { region: 'pacific' });
  const pacHtml = toHtml(Tier2Screen(pacState, store.dispatch));

  assert(pacHtml.includes('Pacific'), 'pacific-filtered view shows Pacific heading');
  // Americas/EMEA/China sections NOT rendered.
  const pacRows = (pacHtml.match(/t2-standings/g) || []).length;
  assertEqual(pacRows, 1, 'pacific filter renders exactly one standings table');

  // Teams in the pacific view should all be pacific teams.
  const pacIds = new Set((TIER2_TEAMS_BY_REGION['pacific'] || []).map((m) => m.id));
  const rows = afterSlot.byRegion['pacific'] || [];
  for (const row of rows) {
    assert(pacIds.has(row.teamId), `pacific filter: ${row.teamId} is a pacific team`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `ui/screen-tier2: selector OK (${TEAMS_PER_REGION * REGIONS.length} teams, all regions); ` +
    `empty state OK; mid-season render OK (${promoBadges} promo badges); ` +
    `region filter OK. Router + sidebar registered.`
  );
}

/** Shallow-clone state with a different ui.route (screen + params). */
function withRoute(state, screen, params) {
  return { ...state, ui: { ...state.ui, route: { screen, params } } };
}
