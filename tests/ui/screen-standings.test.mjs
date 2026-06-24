/**
 * tests/ui/screen-standings.test.mjs — the Standings screen, headless via toHtml
 * (CONTRACTS-UI §5, §8).
 *
 * Builds the real store, bootstraps, runs continueSeason (sims the Pacific
 * Kickoff), then renders StandingsScreen(state, dispatch) -> toHtml and asserts:
 *   - 12 placement rows;
 *   - CP 4/3/2/1 sit on the top-4 placements;
 *   - both group standings tables are present;
 *   - the qualification badges (Masters Playoff / Masters Swiss / Eliminated)
 *     render in the right counts (1 playoff, 2 swiss, 9 eliminated).
 *
 * Default-exported async fn that throws on failure (tests/run.mjs convention).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { selectPlacements } from '../../src/state/selectors.js';
import { StandingsScreen } from '../../src/ui/screens/Standings.js';

/** Count non-overlapping occurrences of a substring. */
function countOf(haystack, needle) {
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  continueSeason(store, { simEvent: true });

  const state = store.getState();
  const dispatch = () => {};
  const html = toHtml(StandingsScreen(state, dispatch));

  section('placements table');
  {
    // 12 placement rows: each placement row carries the .placements__rank cell.
    assertEqual(countOf(html, 'placements__rank'), 12, '12 placement rows render');
    assert(html.includes('class="table placements"'), 'placements table present');

    // CP 4/3/2/1 on the top four placements. Verify via the selector + HTML.
    const placements = selectPlacements(state, 'pacific-kickoff');
    assertEqual(placements.length, 12, 'selector yields 12 placements');
    const byRank = new Map(placements.map((p) => [p.rank, p]));
    assertEqual(byRank.get(1).cp, 4, 'rank 1 -> 4 CP');
    assertEqual(byRank.get(2).cp, 3, 'rank 2 -> 3 CP');
    assertEqual(byRank.get(3).cp, 2, 'rank 3 -> 2 CP');
    assertEqual(byRank.get(4).cp, 1, 'rank 4 -> 1 CP');
    for (let r = 5; r <= 12; r++) {
      assertEqual(byRank.get(r).cp, 0, `rank ${r} -> 0 CP`);
    }

    // The CP cells are rendered.
    assert(html.includes('placements__cp'), 'CP column rendered');
  }

  section('qualification badges');
  {
    // Exactly one Masters Playoff (placement 1), two Masters Swiss (2 & 3),
    // and nine Eliminated (placements 4..12).
    assertEqual(countOf(html, 'Masters Playoff'), 1, 'one Masters Playoff badge');
    assertEqual(countOf(html, 'Masters Swiss'), 2, 'two Masters Swiss badges');
    assertEqual(countOf(html, '>Eliminated</span>'), 9, 'nine Eliminated badges');
    assert(html.includes('badge--qual-playoff'), 'playoff badge class present');
    assert(html.includes('badge--qual-swiss'), 'swiss badge class present');
    assert(html.includes('badge--qual-out'), 'eliminated badge class present');
  }

  section('group tables');
  {
    // Both group standings tables present + labeled.
    assert(html.includes('Group A'), 'Group A label present');
    assert(html.includes('Group B'), 'Group B label present');
    // Two StandingsTable instances => two .standings tables.
    assertEqual(countOf(html, 'class="table standings"'), 2, 'two group standings tables');
    // Group tables list the six teams each (W-L cells) — 12 standings rows total.
    assertEqual(countOf(html, 'standings__rank'), 12, '12 group standings rows (6 + 6)');
  }
}
