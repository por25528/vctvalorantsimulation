/**
 * ui/screens/LeagueStats.js — the STATS screen (id 'stats').
 *
 * Per-league / per-region analytics for the whole world: region strength
 * ranking, player rating + age distributions, a Tier 1 vs Tier 2 split, and a
 * nationality spread. Distinct from Leaders (per-player leaderboards) and World
 * Ranking (per-team Elo) — this is aggregate, read-only analytics derived from
 * current state via {@link deriveLeagueStats}.
 *
 * Pure `(state, dispatch) => VNode`. The active region (for the distribution
 * charts) lives in route params so the screen stays a pure function. Robust to
 * empty / early-career worlds — renders an empty state instead of crashing.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { DataTable } from '../components/DataTable.js';
import { selectRoute } from '../../state/selectors.js';
import { deriveLeagueStats } from '../leagueStats.js';
import { REGION_LABELS, REGION_ORDER } from '../eventFormats.js';

/** Screen id (route key). */
export const id = 'stats';

const FILTERS = ['all', ...REGION_ORDER];
const FILTER_LABELS = Object.freeze({ all: 'All regions', ...REGION_LABELS });

/**
 * The Stats analytics screen.
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @returns {*} VNode
 */
export function LeagueStatsScreen(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const region = FILTERS.includes(params.region) ? params.region : 'all';

  const stats = deriveLeagueStats(state);

  if (stats.empty || stats.regions.length === 0) {
    return h(
      'section',
      { class: 'screen screen--stats', 'data-screen': 'stats' },
      h('h1', { class: 'screen__title' }, 'Stats'),
      h('p', { class: 'screen__empty' }, 'No world loaded yet — start a career to see league analytics.')
    );
  }

  // The region filter only re-scopes the distribution charts; the region table,
  // tier split and nationality spread stay world-wide for comparison.
  const regionView = region === 'all' ? null : stats.regions.find((r) => r.region === region) || null;
  const ratingHist = regionView ? regionView.ratingHistogram : stats.ratingHistogram;
  const ageHist = regionView ? regionView.ageHistogram : stats.ageHistogram;
  const distScope = regionView ? regionView.label : 'All regions';

  return h(
    'section',
    { class: 'screen screen--stats', 'data-screen': 'stats' },
    h('h1', { class: 'screen__title' }, 'Stats'),
    h(
      'p',
      { class: 'screen__subtitle' },
      'Aggregate analytics across every league and region — strength, talent distribution and the Tier 1 / Tier 2 split, derived from the live world.'
    ),
    summaryStrip(stats.totals),
    sectionBlock('Region strength', 'Average team Elo and roster quality per league, strongest first.', regionTable(stats.regions, dispatch)),
    filterBar(region, dispatch),
    sectionBlock(
      `Player rating distribution — ${distScope}`,
      `Overall rating (mean of nine attributes) across ${ratingHist.total} players. Mean ${ratingHist.mean}.`,
      histogramChart(ratingHist, 'ovr')
    ),
    sectionBlock('Tier 1 vs Tier 2', 'How teams, players and quality split between the top flight and the challenger tier.', tierSplitView(stats.tierSplit)),
    sectionBlock(
      `Age distribution — ${distScope}`,
      `Player ages across ${ageHist.total} players. Mean age ${ageHist.mean}.`,
      histogramChart(ageHist, 'age')
    ),
    sectionBlock('Nationality spread', 'Most-represented nationalities across the whole player pool.', nationalityView(stats.nationalities))
  );
}

/** Top-line totals as a compact stat strip. */
function summaryStrip(totals) {
  const items = [
    { label: 'Regions', value: String(totals.regions) },
    { label: 'Teams', value: String(totals.teams) },
    { label: 'Players', value: String(totals.players) },
    { label: 'T1 teams', value: String(totals.t1Teams) },
    { label: 'T2 teams', value: String(totals.t2Teams) }
  ];
  return h(
    'div',
    { class: 'stats__summary' },
    items.map((it) =>
      h(
        'div',
        { key: it.label, class: 'stats__summary-item' },
        h('span', { class: 'stats__summary-value' }, it.value),
        h('span', { class: 'stats__summary-label' }, it.label)
      )
    )
  );
}

/** A titled analytics block. */
function sectionBlock(title, subtitle, body) {
  return h(
    'div',
    { class: 'stats__section' },
    h('h2', { class: 'stats__section-title' }, title),
    subtitle ? h('p', { class: 'stats__section-sub' }, subtitle) : null,
    body
  );
}

