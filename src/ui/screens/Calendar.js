/**
 * ui/screens/Calendar.js — the full-season calendar (CONTRACTS-PERSIST §6, id 'calendar').
 *
 * Pure `(state, dispatch, store) => VNode`. Renders the whole 20-event timeline
 * grouped by the 8 CALENDAR slots:
 *   - REGIONAL slots (kickoff / stage1 / stage2 / stage3) list all 4 leagues
 *     (pacific / americas / emea / china), each with its winner + a played/upcoming
 *     status badge. Each league row is clickable -> openEvent(store, slotId, region).
 *   - INTERNATIONAL slots (m0 / m1 / m2 / champions) are a single event row
 *     showing the winner + status; clickable -> openEvent(store, slotId).
 * A header shows the season cursor ("Slot X of 8").
 *
 * Reads game truth ONLY through season selectors (selectCalendar, selectSeason,
 * selectSlot, selectSlotsPlayed, selectTeam). Navigation flows through the
 * `openEvent(store, slotId, region)` command (forwarded `store`) so the screen
 * stays free of document/window; when `store` is omitted (headless render-only)
 * it falls back to dispatching `navigate` so the calendar is still inspectable.
 *
 * SIGNATURE / WIRING CONTRACT (router/app author must honour this):
 *   Calendar(state, dispatch, store) => VNode
 *   - `state`    : the full store state (read via selectors)
 *   - `dispatch` : store.dispatch (for the navigate fallback)
 *   - `store`    : the store reference, forwarded to openEvent(store, …)
 */

import { h, classNames } from '../render.js';
import { Icon } from '../components/Icon.js';
import { navigate } from '../../state/actions.js';
import { openEvent } from '../../state/commands.js';
import {
  selectCalendar,
  selectSeason,
  selectSlot,
  selectSlotsPlayed,
  selectTeam
} from '../../state/selectors.js';

/** Fixed league order shown under every regional slot (mirrors REGION_ORDER). */
const REGION_ORDER = ['pacific', 'americas', 'emea', 'china'];

/** Display labels for regions + slot types (UI-only sugar, no engine import). */
const REGION_LABELS = {
  pacific: 'Pacific',
  americas: 'Americas',
  emea: 'EMEA',
  china: 'China'
};
const SLOT_LABELS = {
  kickoff: 'Kickoff',
  m0: 'Masters One',
  stage1: 'Stage 1',
  m1: 'Masters Two',
  stage2: 'Stage 2',
  m2: 'Masters Three',
  stage3: 'Stage 3',
  champions: 'Champions'
};
const TYPE_LABELS = {
  kickoff: 'Kickoff',
  stage: 'Stage',
  masters: 'Masters',
  champions: 'Champions'
};

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @param {object} [store]
 * @returns {import('../render.js').VNode}
 */
export function Calendar(state, dispatch, store) {
  const season = selectSeason(state);
  const calendar = selectCalendar(state);
  const played = selectSlotsPlayed(state);
  const total = calendar.length || 8;

  // Navigate to an event: prefer the command (hydrates/threads params); fall
  // back to a bare navigate when no store reference is present (render tests).
  const goEvent = (slotId, region) => {
    if (store) return openEvent(store, slotId, region || undefined);
    if (dispatch) {
      const eventId = region ? `${slotId}-${region}` : slotId;
      return dispatch(navigate('standings', { slotId, region: region || null, eventId }));
    }
    return undefined;
  };

  const complete = !!(season && season.complete);
  const cursorText = complete
    ? `Season complete — ${total} of ${total} slots played`
    : `Slot ${Math.min(played + 1, total)} of ${total}`;

  return h(
    'section',
    { class: 'screen screen--calendar', id: 'screen-calendar' },
    h(
      'header',
      { class: 'screen__head' },
      h('h1', { class: 'screen__title' }, 'Calendar'),
      h(
        'span',
        {
          class: classNames(
            'badge',
            'calendar__cursor',
            complete && 'badge--win'
          )
        },
        cursorText
      )
    ),
    h(
      'ol',
      { class: 'calendar__timeline' },
      calendar.map((slot, i) =>
        slotBlock(state, selectSlot(state, i), slot, i, played, goEvent)
      )
    )
  );
}

