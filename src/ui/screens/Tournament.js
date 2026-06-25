/**
 * ui/screens/Tournament.js — the unified Tournament screen (CONTRACTS-UI §5, id
 * 'tournament').
 *
 * Pure `(state, dispatch, store) => VNode`. A single entry point for ANY played
 * event that folds the former Standings and Bracket screens into one view with
 * two sub-tabs:
 *   - "Group Stage" (view='standings') → the group/swiss standings + placements
 *   - "Playoffs"    (view='bracket')   → the playoff bracket
 *
 * The event is chosen via the shared EventPicker (route param `eventId`,
 * defaulting to the followed team's latest event); the active sub-tab is the
 * route param `view` ('standings' by default). Both the picker and the tabs
 * navigate back to 'tournament' so the unified shell (header + picker + tabs)
 * stays put while only the body swaps. The bodies are reused verbatim from the
 * standalone screens via {@link standingsContent} / {@link bracketContent}, so
 * group standings and brackets remain fully reachable and correct.
 *
 * DOM-free; renders headlessly via toHtml.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { EventPicker } from '../components/EventPicker.js';
import { standingsContent } from './Standings.js';
import { bracketContent } from './Bracket.js';
import {
  selectRoute,
  selectEvent,
  selectPlayedEvents,
  selectDefaultEventId
} from '../../state/selectors.js';
import { eventLabel } from '../eventFormats.js';

/** Screen id (route key) for the router. */
export const SCREEN_ID = 'tournament';

/** The two sub-views the Tournament screen toggles between. */
const TABS = [
  { view: 'standings', label: 'Group Stage', glyph: '≡' },
  { view: 'bracket', label: 'Playoffs', glyph: '⑂' }
];

/** Normalize the route's `view` param to a known sub-view (default 'standings'). */
function normalizeView(params) {
  return params && params.view === 'bracket' ? 'bracket' : 'standings';
}

/**
 * The Tournament screen.
 * @param {object} state  the full store state
 * @param {(action:object)=>void} dispatch
 * @param {object} [store]
 * @returns {*} VNode
 */
export function TournamentScreen(state, dispatch, store) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const events = selectPlayedEvents(state);
  const eventId =
    params.eventId && events.some((e) => e.eventId === params.eventId)
      ? params.eventId
      : selectDefaultEventId(state);
  const event = eventId ? selectEvent(state, eventId) : null;
  const entry = events.find((e) => e.eventId === eventId) || null;
  const view = normalizeView(params);

  // The picker keeps the active sub-tab; the tabs keep the active event.
  const onPick = (eid) => dispatch(navigate('tournament', { eventId: eid, view }));
  const onTab = (v) =>
    dispatch(navigate('tournament', { eventId: eventId || undefined, view: v }));

  if (!event) {
    return h(
      'section',
      { class: 'screen screen--tournament', 'data-screen': 'tournament' },
      h('h1', { class: 'screen__title' }, 'Tournament'),
      EventPicker({ events, activeEventId: eventId, onPick }),
      h('p', { class: 'screen__empty' }, 'No event has been played yet. Hit Continue to play one.')
    );
  }

  const body =
    view === 'bracket'
      ? bracketContent(state, dispatch, store, eventId)
      : standingsContent(state, dispatch, eventId);

  return h(
    'section',
    { class: 'screen screen--tournament', 'data-screen': 'tournament' },
    h(
      'header',
      { class: 'screen__head' },
      h(
        'div',
        null,
        h('h1', { class: 'screen__title' }, 'Tournament'),
        h('p', { class: 'screen__subtitle' }, eventLabel(entry))
      )
    ),
    EventPicker({ events, activeEventId: eventId, onPick }),
    tabBar(view, onTab),
    h('div', { class: classNames('tournament__body', `tournament__body--${view}`) }, ...body)
  );
}

/** The Group Stage ↔ Playoffs sub-tab bar. */
function tabBar(activeView, onTab) {
  return h(
    'div',
    { class: 'tournament__tabs', role: 'tablist', 'aria-label': 'Tournament view' },
    TABS.map((t) => {
      const active = t.view === activeView;
      return h(
        'button',
        {
          key: t.view,
          type: 'button',
          role: 'tab',
          'aria-selected': active ? 'true' : 'false',
          class: classNames('tournament__tab', active && 'tournament__tab--active'),
          onClick: onTab ? () => onTab(t.view) : undefined
        },
        h('span', { class: 'tournament__tab-glyph', 'aria-hidden': 'true' }, t.glyph),
        h('span', { class: 'tournament__tab-label' }, t.label)
      );
    })
  );
}
