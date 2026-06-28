/**
 * ui/screens/PlayerCareer.js — a player's LIFE STORY / Career arc (Wave 2 E,
 * route id 'career'). Pure `(state, dispatch) => VNode`; reads truth only through
 * selectors and renders headlessly via toHtml (no DOM access).
 *
 * Resolves a player from `ui.route.params.playerId` and tells their whole career
 * from the banked legacy ledger: the era tag, the trophy cabinet, career totals,
 * the rise → peak → decline narration, the milestone timeline, and a season-by-
 * season table. Robust to players with no banked history yet (empty state).
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { Icon } from '../components/Icon.js';
import { DataTable } from '../components/DataTable.js';
import { selectRoute, selectPlayer, selectPlayerCareer } from '../../state/selectors.js';
import { derivePlayerStory } from '../legacyDerive.js';

/** The screen id (route key) this screen serves. */
export const SCREEN_ID = 'career';

const r0 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @returns {import('../render.js').VNode}
 */
export function PlayerCareer(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const playerId = params.playerId || null;
  const player = playerId ? selectPlayer(state, playerId) : null;
  const rec = playerId ? selectPlayerCareer(state, playerId) : null;
  const go = (screen, p) => (dispatch ? dispatch(navigate(screen, p || {})) : undefined);

  if (!playerId) {
    return h(
      'section',
      { class: 'screen screen--career legacy', id: 'screen-career' },
      h('h1', { class: 'screen__title' }, 'Career'),
      h('p', { class: 'card__muted' }, 'No player selected. Open a player, then view their career.')
    );
  }

  const story = derivePlayerStory(rec);
  const handle = (rec && rec.handle) || (player && (player.handle || player.name)) || playerId;
  const role = (rec && rec.role) || (player && player.role) || '—';
  const nation = (rec && rec.nationality) || (player && player.nationality) || null;

  return h(
    'section',
    { class: 'screen screen--career legacy', id: 'screen-career', 'data-player': playerId },
    header(handle, role, nation, story, player, go),
    !story.hasHistory
      ? h('p', { class: 'legacy__empty card__muted' }, 'No completed seasons banked yet — this story is still being written. Advance a full season to begin their legacy.')
      : h(
          'div',
          { class: 'legacy__body' },
          trophyCabinet(story.trophies),
          totalsCard(story.totals),
          arcCard(story.arc),
          milestonesCard(story.milestones),
          seasonsTable(story.seasons)
        )
  );
}

/* -------------------------------- header --------------------------------- */

function header(handle, role, nation, story, player, go) {
  const era = story.era;
  const span = story.hasHistory ? `Seasons ${story.firstSeason}–${story.lastSeason}` : 'Unbanked';
  return h(
    'header',
    { class: 'screen__head legacy__head' },
    h(
      'div',
      { class: 'legacy__head-id' },
      h('h1', { class: 'screen__title' }, `${handle} — Career`),
      h('p', { class: 'screen__sub' }, `${role}${nation ? ' · ' + nation : ''} · ${span}`),
      h('span', { class: classNames('legacy__era', `legacy__era--${era.key}`) }, era.label)
    ),
    h(
      'div',
      { class: 'legacy__head-links' },
      player
        ? h('button', { type: 'button', class: 'link', onClick: () => go('player', { playerId: player.id }) }, '← Player profile')
        : null,
      player
        ? h('button', { type: 'button', class: 'link', onClick: () => go('development', { playerId: player.id }) }, 'Development →')
        : null,
      h('button', { type: 'button', class: 'link', onClick: () => go('legends') }, 'All-Time leaders →')
    )
  );
}

/* ------------------------------- cabinet --------------------------------- */

function trophyCabinet(t) {
  const items = [
    { icon: 'trophy', n: t.titles, label: 'World Titles' },
    { icon: 'bracket', n: t.eventTitles, label: 'Events Won' },
    { icon: 'star', n: t.mvps, label: 'Season MVP' },
    { icon: 'medal', n: t.finalsMvps, label: 'Finals MVP' },
    { icon: 'medal', n: t.allProFirst, label: 'All-Pro 1st' },
    { icon: 'medal', n: t.allProSecond, label: 'All-Pro 2nd' },
    { icon: 'star', n: t.rookieOfYear, label: 'Rookie of Year' },
    { icon: 'globe', n: t.regionMvps, label: 'Region MVP' }
  ].filter((x) => x.n > 0);

  return card(
    'Trophy Cabinet',
    items.length
      ? h('div', { class: 'legacy__cabinet' }, items.map((it, i) =>
          h(
            'div',
            { key: i, class: 'legacy__trophy' },
            h('span', { class: 'legacy__trophy-icon', 'aria-hidden': 'true' }, Icon(it.icon, { size: 18 })),
            h('span', { class: 'legacy__trophy-n' }, String(it.n)),
            h('span', { class: 'legacy__trophy-label' }, it.label)
          )
        ))
      : h('p', { class: 'card__muted' }, 'No silverware — yet.')
  );
}

