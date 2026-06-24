/**
 * ui/eventFormats.js — UI helpers mapping a played EventResult to its format
 * structure, so the Standings / Bracket screens can render ANY league/event
 * (not just the Pacific Kickoff). Pure, DOM-free; imports the declarative format
 * descriptors (config/formats) and slices stages by kind.
 */

import { KICKOFF_FORMAT } from '../config/formats/kickoff.js';
import { STAGE_FORMAT } from '../config/formats/stage.js';
import { MASTERS_FORMAT } from '../config/formats/masters.js';
import { CHAMPIONS_FORMAT } from '../config/formats/champions.js';

/** formatId -> FormatDescriptor. */
const FORMAT_BY_ID = Object.freeze({
  kickoff: KICKOFF_FORMAT,
  stage: STAGE_FORMAT,
  masters: MASTERS_FORMAT,
  champions: CHAMPIONS_FORMAT
});

/** Display labels shared across the season screens. */
export const SLOT_LABELS = Object.freeze({
  kickoff: 'Kickoff',
  m0: 'Masters One',
  stage1: 'Stage 1',
  m1: 'Masters Two',
  stage2: 'Stage 2',
  m2: 'Masters Three',
  stage3: 'Stage 3',
  champions: 'Champions'
});
export const REGION_LABELS = Object.freeze({
  pacific: 'Pacific',
  americas: 'Americas',
  emea: 'EMEA',
  china: 'China'
});
export const REGION_ORDER = Object.freeze(['pacific', 'americas', 'emea', 'china']);

/** The FormatDescriptor for an event (by its formatId), or null. */
export function formatOf(event) {
  return event ? FORMAT_BY_ID[event.formatId] || null : null;
}

/** The deciding bracket stage descriptor of an event's format (or null). */
export function playoffStageOf(event) {
  const fmt = formatOf(event);
  if (!fmt) return null;
  return fmt.stages.find((s) => s.kind === 'bracket') || null;
}

/**
 * The non-bracket stages (group / swiss) of an event's format, as
 * `{ id, label, kind }` for the Standings screen's group tables.
 * @returns {Array<{id:string, label:string, kind:string}>}
 */
export function groupStagesOf(event) {
  const fmt = formatOf(event);
  if (!fmt) return [];
  return fmt.stages
    .filter((s) => s.kind !== 'bracket')
    .map((s) => ({ id: s.id, label: s.name || s.id, kind: s.kind, advancersOut: s.advancersOut || 0 }));
}

/**
 * A human label for a played-event picker entry `{ slotId, region }`.
 * e.g. "Kickoff — Pacific", "Masters One".
 * @param {{slotId:string, region:string|null}} entry
 * @returns {string}
 */
export function eventLabel(entry) {
  if (!entry) return 'Event';
  const slot = SLOT_LABELS[entry.slotId] || entry.slotId;
  return entry.region ? `${slot} — ${REGION_LABELS[entry.region] || entry.region}` : slot;
}
