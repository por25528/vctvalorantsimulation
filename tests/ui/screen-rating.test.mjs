/**
 * tests/ui/screen-rating.test.mjs — HLTV-style player Rating 2.0 + the team
 * world ranking (Elo). Covers the pure rating math, the leaders/rankings
 * selectors, and the Rankings/Leaders screens. Headless via toHtml + the real
 * store. Default-exported async fn (run.mjs).
 */

import { assert } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { mapRating, aggregateRating } from '../../src/engine/career/rating.js';
import { RankingsScreen } from '../../src/ui/screens/Rankings.js';
import { StatsLeadersScreen } from '../../src/ui/screens/StatsLeaders.js';
import { navigate } from '../../src/state/actions.js';
import { selectLeaders, selectTeamRatings, selectTeamRank } from '../../src/state/selectors.js';

export default async function run() {
  /* ----------------------------- rating math ------------------------------ */
  const avg = mapRating({ kills: 16, deaths: 16, assists: 5, kast: 0.7, adr: 130 }, 24);
  assert(avg > 0.8 && avg < 1.2, `an average line rates near 1.0 (got ${avg})`);

  const star = mapRating({ kills: 28, deaths: 14, assists: 6, kast: 0.82, adr: 175 }, 24);
  const weak = mapRating({ kills: 8, deaths: 20, assists: 3, kast: 0.55, adr: 70 }, 24);
  assert(star > avg && avg > weak, 'rating is monotonic: star > average > weak');
  assert(star > 1.2 && weak < 0.85, `spread looks HLTV-like (star ${star}, weak ${weak})`);
  assert(mapRating(null, 24) === 0, 'a null line rates 0');
  assert(aggregateRating([]).rating === 0, 'no maps aggregates to 0');

  /* --------------------- leaders carry a centred rating ------------------- */
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  const st = () => store.getState();
  continueSeason(store, { simEvent: true }); // Kickoff (all regions)
  continueSeason(store, { simEvent: true }); // Masters One (cross-region)

  const lead = selectLeaders(st(), 'kickoff-pacific', Infinity).filter((r) => r.maps >= 6);
  assert(lead.length > 0, 'leaders resolved');
  assert(lead.every((r) => typeof r.rating === 'number'), 'every leader carries a Rating 2.0');
  const mean = lead.reduce((a, r) => a + r.rating, 0) / lead.length;
  assert(mean > 0.9 && mean < 1.1, `player ratings centre near 1.0 (mean ${mean.toFixed(2)})`);
  const topRating = [...lead].sort((a, b) => b.rating - a.rating)[0].rating;
  assert(topRating >= 1.15, `a clear standout exists (top ${topRating})`);

  /* --------------------------- team world ranking ------------------------- */
  const rank = selectTeamRatings(st());
  assert(rank.length === 48, `all 48 teams are ranked (got ${rank.length})`);
  for (let i = 1; i < rank.length; i++) {
    assert(rank[i - 1].rating >= rank[i].rating, 'ranking sorted by rating desc');
  }
  assert(rank[0].rank === 1 && rank[47].rank === 48, 'ranks 1..48 assigned in order');
  assert(rank.every((r) => r.regionRank >= 1), 'each team carries a region rank');

  // A region's #1 (by region rank) is that region's highest-rated team.
  const pacByRegionRank = rank.filter((r) => r.region === 'pacific').sort((a, b) => a.regionRank - b.regionRank)[0];
  const pacByRating = rank.filter((r) => r.region === 'pacific').sort((a, b) => b.rating - a.rating)[0];
  assert(pacByRegionRank.teamId === pacByRating.teamId, 'region #1 is the region top-rated team');

  const r0 = selectTeamRank(st(), rank[0].teamId);
  assert(r0 && r0.rank === 1, 'selectTeamRank returns the team row');

  /* ------------------------------ UI renders ------------------------------ */
  store.dispatch(navigate('rankings', {}));
  const rk = toHtml(RankingsScreen(st(), store.dispatch));
  assert(rk.includes('World Ranking') && rk.includes('rankings__rating'), 'Rankings screen renders the rating table');

  store.dispatch(navigate('leaders', { eventId: 'kickoff-pacific' }));
  const ld = toHtml(StatsLeadersScreen(st(), store.dispatch));
  assert(ld.includes('>Rating<'), 'Leaders screen shows a Rating column');
  assert(ld.includes('rating--'), 'leader ratings are tier-coloured');
}
