/**
 * ui/components/EventPicker.js — a compact event/league switcher used by the
 * Standings and Bracket screens so you can browse ANY league's event (not just
 * the one you follow). A row of slot tabs (Kickoff / Masters One / Stage 1 / …)
 * plus, when the active slot is regional, a row of region sub-tabs.
 *
 * Pure `props -> VNode`. `onPick(eventId)` is fired with the chosen event id;
 * the caller re-navigates to its own screen with `{ eventId }`.
 */

import { h, classNames } from '../render.js';
import { SLOT_LABELS, REGION_LABELS } from '../eventFormats.js';

/**
 * @param {object} props
 * @param {Array<{eventId:string, slotId:string, region:string|null}>} props.events  played events
 * @param {string|null} [props.activeEventId]
 * @param {(eventId:string)=>void} [props.onPick]
 * @returns {import('../render.js').VNode|null}
 */
export function EventPicker(props) {
  const { events = [], activeEventId = null, onPick } = props || {};
  if (!events.length) return null;

  // Group events by slot, preserving first-seen (calendar) order.
  const slotOrder = [];
  const bySlot = new Map();
  for (const e of events) {
    if (!bySlot.has(e.slotId)) {
      bySlot.set(e.slotId, []);
      slotOrder.push(e.slotId);
    }
    bySlot.get(e.slotId).push(e);
  }

  const active = events.find((e) => e.eventId === activeEventId) || events[events.length - 1];
  const activeSlot = active.slotId;
  const slotEvents = bySlot.get(activeSlot) || [];
  const isRegional = slotEvents.some((e) => e.region);

  const pick = (eventId) => (onPick ? () => onPick(eventId) : undefined);

  const slotTab = (slotId) => {
    const evs = bySlot.get(slotId);
    // Keep the same region when switching slots where possible.
    const target = (evs.find((e) => e.region === active.region) || evs[0]).eventId;
    return h(
      'button',
      {
        key: slotId,
        type: 'button',
        class: classNames('picker__tab', slotId === activeSlot && 'picker__tab--active'),
        'aria-selected': slotId === activeSlot ? 'true' : 'false',
        onClick: pick(target)
      },
      SLOT_LABELS[slotId] || slotId
    );
  };

  const regionTab = (e) =>
    h(
      'button',
      {
        key: e.eventId,
        type: 'button',
        class: classNames('picker__region', e.eventId === active.eventId && 'picker__region--active'),
        'aria-selected': e.eventId === active.eventId ? 'true' : 'false',
        onClick: pick(e.eventId)
      },
      REGION_LABELS[e.region] || e.region
    );

  return h(
    'div',
    { class: 'picker' },
    h('div', { class: 'picker__tabs', role: 'tablist' }, slotOrder.map(slotTab)),
    isRegional ? h('div', { class: 'picker__regions', role: 'tablist' }, slotEvents.map(regionTab)) : null
  );
}