/**
 * One calendar slot block: a header (name / type / status) plus its event rows
 * (4 region rows for a regional slot, 1 row for an international slot).
 */
function slotBlock(state, slotView, slot, index, played, goEvent) {
  const isPlayed = index < played;
  const isCurrent = index === played;
  const statusLabel = isPlayed ? 'Played' : isCurrent ? 'Up next' : 'Upcoming';
  const entries = (slotView && slotView.entries) || [];

  const rows = slot.scope === 'regional'
    ? REGION_ORDER.map((region) =>
        eventRow(state, slot, region, findEntry(entries, region), goEvent)
      )
    : [eventRow(state, slot, null, entries[0] || null, goEvent)];

  return h(
    'li',
    {
      key: slot.id,
      class: classNames(
        'calendar__slot',
        `calendar__slot--${slot.type}`,
        isPlayed && 'calendar__slot--played',
        isCurrent && 'calendar__slot--current'
      )
    },
    h(
      'div',
      { class: 'calendar__slot-head' },
      h('span', { class: 'calendar__slot-index' }, `${index + 1}`),
      h(
        'div',
        { class: 'calendar__slot-titles' },
        h('span', { class: 'calendar__slot-name' }, SLOT_LABELS[slot.id] || slot.id),
        h(
          'span',
          { class: 'calendar__slot-meta' },
          `${TYPE_LABELS[slot.type] || slot.type} · ${slot.scope}`
        )
      ),
      h(
        'span',
        {
          class: classNames(
            'badge',
            'calendar__slot-status',
            isPlayed ? 'badge--win calendar__slot-status--played'
              : isCurrent ? 'calendar__slot-status--current'
              : 'calendar__slot-status--upcoming'
          )
        },
        statusLabel
      )
    ),
    h('ul', { class: 'calendar__events' }, rows)
  );
}

/** Find the season event entry for a given region within a slot's entries. */
function findEntry(entries, region) {
  return entries.find((e) => e.region === region) || null;
}

/**
 * One event row inside a slot: league/international label + winner + status,
 * clickable -> the event's standings/bracket.
 */
function eventRow(state, slot, region, entry, goEvent) {
  const played = !!entry;
  const label = region ? (REGION_LABELS[region] || region) : 'International';
  const winnerId = played ? winnerOf(entry.result) : null;
  const winnerName = winnerId ? teamName(state, winnerId) : null;
  const eventId = region ? `${slot.id}-${region}` : slot.id;

  return h(
    'li',
    { class: 'calendar__event-item', key: eventId },
    h(
      'button',
      {
        type: 'button',
        class: classNames(
          'calendar__event',
          played ? 'calendar__event--played' : 'calendar__event--upcoming'
        ),
        onClick: () => goEvent(slot.id, region),
        'aria-label': `${SLOT_LABELS[slot.id] || slot.id} — ${label} — ${played ? 'played' : 'upcoming'}`
      },
      h('span', { class: 'calendar__event-league' }, label),
      h(
        'span',
        { class: 'calendar__event-winner' },
        played
          ? h(
              'span',
              { class: 'calendar__event-champ' },
              Icon('trophy', { size: 13, class: 'calendar__event-trophy' }),
              winnerName || '—'
            )
          : h('span', { class: 'card__muted' }, '—')
      ),
      h(
        'span',
        {
          class: classNames(
            'badge',
            'calendar__event-status',
            played ? 'badge--win' : 'calendar__event-status--upcoming'
          )
        },
        played ? 'Played' : 'Upcoming'
      )
    )
  );
}

/** The rank-1 teamId of an EventResult, or null. */
function winnerOf(result) {
  if (!result || !Array.isArray(result.placements)) return null;
  const top = result.placements.find((p) => p.rank === 1);
  return top ? top.teamId : null;
}

/** Display name for a team id (falls back to the id). */
function teamName(state, teamId) {
  const team = selectTeam(state, teamId);
  return (team && team.name) || teamId;
}
