/**
 * ui/screens/HallOfFame.js — the EPOCHS screen (route id 'hof').
 *
 * An all-time records hall over the frozen career history ledger: the most
 * decorated clubs, the longest world-title dynasties, the dominant eras, the
 * fiercest cross-season rivalries, headline all-time records, and regional
 * prestige. Pure `(state, dispatch, store) => VNode`; reads game truth only
 * through the dynasty derive layer (which itself reads selectors), so it is
 * headless-renderable via toHtml and never touches the match engine.
 *
 * Robust to empty / early-career worlds: before any season completes it renders
 * a clean empty state, never NaN or a crash.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/Icon.js';
import { deriveHallOfFame } from '../dynastyDerive.js';

/** The screen id (route key) this screen serves. */
export const SCREEN_ID = 'hof';

/**
 * The Hall of Fame screen.
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
export function HallOfFameScreen(state, dispatch) {
  const hof = deriveHallOfFame(state);
  const goTeam = (teamId) => () => teamId && dispatch(navigate('team', { teamId }));

  return h(
    'section',
    { class: 'screen screen--hof hof', 'data-screen': 'hof' },
    h(
      'header',
      { class: 'screen__head hof__head' },
      h('h1', { class: 'screen__title' }, 'Hall of Fame'),
      h(
        'span',
        { class: 'hof__sub muted' },
        hof.seasonsPlayed
          ? `All-time records across ${hof.seasonsPlayed} ${hof.seasonsPlayed === 1 ? 'season' : 'seasons'}`
          : 'All-time records'
      )
    ),
    hof.empty
      ? emptyState()
      : h(
          'div',
          { class: 'hof__grid' },
          recordsPanel(hof.records, goTeam),
          decoratedPanel(hof.decorated, goTeam),
          dynastiesPanel(hof.dynasties, goTeam),
          rivalriesPanel(hof.rivalries),
          erasPanel(hof.eras, goTeam),
          regionsPanel(hof.regions)
        )
  );
}

/* ------------------------------ empty ----------------------------- */

function emptyState() {
  return h(
    'div',
    { class: 'hof__empty panel' },
    h(
      'div',
      { class: 'panel__body' },
      h('p', { class: 'screen__empty muted' }, 'No history yet — the Hall of Fame fills as seasons are decided.'),
      h('p', { class: 'screen__empty screen__empty--inline muted' }, 'Watch a season through to a champion to crown the first records.')
    )
  );
}

/* ------------------------------ panel shell ----------------------- */

/** A titled HoF panel with an icon kicker. */
function panel(icon, title, body, extraClass) {
  return h(
    'section',
    { class: classNames('panel', 'hof__panel', extraClass) },
    h(
      'header',
      { class: 'panel__head' },
      h('span', { class: 'hof__panel-icon', 'aria-hidden': 'true' }, Icon(icon, { size: 16 })),
      h('h2', { class: 'panel__title' }, title)
    ),
    h('div', { class: 'panel__body' }, body)
  );
}

/* ---------------------------- records ----------------------------- */

/** Headline all-time records as a set of stat cards. */
function recordsPanel(records, goTeam) {
  if (!records.length) return null;
  return panel(
    'medal',
    'All-Time Records',
    h(
      'ul',
      { class: 'hof__records' },
      ...records.map((r) =>
        h(
          'li',
          {
            key: r.key,
            class: classNames('hof__record', r.teamId && 'hof__record--clickable'),
            onClick: r.teamId ? goTeam(r.teamId) : undefined
          },
          h('span', { class: 'hof__record-label' }, r.label),
          h('span', { class: 'hof__record-value' }, r.value),
          h('span', { class: 'hof__record-holder' }, r.name || '—'),
          r.detail ? h('span', { class: 'hof__record-detail muted' }, r.detail) : null
        )
      )
    ),
    'hof__panel--wide'
  );
}

/* --------------------------- decorated ---------------------------- */

/** Most-decorated clubs table (clickable rows -> team page). */
function decoratedPanel(decorated, goTeam) {
  if (!decorated.length) return null;
  const columns = [
    { key: 'rank', label: '#', numeric: true, render: (r) => String(r.__rank) },
    { key: 'name', label: 'Team', render: (r) => teamCell(r) },
    { key: 'champions', label: 'C', numeric: true, render: (r) => String(r.byType.champions || 0) },
    { key: 'masters', label: 'M', numeric: true, render: (r) => String(r.byType.masters || 0) },
    { key: 'stage', label: 'S', numeric: true, render: (r) => String(r.byType.stage || 0) },
    { key: 'kickoff', label: 'K', numeric: true, render: (r) => String(r.byType.kickoff || 0) },
    { key: 'total', label: 'Titles', numeric: true },
    { key: 'weighted', label: 'Pts', numeric: true }
  ];
  const rows = decorated.map((r, i) => ({ ...r, __rank: i + 1 }));
  return panel(
    'trophy',
    'Most Decorated',
    DataTable({
      columns,
      rows,
      rowKey: (r) => r.teamId,
      onRow: (r) => goTeam(r.teamId)(),
      class: 'hof-decorated'
    }),
    'hof__panel--wide'
  );
}

