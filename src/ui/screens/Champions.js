/**
 * ui/screens/Champions.js — the Champions screen (CONTRACTS-PERSIST §6, id
 * 'champions'): the season finale.
 *
 * Pure `(state, dispatch) => VNode`. Three sections, each rendered as the season
 * reaches it:
 *   1. the 16-team Champions field — the seeded list (`selectChampionsField`),
 *      seed 1 (index 0) marked as the final-Masters-winner DIRECT slot, the rest
 *      as cumulative-CP qualifiers. Clicking a team navigates to its screen.
 *   2. the Champions bracket — once the Champions event has been played, the
 *      8-team double-elim playoff via the shared `BracketView` (clicking a match
 *      opens its series through the command layer, exactly like the Kickoff
 *      Bracket screen).
 *   3. a crowned World Champion banner — when the season is complete
 *      (`selectChampion`).
 *
 * Pre-field (Champions slot not yet reached) it shows an empty state. DOM-free
 * and headless: renders via `toHtml` with no `document`/`window`.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { BracketView } from '../components/BracketView.js';
import { buildBracketView } from '../derive.js';
import {
  selectChampionsField,
  selectChampion,
  selectEvent,
  selectTeam
} from '../../state/selectors.js';
import { CHAMPIONS_FORMAT } from '../../config/formats/champions.js';
import { openSeries } from '../../state/commands.js';

/** The screen id (route key) the router maps to this screen. */
export const id = 'champions';

/** The Champions event slot id (international slot, keyed by slot id). */
const CHAMPIONS_SLOT_ID = 'champions';

/** The double-elim playoff stage descriptor from the Champions format. */
const PLAYOFF_DESCRIPTOR =
  CHAMPIONS_FORMAT.stages.find((s) => s.kind === 'bracket') || null;

/**
 * The Champions screen.
 * @param {object} state  the full store state
 * @param {(action:object)=>void} dispatch
 * @returns {*} VNode
 */
export function ChampionsScreen(state, dispatch) {
  const field = selectChampionsField(state);
  const champion = selectChampion(state);
  const event = championsEvent(state);

  // Pre-field: the Champions slot has not been reached yet.
  if (!field) {
    return h(
      'section',
      { class: 'screen screen--champions', 'data-screen': 'champions' },
      h('h1', { class: 'screen__title' }, 'Champions'),
      h(
        'p',
        { class: 'screen__empty' },
        'The Champions field is set once the season reaches its finale. ' +
          'Keep hitting Continue.'
      )
    );
  }

  const sections = [
    championBanner(state, champion),
    fieldSection(state, field, dispatch),
    bracketSection(state, event, dispatch)
  ];

  return h(
    'section',
    { class: 'screen screen--champions', 'data-screen': 'champions' },
    h('h1', { class: 'screen__title' }, 'Champions'),
    ...sections
  );
}

/**
 * Resolve the Champions EventResult (keyed by its slot id), or null if the event
 * has not been played. We FIRST confirm the event exists in the store (so
 * selectEvent's "latest played event" fallback can't return a different regional
 * event), THEN route through selectEvent so the result is spoiler-gated: while
 * the Champions slot is revealed day-by-day, the bracket must hide scores,
 * winners and the Grand Final crown for not-yet-watched matches.
 * @param {object} state
 * @returns {object|null}
 */
function championsEvent(state) {
  const byId = (state.events && state.events.byId) || {};
  if (!byId[CHAMPIONS_SLOT_ID]) return null;
  return selectEvent(state, CHAMPIONS_SLOT_ID) || null;
}

/**
 * The crowned World Champion banner — only when the season is complete.
 * @param {object} state
 * @param {string|null} championId
 * @returns {*} VNode|null
 */
function championBanner(state, championId) {
  if (!championId) return null;
  const team = selectTeam(state, championId);
  const name = team ? team.name : championId;
  const tag = team ? team.tag : null;

  return h(
    'div',
    { class: 'champions__banner', 'data-champion': championId },
    h('span', { class: 'champions__crown' }, '\u{1F3C6}'),
    h('span', { class: 'champions__banner-label' }, 'World Champion'),
    h(
      'span',
      { class: 'champions__banner-team' },
      tag ? h('span', { class: 'badge badge--seed' }, tag) : null,
      ' ',
      name
    )
  );
}

