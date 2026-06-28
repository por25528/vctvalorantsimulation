/**
 * ui/screens/Team.js — Team screen (CONTRACTS-UI §5 id 'team').
 *
 * Pure `(state, dispatch, store) => VNode`. Shows a club's identity (with a
 * follow/unfollow toggle), a TROPHY CABINET (every event it has won across the
 * career — persisted in season history), its season win-loss record, the roster,
 * and its series this season grouped by event (each clickable through to the
 * Match screen). Reads game truth only through selectors; headless via toHtml.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { followTeam } from '../../state/commands.js';
import { DataTable } from '../components/DataTable.js';
import {
  selectRoute,
  selectTeam,
  selectPlayer,
  selectSeason,
  selectFollowedTeam,
  selectTeamRank
} from '../../state/selectors.js';
import { deriveTeamDynasty } from '../dynastyDerive.js';
import { REGION_LABELS } from '../eventFormats.js';
import { eventLabel } from '../eventFormats.js';

/** The screen id (route key) this screen serves. */
export const SCREEN_ID = 'team';

/**
 * Trophy display per event type (most prestigious first). The colourful glyphs
 * are the one intentional emoji exception (the trophy cabinet) — see AGENTS.md.
 */
const TROPHY_META = [
  ['champions', { glyph: '🏆', label: 'World Champion' }],
  ['masters', { glyph: '🥇', label: 'Masters' }],
  ['stage', { glyph: '🎖️', label: 'Stage' }],
  ['kickoff', { glyph: '⭐', label: 'Kickoff' }]
];

/**
 * The Team screen.
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @param {object} [store]
 * @returns {import('../render.js').VNode}
 */
export function TeamScreen(state, dispatch, store) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const team = params.teamId ? selectTeam(state, params.teamId) : null;

  if (!team) {
    return h(
      'section',
      { class: 'screen screen--team team team--empty' },
      h('h1', { class: 'screen__title' }, 'Team'),
      h('p', { class: 'screen__empty muted' }, 'No team selected.')
    );
  }

  const season = selectSeason(state);
  const groups = teamSeasonSeries(season, team.id);
  const record = seasonRecord(groups, team.id);
  const dynasty = deriveTeamDynasty(state, team.id);
  const rank = selectTeamRank(state, team.id);

  const followed = selectFollowedTeam(state);
  const isFollowed = followed && followed.id === team.id;
  const realStore = store || (dispatch ? { getState: () => state, dispatch } : null);
  const onFollow = realStore ? () => followTeam(realStore, isFollowed ? null : team.id) : null;

  return h(
    'section',
    { class: 'screen screen--team team', 'data-team': team.id },
    teamHeader(team, record, isFollowed, onFollow, rank),
    dynasty.hasHistory ? dynastySection(dynasty) : null,
    rosterSection(state, team, dispatch),
    seasonSeriesSection(state, team.id, groups, dispatch)
  );
}

/* ----------------------------- header ----------------------------- */

/** Team header: tag badge, name, world rank/rating, follow toggle, season record. */
function teamHeader(team, record, isFollowed, onFollow, rank) {
  return h(
    'header',
    { class: 'team__header' },
    team.tag ? h('span', { class: 'badge badge--seed team__tag' }, team.tag) : null,
    h('h1', { class: 'screen__title team__name' }, team.name || team.id),
    rank
      ? h(
          'span',
          { class: 'team__rank', title: `World #${rank.rank} · ${rank.rating} Elo` },
          h('span', { class: 'team__rank-world' }, `World #${rank.rank}`),
          h('span', { class: 'team__rank-rating' }, `${rank.rating}`),
          rank.region
            ? h('span', { class: 'team__rank-region' }, `${REGION_LABELS[rank.region] || rank.region} #${rank.regionRank}`)
            : null
        )
      : null,
    h(
      'button',
      {
        type: 'button',
        class: classNames('btn', 'btn--sm', 'team__follow', isFollowed ? 'team__follow--on' : 'btn--primary'),
        'aria-pressed': isFollowed ? 'true' : 'false',
        onClick: onFollow || undefined,
        disabled: onFollow ? undefined : true
      },
      isFollowed ? '★ Following' : '☆ Follow'
    ),
    h(
      'span',
      { class: 'team__record' },
      h('span', { class: 'team__record-w' }, String(record.w)),
      h('span', { class: 'team__record-sep' }, '–'),
      h('span', { class: 'team__record-l' }, String(record.l)),
      ' series (this season)'
    )
  );
}