/** Region strength table (click a row to jump to its top team). */
function regionTable(regions, dispatch) {
  const columns = [
    { key: 'rank', label: '#', numeric: true, render: (row) => `#${row.rank}` },
    { key: 'label', label: 'Region', render: (row) => h('span', { class: 'stats__region' }, row.label) },
    { key: 'avgTeamRating', label: 'Avg Elo', numeric: true, render: (row) => String(row.avgTeamRating) },
    {
      key: 'avgPlayerOvr',
      label: 'Avg OVR',
      numeric: true,
      render: (row) => h('span', { class: ovrClass(row.avgPlayerOvr) }, row.avgPlayerOvr.toFixed(1))
    },
    { key: 'teamCount', label: 'Teams', numeric: true, render: (row) => String(row.teamCount) },
    { key: 'tiers', label: 'T1 / T2', numeric: true, render: (row) => `${row.t1Teams} / ${row.t2Teams}` },
    { key: 'playerCount', label: 'Players', numeric: true, render: (row) => String(row.playerCount) },
    { key: 'avgAge', label: 'Avg age', numeric: true, render: (row) => row.avgAge.toFixed(1) },
    { key: 'topTeam', label: 'Top team', render: (row) => (row.topTeam ? `${row.topTeam.name} (${row.topTeam.rating})` : '—') }
  ];
  const onRow = (row) => {
    if (row.topTeam) dispatch(navigate('team', { teamId: row.topTeam.teamId }));
  };
  return DataTable({
    columns,
    rows: regions,
    onRow,
    rowKey: (row) => row.region,
    class: 'stats-regions'
  });
}

/** A horizontal-bar histogram (OVR or age buckets). */
function histogramChart(hist, kind) {
  const peak = hist.peak || 1;
  if (!hist.total) {
    return h('p', { class: 'screen__empty' }, 'No players in this scope yet.');
  }
  return h(
    'div',
    { class: classNames('stats__hist', `stats__hist--${kind}`) },
    hist.buckets.map((b) => {
      const pct = Math.round((b.count / peak) * 100);
      return h(
        'div',
        { key: b.label, class: 'stats__bar-row' },
        h('span', { class: 'stats__bar-label' }, b.label),
        h(
          'div',
          { class: 'stats__bar-track' },
          h('div', { class: 'stats__bar-fill', style: { width: `${pct}%` } })
        ),
        h('span', { class: 'stats__bar-count' }, String(b.count))
      );
    })
  );
}

/** Tier 1 vs Tier 2 (and prospects) split cards. */
function tierSplitView(split) {
  const cards = [
    { key: 't1', label: 'Tier 1', data: split.t1, showTeams: true },
    { key: 't2', label: 'Tier 2', data: split.t2, showTeams: true },
    { key: 'prospect', label: 'Prospects', data: split.prospect, showTeams: false }
  ];
  return h(
    'div',
    { class: 'stats__tiers' },
    cards.map((c) =>
      h(
        'div',
        { key: c.key, class: classNames('stats__tier-card', `stats__tier-card--${c.key}`) },
        h('div', { class: 'stats__tier-name' }, c.label),
        c.showTeams ? stat('Teams', String(c.data.teams)) : null,
        stat('Players', String(c.data.players)),
        h('div', { class: 'stats__tier-stat' },
          h('span', { class: 'stats__tier-stat-label' }, 'Avg OVR'),
          h('span', { class: classNames('stats__tier-stat-value', ovrClass(c.data.avgOvr)) }, c.data.avgOvr.toFixed(1))
        )
      )
    )
  );
}

/** A label/value pair inside a tier card. */
function stat(label, value) {
  return h(
    'div',
    { class: 'stats__tier-stat' },
    h('span', { class: 'stats__tier-stat-label' }, label),
    h('span', { class: 'stats__tier-stat-value' }, value)
  );
}

/** Nationality spread as a labelled bar list. */
function nationalityView(nats) {
  if (!nats.length) return h('p', { class: 'screen__empty' }, 'No players yet.');
  const peak = nats.reduce((m, n) => Math.max(m, n.count), 0) || 1;
  return h(
    'div',
    { class: 'stats__hist stats__hist--nat' },
    nats.map((n) => {
      const pct = Math.round((n.count / peak) * 100);
      return h(
        'div',
        { key: n.code, class: 'stats__bar-row' },
        h('span', { class: 'stats__bar-label' }, n.code),
        h(
          'div',
          { class: 'stats__bar-track' },
          h('div', { class: 'stats__bar-fill', style: { width: `${pct}%` } })
        ),
        h('span', { class: 'stats__bar-count' }, String(n.count))
      );
    })
  );
}

/** Region filter chips (re-scope the distribution charts only). */
function filterBar(active, dispatch) {
  return h(
    'div',
    { class: 'cp__filters', role: 'tablist' },
    FILTERS.map((r) =>
      h(
        'button',
        {
          key: r,
          type: 'button',
          class: classNames('cp__filter', r === active && 'cp__filter--active'),
          'aria-selected': r === active ? 'true' : 'false',
          onClick: () => dispatch(navigate('stats', { region: r }))
        },
        FILTER_LABELS[r] || r
      )
    )
  );
}

/** Color an OVR value by quality band (reusing the leaders rating bands). */
function ovrClass(ovr) {
  const v = Number(ovr) || 0;
  if (v >= 78) return 'rating rating--elite';
  if (v >= 70) return 'rating rating--good';
  if (v < 60) return 'rating rating--low';
  return 'rating';
}