/* ------------------------------- totals ---------------------------------- */

function totalsCard(tot) {
  const stat = (label, value) => h('div', { class: 'legacy__stat' },
    h('span', { class: 'legacy__stat-value' }, value),
    h('span', { class: 'legacy__stat-label' }, label));
  return card(
    'Career Totals',
    h('div', { class: 'legacy__stats' },
      stat('Seasons', String(tot.seasonsPlayed)),
      stat('Maps', String(tot.maps)),
      stat('Series', String(tot.series)),
      stat('Career ACS', tot.acs.toFixed(1)),
      stat('Career K-D', tot.kd.toFixed(2)),
      stat('Kills', String(tot.kills)),
      stat('Deaths', String(tot.deaths)),
      stat('Assists', String(tot.assists))
    ),
    h('p', { class: 'card__muted' },
      tot.peakAcsSeason != null
        ? `Peak: ${r0(tot.peakOverall)} overall (S${tot.peakOverallSeason}), ${tot.peakAcs.toFixed(1)} ACS (S${tot.peakAcsSeason}).`
        : 'Peak still to come.')
  );
}

/* --------------------------------- arc ----------------------------------- */

function arcCard(arc) {
  if (!arc.length) return null;
  return card(
    'The Arc',
    h('ol', { class: 'legacy__arc' }, arc.map((ph) =>
      h(
        'li',
        { key: ph.key, class: classNames('legacy__phase', `legacy__phase--${ph.key}`) },
        h('span', { class: 'legacy__phase-label' }, ph.label),
        h('span', { class: 'legacy__phase-span' }, ph.from === ph.to ? `S${ph.from}` : `S${ph.from}–S${ph.to}`),
        h('p', { class: 'legacy__phase-text' }, ph.text)
      )
    ))
  );
}

/* ----------------------------- milestones -------------------------------- */

function milestonesCard(milestones) {
  return card(
    'Milestones',
    milestones.length
      ? h('ul', { class: 'legacy__milestones' }, milestones.map((m, i) =>
          h(
            'li',
            { key: i, class: classNames('legacy__milestone', `legacy__milestone--${m.kind}`) },
            h('span', { class: 'legacy__milestone-season' }, `S${m.season}`),
            h('span', { class: 'legacy__milestone-label' }, m.label)
          )
        ))
      : h('p', { class: 'card__muted' }, 'No milestones banked yet.')
  );
}

/* ------------------------------ seasons ---------------------------------- */

function seasonsTable(seasons) {
  if (!seasons.length) return null;
  const columns = [
    { key: 'seasonIndex', label: 'S', render: (r) => `S${r.seasonIndex}` },
    { key: 'age', label: 'Age', numeric: true, render: (r) => (r.age != null ? String(r.age) : '—') },
    { key: 'overall', label: 'OVR', numeric: true, render: (r) => String(r0(r.overall)) },
    { key: 'maps', label: 'Maps', numeric: true },
    { key: 'acs', label: 'ACS', numeric: true, render: (r) => r.acs.toFixed(1) },
    { key: 'kd', label: 'K-D', numeric: true, render: (r) => r.kd.toFixed(2) },
    { key: 'honors', label: 'Honors', render: (r) => seasonHonors(r) }
  ];
  // Newest season first.
  const rows = [...seasons].reverse();
  return h(
    'div',
    { class: 'card legacy__seasons-card' },
    h('h2', { class: 'card__title' }, 'Season by Season'),
    DataTable({ columns, rows, rowKey: (r) => `s${r.seasonIndex}`, class: 'legacy-seasons' })
  );
}

/** Compact honor badges for one season row. */
function seasonHonors(s) {
  const tags = [];
  if (s.worldTitle) tags.push('Champ');
  if (s.mvp) tags.push('MVP');
  if (s.finalsMvp) tags.push('FMVP');
  if (s.rookieOfYear) tags.push('ROY');
  if (s.allProFirst) tags.push('AP1');
  else if (s.allProSecond) tags.push('AP2');
  if (s.regionMvp) tags.push('RgnMVP');
  if (!tags.length && s.eventTitles > 0) tags.push(`${s.eventTitles} event${s.eventTitles === 1 ? '' : 's'}`);
  if (!tags.length) return '—';
  return h('span', { class: 'legacy__honors' }, tags.map((t, i) => h('span', { key: i, class: 'legacy__honor' }, t)));
}

/* ------------------------------- helpers --------------------------------- */

function card(title, ...body) {
  return h('div', { class: 'card legacy__card' }, h('h2', { class: 'card__title' }, title), ...body.filter(Boolean));
}