/* ------------------------- dynasty & cabinet ----------------------- */

/**
 * The dynasty panel: the club's honours (current prestige + accolade chips), the
 * by-type Trophy Cabinet counts, and a per-season TITLE + PRESTIGE timeline
 * (each season's glory as a bar, with a crown on world-title years).
 * Retains the `team__cabinet` class + "Trophy Cabinet" label (kept stable for
 * the observer test) inside the richer dynasty frame.
 *
 * @param {ReturnType<import('../dynastyDerive.js').deriveTeamDynasty>} d
 */
function dynastySection(d) {
  const chips = TROPHY_META.filter(([type]) => (d.byType[type] || 0) > 0).map(([type, meta]) =>
    h(
      'div',
      { key: type, class: classNames('team__trophy', `team__trophy--${type}`) },
      h('span', { class: 'team__trophy-glyph' }, meta.glyph),
      h('span', { class: 'team__trophy-count' }, `×${d.byType[type]}`),
      h('span', { class: 'team__trophy-label' }, meta.label)
    )
  );

  return h(
    'section',
    { class: 'panel team__cabinet team__dynasty' },
    h(
      'header',
      { class: 'panel__head' },
      h('h2', { class: 'panel__title' }, `Trophy Cabinet — ${d.total} ${d.total === 1 ? 'title' : 'titles'}`),
      d.weighted ? h('span', { class: 'team__dynasty-weight', title: 'Weighted prestige value of all titles' }, `${d.weighted} pts`) : null
    ),
    h(
      'div',
      { class: 'panel__body' },
      honoursRow(d),
      h('div', { class: 'team__trophies' }, ...chips),
      dynastyTimeline(d.timeline)
    )
  );
}

/** Current live prestige + plain-language accolade chips. */
function honoursRow(d) {
  if (d.reputation == null && !d.accolades.length) return null;
  return h(
    'div',
    { class: 'team__dynasty-honours' },
    d.reputation != null
      ? h(
          'div',
          { class: 'team__dynasty-prestige', title: 'Living reputation across the world' },
          h('span', { class: 'team__dynasty-prestige-kicker' }, 'Prestige'),
          h('span', { class: 'team__dynasty-prestige-value' }, String(Math.round(d.reputation)))
        )
      : null,
    d.accolades.length
      ? h(
          'ul',
          { class: 'team__dynasty-accolades' },
          ...d.accolades.map((a, i) => h('li', { key: i, class: 'team__dynasty-accolade' }, a))
        )
      : null
  );
}

/** Per-season title + prestige timeline, newest season first. */
function dynastyTimeline(timeline) {
  if (!timeline.length) return null;
  return h(
    'div',
    { class: 'team__timeline' },
    h('h3', { class: 'team__timeline-title' }, 'Dynasty Timeline'),
    h(
      'ul',
      { class: 'team__timeline-list' },
      ...timeline.map((row) =>
        h(
          'li',
          {
            key: row.seasonIndex,
            class: classNames('team__timeline-row', row.isChampion && 'team__timeline-row--champ')
          },
          h('span', { class: 'team__timeline-season' }, `S${row.seasonIndex + 1}`),
          h(
            'span',
            { class: 'team__timeline-bar', 'aria-hidden': 'true' },
            h('span', { class: 'team__timeline-fill', style: { width: `${Math.max(4, row.pct)}%` } })
          ),
          h(
            'span',
            { class: 'team__timeline-glyphs' },
            ...row.titles.map((t, i) =>
              h('span', { key: i, class: 'team__timeline-glyph', title: eventLabel({ slotId: t.slotId, region: t.region }) }, glyphFor(t.type))
            )
          ),
          h('span', { class: 'team__timeline-count' }, `${row.titleCount}${row.current ? ' · live' : ''}`)
        )
      )
    )
  );
}

/** Trophy glyph for an event type. */
function glyphFor(type) {
  const found = TROPHY_META.find(([t]) => t === type);
  return found ? found[1].glyph : '•';
}

/* ----------------------------- roster ----------------------------- */