/** Team name + tag cell. */
function teamCell(r) {
  return h(
    'span',
    { class: 'hof__team' },
    r.tag ? h('span', { class: 'badge badge--seed hof__team-tag' }, r.tag) : null,
    h('span', { class: 'hof__team-name' }, r.name)
  );
}

/* --------------------------- dynasties ---------------------------- */

/** Longest world-title dynasties (consecutive-champion runs). */
function dynastiesPanel(dynasties, goTeam) {
  const body = dynasties.length
    ? h(
        'ul',
        { class: 'hof__list' },
        ...dynasties.map((d, i) =>
          h(
            'li',
            { key: i, class: 'hof__list-item hof__list-item--clickable', onClick: goTeam(d.teamId) },
            h('span', { class: 'hof__streak' }, `${d.length}×`),
            h(
              'span',
              { class: 'hof__list-main' },
              h('span', { class: 'hof__list-name' }, d.name),
              h('span', { class: 'hof__list-detail muted' }, `S${d.startSeason + 1}–S${d.endSeason + 1} world titles`)
            )
          )
        )
      )
    : h('p', { class: 'screen__empty muted' }, 'No back-to-back champions yet.');
  return panel('trophy', 'Longest Dynasties', body);
}

/* ----------------------------- eras ------------------------------- */

/** Dominant eras (rolling-window glory share by a single club). */
function erasPanel(eras, goTeam) {
  if (!eras.length) return null;
  return panel(
    'target',
    'Eras of Dominance',
    h(
      'ul',
      { class: 'hof__list' },
      ...eras.map((e, i) =>
        h(
          'li',
          { key: i, class: 'hof__list-item hof__list-item--clickable', onClick: goTeam(e.teamId) },
          h('span', { class: 'hof__share' }, `${e.share}%`),
          h(
            'span',
            { class: 'hof__list-main' },
            h('span', { class: 'hof__list-name' }, e.name),
            h('span', { class: 'hof__list-detail muted' }, `S${e.startSeason + 1}–S${e.endSeason + 1} · share of all glory`)
          )
        )
      )
    )
  );
}

/* --------------------------- rivalries ---------------------------- */

/** Fiercest cross-season rivalries (top-of-table head-to-head). */
function rivalriesPanel(rivalries) {
  const body = rivalries.length
    ? h(
        'ul',
        { class: 'hof__rivalries' },
        ...rivalries.map((r, i) => rivalryRow(r, i))
      )
    : h('p', { class: 'screen__empty muted' }, 'No recurring top-table clashes yet.');
  return panel('swap', 'Fiercest Rivalries', body, 'hof__panel--wide');
}

/** One rivalry: the two clubs and their head-to-head split. */
function rivalryRow(r, i) {
  const total = r.aWins + r.bWins || 1;
  const aPct = Math.round((r.aWins / total) * 100);
  return h(
    'li',
    { key: i, class: 'hof__rivalry' },
    h(
      'div',
      { class: 'hof__rivalry-teams' },
      h('span', { class: classNames('hof__rivalry-team', r.aWins >= r.bWins && 'hof__rivalry-team--lead') }, r.aTag || r.aName),
      h('span', { class: 'hof__rivalry-score' }, `${r.aWins}–${r.bWins}`),
      h('span', { class: classNames('hof__rivalry-team', r.bWins >= r.aWins && 'hof__rivalry-team--lead') }, r.bTag || r.bName)
    ),
    h(
      'div',
      { class: 'hof__rivalry-bar', 'aria-hidden': 'true' },
      h('span', { class: 'hof__rivalry-bar-a', style: { width: `${aPct}%` } }),
      h('span', { class: 'hof__rivalry-bar-b', style: { width: `${100 - aPct}%` } })
    ),
    h('span', { class: 'hof__rivalry-meta muted' }, `${r.aName} vs ${r.bName} · ${r.meetings} meetings`)
  );
}

/* ---------------------------- regions ----------------------------- */

/** Regional prestige texture: titles + world championships per region. */
function regionsPanel(regions) {
  if (!regions.length) return null;
  return panel(
    'globe',
    'Regional Prestige',
    h(
      'ul',
      { class: 'hof__regions' },
      ...regions.map((reg) =>
        h(
          'li',
          { key: reg.region, class: 'hof__region' },
          h('span', { class: 'hof__region-name' }, reg.label),
          h(
            'span',
            { class: 'hof__region-stats' },
            h('span', { class: 'hof__region-stat' }, `${reg.titles} titles`),
            h('span', { class: 'hof__region-stat hof__region-stat--champ' }, `${reg.champions} world`)
          ),
          reg.topTeam ? h('span', { class: 'hof__region-top muted' }, `Best: ${reg.topTeam}`) : null
        )
      )
    )
  );
}
