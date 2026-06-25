/**
 * tests/ui/screen-leaguestats.test.mjs — the Stats analytics screen + its
 * derivation, headless via toHtml (CONTRACTS-UI §5, §8).
 *
 * Builds the real store, bootstraps a fresh career, then exercises:
 *   - deriveLeagueStats: region rows are ranked by avg Elo desc; histogram and
 *     tier-split counts are internally consistent with the world population;
 *   - the screen renders the region table, distribution charts, tier cards and
 *     nationality spread without crashing;
 *   - the region filter chips re-scope the distribution charts (and dispatch
 *     navigate('stats', {region}));
 *   - an empty world renders the empty state instead of throwing.
 *
 * Default-exported async fn that throws on failure (tests/run.mjs convention).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, continueSeason } from '../../src/state/commands.js';
import { selectTeams } from '../../src/state/selectors.js';
import { overall } from '../../src/engine/career/playerStats.js';
import { deriveLeagueStats } from '../../src/ui/leagueStats.js';
import { LeagueStatsScreen } from '../../src/ui/screens/LeagueStats.js';

/** DFS a (possibly component) VNode tree for the first element whose class includes `cls`. */
function findByClass(vnode, cls) {
  if (!vnode || typeof vnode !== 'object') return undefined;
  if (typeof vnode.tag === 'function') {
    return findByClass(vnode.tag({ ...vnode.props, children: vnode.children }), cls);
  }
  const c = vnode.props && (vnode.props.class || vnode.props.className);
  if (typeof c === 'string' && c.split(' ').includes(cls)) return vnode;
  for (const child of vnode.children || []) {
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return undefined;
}

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });
  // Sim one event so ratings have moved — analytics must still be correct.
  continueSeason(store, { simEvent: true });

  const state = store.getState();
  const stats = deriveLeagueStats(state);

  section('derivation: totals are consistent');
  {
    const teams = selectTeams(state);
    assert(!stats.empty, 'world is not empty');
    assertEqual(stats.totals.teams, teams.length, 'team total matches world');
    assert(stats.totals.players > 0, 'players counted');
    assert(stats.regions.length >= 1, 'at least one region with teams');
    assertEqual(
      stats.totals.t1Teams + stats.totals.t2Teams,
      teams.length,
      'every team is t1 or t2'
    );
  }

  section('derivation: regions ranked by avg Elo desc, ranks 1..n');
  {
    for (let i = 1; i < stats.regions.length; i++) {
      assert(
        stats.regions[i - 1].avgTeamRating >= stats.regions[i].avgTeamRating,
        'regions sorted by avg Elo descending'
      );
    }
    stats.regions.forEach((r, i) => {
      assertEqual(r.rank, i + 1, `region rank ${i + 1} set`);
      assert(r.teamCount > 0, 'ranked region has teams');
      assert(r.topTeam && typeof r.topTeam.teamId === 'string', 'region has a top team');
    });
  }

  section('derivation: rating histogram counts every player exactly once');
  {
    const summed = stats.ratingHistogram.buckets.reduce((s, b) => s + b.count, 0);
    assertEqual(summed, stats.ratingHistogram.total, 'bucket counts sum to total');
    assertEqual(stats.ratingHistogram.total, stats.totals.players, 'histogram covers whole pool');
    assert(stats.ratingHistogram.peak >= 1, 'a non-empty peak bucket');
    // Mean is within the observed min/max range.
    assert(
      stats.ratingHistogram.mean >= stats.ratingHistogram.min &&
        stats.ratingHistogram.mean <= stats.ratingHistogram.max,
      'mean lies within min..max'
    );
  }

  section('derivation: age histogram + tier split consistency');
  {
    const ageSum = stats.ageHistogram.buckets.reduce((s, b) => s + b.count, 0);
    assertEqual(ageSum, stats.ageHistogram.total, 'age buckets sum to total');
    assertEqual(ageSum, stats.totals.players, 'every player has an age bucket');

    const { t1, t2, prospect } = stats.tierSplit;
    assertEqual(
      t1.players + t2.players + prospect.players,
      stats.totals.players,
      'tier split partitions the player pool'
    );
    assertEqual(t1.teams + t2.teams, stats.totals.teams, 'tier split partitions teams');
    if (t1.players > 0) assert(t1.avgOvr > 0, 't1 avg OVR computed');
  }

  section('derivation: nationality spread sums to the pool');
  {
    const natSum = stats.nationalities.reduce((s, n) => s + n.count, 0);
    assertEqual(natSum, stats.totals.players, 'nationality counts cover everyone');
    for (let i = 1; i < stats.nationalities.length; i++) {
      // "Other" is appended last and may break monotonicity; ignore it.
      if (stats.nationalities[i].code === 'Other') continue;
      assert(
        stats.nationalities[i - 1].count >= stats.nationalities[i].count,
        'nationalities sorted by count desc'
      );
    }
  }

  section('render: full analytics page');
  {
    const html = toHtml(LeagueStatsScreen(state, () => {}));
    assert(html.includes('data-screen="stats"'), 'stats screen rendered');
    assert(html.includes('>Stats<'), 'title present');
    assert(html.includes('class="table stats-regions"'), 'region strength table present');
    assert(html.includes('stats__hist'), 'a distribution histogram rendered');
    assert(html.includes('stats__tier-card--t1'), 'tier 1 card present');
    assert(html.includes('stats__tier-card--t2'), 'tier 2 card present');
    assert(html.includes('stats__bar-fill'), 'histogram bars rendered');
    // Top region by avg Elo appears in the table.
    assert(html.includes(`>${stats.regions[0].label}<`), 'top region label rendered');
  }

  section('render: region filter re-scopes the distribution charts');
  {
    const region = stats.regions[0].region;
    const filtered = {
      ...state,
      ui: { ...state.ui, route: { screen: 'stats', params: { region } } }
    };
    const html = toHtml(LeagueStatsScreen(filtered, () => {}));
    assert(html.includes(stats.regions[0].label), 'scoped region label in subtitle');
    // The scoped rating histogram total equals that region's player count.
    const scopedTotal = stats.regions[0].ratingHistogram.total;
    assertEqual(scopedTotal, stats.regions[0].playerCount, 'scoped histogram covers region roster');

    // Filter chips dispatch navigate('stats', {region}).
    const cap = [];
    const vnode = LeagueStatsScreen(state, (a) => cap.push(a));
    const chip = findByClass(vnode, 'cp__filter');
    assert(chip && typeof chip.props.onClick === 'function', 'filter chip onClick wired');
    chip.props.onClick();
    const nav = cap.find((a) => a.screen === 'stats');
    assert(nav && typeof nav.params.region === 'string', 'chip navigates with a region');
  }

  section('render: region row click navigates to its top team');
  {
    const cap = [];
    const vnode = LeagueStatsScreen(state, (a) => cap.push(a));
    const row = findByClass(vnode, 'table__row--clickable');
    assert(row && typeof row.props.onClick === 'function', 'region row onClick wired');
    row.props.onClick();
    const nav = cap.find((a) => a.screen === 'team');
    assert(nav && typeof nav.params.teamId === 'string', 'row click navigates to a team');
  }

  section('derivation + render: empty world is robust');
  {
    const emptyState = {
      ...state,
      world: { ...state.world, teams: {}, players: {}, leagues: {} }
    };
    const emptyStats = deriveLeagueStats(emptyState);
    assert(emptyStats.empty, 'empty world flagged');
    assertEqual(emptyStats.regions.length, 0, 'no region rows');
    assertEqual(emptyStats.totals.players, 0, 'no players');
    assertEqual(emptyStats.ratingHistogram.total, 0, 'empty histogram total');
    assertEqual(emptyStats.ratingHistogram.mean, 0, 'empty mean is 0, not NaN');

    const html = toHtml(LeagueStatsScreen(emptyState, () => {}));
    assert(html.includes('screen__empty'), 'empty state rendered');
    assert(!html.includes('NaN'), 'no NaN leaks into the DOM');
  }

  // Sanity: derivation never invents OVR — region avg matches a hand recompute.
  section('derivation: region avg OVR matches a manual recompute');
  {
    const r0 = stats.regions[0];
    const teams = selectTeams(state).filter((t) => t.region === r0.region);
    const ovrs = [];
    for (const t of teams) {
      for (const pid of t.roster || []) {
        const p = state.world.players[pid];
        if (p) ovrs.push(overall(p));
      }
    }
    const manual = ovrs.length ? ovrs.reduce((s, v) => s + v, 0) / ovrs.length : 0;
    assert(Math.abs(manual - r0.avgPlayerOvr) < 0.1, 'avg OVR matches manual mean (rounding aside)');
  }
}
