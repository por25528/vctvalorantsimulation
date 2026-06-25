/**
 * ui/screens/Bracket.js — the playoff Bracket screen (CONTRACTS-UI §5, id 'bracket').
 *
 * Pure `(state, dispatch, store) => VNode`. Renders the playoff bracket for ANY
 * played event (every league's Kickoff/Stage + every Masters/Champions), chosen
 * via the EventPicker (route param `eventId`, defaulting to the followed team's
 * latest event). The bracket stage descriptor is derived from the event's format
 * (`playoffStageOf`): triple-elim for Kickoff, double-elim for Stage/Masters/
 * Champions. During a slot's day-by-day reveal the event is spoiler-gated, so
 * unrevealed matches render as TBD.
 *
 * Clicking a match opens its series (find the played SeriesRef by matchId within
 * the playoff stage, then openSeries). DOM-free; renders headlessly via toHtml.
 */

import { h } from '../render.js';
import { navigate } from '../../state/actions.js';
import { BracketView } from '../components/BracketView.js';
import { EventPicker } from '../components/EventPicker.js';
import { buildBracketView } from '../derive.js';
import {
  selectRoute,
  selectTeam,
  selectEvent,
  selectPlayedEvents,
  selectDefaultEventId,
  selectFollowedTeam
} from '../../state/selectors.js';
import { playoffStageOf, eventLabel } from '../eventFormats.js';
import { openSeries } from '../../state/commands.js';

/** Screen id (route key) for the router. */
export const id = 'bracket';

/** Find the played SeriesRef for a bracket match (restricted to the playoff stage). */
function findSeriesByMatchId(event, matchId, stageId) {
  if (!event || !Array.isArray(event.series)) return null;
  for (const s of event.series) {
    if (!s || s.matchId !== matchId) continue;
    if (s.stageId !== undefined && stageId !== undefined && s.stageId !== stageId) continue;
    return s;
  }
  return null;
}

/**
 * The Bracket screen.
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @param {object} [store]
 * @returns {*} VNode
 */
export function BracketScreen(state, dispatch, store) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const events = selectPlayedEvents(state);
  const eventId =
    params.eventId && events.some((e) => e.eventId === params.eventId)
      ? params.eventId
      : selectDefaultEventId(state);
  const event = eventId ? selectEvent(state, eventId) : null;
  const entry = events.find((e) => e.eventId === eventId) || null;

  const onPick = (eid) => dispatch(navigate('bracket', { eventId: eid }));

  const head = (subtitle) =>
    h(
      'header',
      { class: 'screen__head' },
      h(
        'div',
        null,
        h('h1', { class: 'screen__title' }, 'Playoff Bracket'),
        h('p', { class: 'screen__subtitle' }, subtitle)
      )
    );

  if (!event) {
    return h(
      'section',
      { class: 'screen screen--bracket', 'data-screen': 'bracket' },
      h('h1', { class: 'screen__title' }, 'Playoff Bracket'),
      EventPicker({ events, activeEventId: eventId, onPick }),
      h('p', { class: 'screen__empty' }, 'No playoff yet — hit Continue to play an event.')
    );
  }

  return h(
    'section',
    { class: 'screen screen--bracket', 'data-screen': 'bracket' },
    head(eventLabel(entry)),
    EventPicker({ events, activeEventId: eventId, onPick }),
    ...bracketContent(state, dispatch, store, eventId)
  );
}

/**
 * The playoff body for a resolved event: the format legend + the bracket view
 * (or an empty note for events without a playoff). Returns an array of VNodes
 * (no outer screen chrome, title, or EventPicker), so it can be embedded by
 * either the standalone {@link BracketScreen} or the unified Tournament screen.
 * Assumes `eventId` names a played event.
 *
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @param {object} [store]
 * @param {string} eventId
 * @returns {Array<*>} VNodes (some entries may be null)
 */
export function bracketContent(state, dispatch, store, eventId) {
  const event = selectEvent(state, eventId);
  const playoffStage = playoffStageOf(event);
  const model = playoffStage ? buildBracketView(event, playoffStage) : null;

  // Team display lookup (tag/name) for the cards.
  /** @type {Record<string, object>} */
  const teamsById = {};
  if (model) {
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
  }

  const realStore = store || { getState: () => state, dispatch };
  const onMatch = (matchId) => {
    const series = playoffStage ? findSeriesByMatchId(event, matchId, playoffStage.id) : null;
    if (series && series.id) openSeries(realStore, series.id);
  };

  const followed = selectFollowedTeam(state);
  const followedTeamId = followed ? followed.id : null;

  return [
    playoffStage ? bracketLegend(playoffStage.bracketType) : null,
    model
      ? BracketView({ model, teamsById, followedTeamId, onMatch })
      : h('p', { class: 'screen__empty' }, 'This event has no playoff bracket.')
  ];
}

/** A short explainer of how the bracket format works (the part people find confusing). */
function bracketLegend(bracketType) {
  const triple = bracketType === 'triple';
  const title = triple ? 'Triple-elimination' : 'Double-elimination';
  const steps = triple
    ? [
        ['Upper', 'everyone starts here; a loss drops you to Middle'],
        ['Middle', 'a second loss drops you to Lower'],
        ['Lower', 'a third loss eliminates you']
      ]
    : [
        ['Winners', 'everyone starts here; a loss drops you to Losers'],
        ['Losers', 'a second loss eliminates you'],
        ['Grand Final', 'the Winners champion meets the Losers survivor']
      ];
  return h(
    'div',
    { class: 'bracket__legend' },
    h('span', { class: 'bracket__legend-title' }, title),
    h(
      'div',
      { class: 'bracket__legend-steps' },
      steps.map(([tier, desc]) =>
        h(
          'span',
          { key: tier, class: 'bracket__legend-step' },
          h('span', { class: 'bracket__legend-tier' }, tier),
          h('span', { class: 'bracket__legend-desc' }, desc)
        )
      )
    )
  );
}