/** The roster table: # · handle · role · age · nationality. Rows -> player. */
function rosterSection(state, team, dispatch) {
  const roster = team.roster || [];
  const players = roster.map((pid) => selectPlayer(state, pid)).filter((p) => p != null);

  const goPlayer = (pid) => dispatch(navigate('player', { playerId: pid, teamId: team.id }));

  const columns = [
    { key: 'num', label: '#', numeric: true, render: (p) => String(p.__i + 1) },
    { key: 'handle', label: 'Player', render: (p) => p.handle || p.name || p.id },
    { key: 'role', label: 'Role' },
    { key: 'age', label: 'Age', numeric: true },
    { key: 'nationality', label: 'Nation' }
  ];

  const rows = players.map((p, i) => ({ ...p, __i: i }));

  return h(
    'div',
    { class: 'team__roster' },
    h('h2', { class: 'team__section-title' }, 'Roster'),
    DataTable({ columns, rows, rowKey: (p) => p.id, onRow: (p) => goPlayer(p.id), class: 'roster' })
  );
}

/* ----------------------------- series ----------------------------- */

/** The team's series this season, grouped by event (newest event first). */
function seasonSeriesSection(state, teamId, groups, dispatch) {
  if (!groups.length) {
    return h(
      'div',
      { class: 'team__series team__series--empty' },
      h('h2', { class: 'team__section-title' }, 'Results'),
      h('p', { class: 'screen__empty screen__empty--inline muted' }, 'No series played yet this season.')
    );
  }

  return h(
    'div',
    { class: 'team__series' },
    h('h2', { class: 'team__section-title' }, 'Results'),
    groups.map((g) =>
      h(
        'div',
        { class: 'team__series-group', key: g.eventId },
        h('h3', { class: 'team__series-event' }, g.label),
        h(
          'ul',
          { class: 'team__series-list' },
          g.series.map((s) => seriesRow(state, teamId, s, dispatch))
        )
      )
    )
  );
}

/** One series row: W/L, round, opponent, score, click -> match. */
function seriesRow(state, teamId, s, dispatch) {
  const isA = s.teamAId === teamId;
  const oppId = isA ? s.teamBId : s.teamAId;
  const opp = selectTeam(state, oppId);
  const oppName = (opp && opp.name) || oppId;

  const score = s.score || { A: 0, B: 0 };
  const myScore = isA ? score.A : score.B;
  const oppScore = isA ? score.B : score.A;
  const won = s.winnerId === teamId;

  const goMatch = () => dispatch(navigate('match', { seriesId: s.id }));

  return h(
    'li',
    {
      key: s.id,
      class: classNames(
        'team__series-item',
        'team__series-item--clickable',
        won ? 'team__series-item--won' : 'team__series-item--lost'
      ),
      'data-series': s.id,
      onClick: goMatch
    },
    h('span', { class: classNames('badge', won ? 'badge--win' : 'badge--loss') }, won ? 'W' : 'L'),
    s.round || s.matchId ? h('span', { class: 'team__series-round' }, s.round || s.matchId) : null,
    h('span', { class: 'team__series-opp' }, `vs ${oppName}`),
    h('span', { class: 'team__series-score' }, `${myScore}–${oppScore}`)
  );
}

/* ----------------------------- helpers ---------------------------- */

/**
 * The team's series this season, grouped by event (newest event first).
 * @param {object|null} season  SeasonState
 * @param {string} teamId
 * @returns {Array<{eventId:string, label:string, type:string, series:object[]}>}
 */
function teamSeasonSeries(season, teamId) {
  if (!season || !Array.isArray(season.events)) return [];
  const groups = [];
  for (const e of season.events) {
    const series = ((e.result && e.result.series) || []).filter(
      (s) => s.teamAId === teamId || s.teamBId === teamId
    );
    if (!series.length) continue;
    groups.push({
      eventId: (e.result && e.result.eventId) || e.slotId,
      label: eventLabel({ slotId: e.slotId, region: e.region || null }),
      type: e.type,
      series
    });
  }
  return groups.reverse();
}

/** The team's series W-L over the grouped season series. */
function seasonRecord(groups, teamId) {
  let w = 0;
  let l = 0;
  for (const g of groups) {
    for (const s of g.series) {
      if (s.winnerId === teamId) w += 1;
      else if (s.winnerId) l += 1;
    }
  }
  return { w, l };
}