/**
 * The 16-team seeded field. Seed 1 (index 0) is the final-Masters-winner direct
 * slot; the rest qualified on cumulative CP. Each row navigates to its team.
 * @param {object} state
 * @param {string[]} field  16 teamIds (index 0 = direct slot)
 * @param {(action:object)=>void} dispatch
 * @returns {*} VNode
 */
function fieldSection(state, field, dispatch) {
  const rows = field.map((teamId, i) => {
    const team = selectTeam(state, teamId);
    const seed = i + 1;
    const direct = i === 0;
    return h(
      'li',
      {
        key: teamId,
        class: classNames(
          'champions__seed',
          direct && 'champions__seed--direct'
        ),
        'data-team': teamId,
        role: 'button',
        tabindex: '0',
        onClick: () => dispatch(navigate('team', { teamId }))
      },
      h('span', { class: 'champions__seed-no' }, `#${seed}`),
      team && team.tag
        ? h('span', { class: 'badge badge--seed' }, team.tag)
        : null,
      h('span', { class: 'champions__seed-name' }, team ? team.name : teamId),
      h(
        'span',
        { class: 'champions__seed-slot' },
        direct ? 'Masters Winner — Direct Slot' : 'Championship Points'
      )
    );
  });

  return h(
    'div',
    { class: 'champions__field' },
    h('h2', { class: 'screen__section-title' }, 'The 16-Team Field'),
    h('ol', { class: 'champions__seed-list' }, ...rows)
  );
}

/**
 * The Champions playoff bracket (8-team double-elim), once the event is played.
 * Mirrors the Kickoff Bracket screen: build the presentation model with
 * `buildBracketView`, render via the shared `BracketView`, click a card to open
 * its series through `openSeries`.
 * @param {object} state
 * @param {object|null} event  the Champions EventResult (or null if unplayed)
 * @param {(action:object)=>void} dispatch
 * @returns {*} VNode
 */
function bracketSection(state, event, dispatch) {
  if (!event || !PLAYOFF_DESCRIPTOR) {
    return h(
      'div',
      { class: 'champions__bracket champions__bracket--pending' },
      h('h2', { class: 'screen__section-title' }, 'Playoff Bracket'),
      h(
        'p',
        { class: 'screen__empty screen__empty--inline' },
        'The bracket appears once Champions is played.'
      )
    );
  }

  const model = buildBracketView(event, PLAYOFF_DESCRIPTOR);

  /** @type {Record<string, object>} */
  const teamsById = {};
  for (const col of model.columns) {
    for (const m of col.matches) {
      for (const side of [m.a, m.b]) {
        const tid = side && side.teamId;
        if (tid && !teamsById[tid]) {
          const team = selectTeam(state, tid);
          if (team) teamsById[tid] = team;
        }
      }
    }
  }

  const store = { getState: () => state, dispatch };
  const onMatch = (matchId) => {
    const series = findSeriesByMatchId(event, matchId);
    if (series && series.id) openSeries(store, series.id);
  };

  return h(
    'div',
    { class: 'champions__bracket' },
    h('h2', { class: 'screen__section-title' }, 'Playoff Bracket'),
    BracketView({ model, teamsById, onMatch })
  );
}

/**
 * Find the played SeriesRef for a Champions playoff match by its `matchId`
 * (restricted to the playoff stage so ids never collide with Swiss series).
 * @param {object} event  EventResult ({ series:SeriesRef[] })
 * @param {string} matchId
 * @returns {object|null}
 */
function findSeriesByMatchId(event, matchId) {
  if (!event || !Array.isArray(event.series)) return null;
  const stageId = PLAYOFF_DESCRIPTOR ? PLAYOFF_DESCRIPTOR.id : undefined;
  for (const s of event.series) {
    if (!s || s.matchId !== matchId) continue;
    if (stageId !== undefined && s.stageId !== undefined && s.stageId !== stageId) {
      continue;
    }
    return s;
  }
  return null;
}
