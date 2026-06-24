/**
 * engine/career/calendar.js — the 2026 season calendar (CONTRACTS-SEASON §2).
 *
 * Eight calendar slots drive the whole cycle. Regional slots (kickoff, stage1,
 * stage2, stage3) expand to one event PER league (4 parallel events); the four
 * international slots (m0, m1, m2, champions) are single events.
 *
 *   Feeds:  m0 <- kickoff,  m1 <- stage1,  m2 <- stage2.
 *   m2 is the final Masters (finalMasters:true) — its winner takes the Champions
 *   direct slot. stage3 awards CP only (it feeds Champions via cumulative points).
 *   champions = 1 direct (m2 winner) + 15 by cumulative CP.
 *
 * Pure data, named export only. Frozen — the calendar is immutable. No
 * randomness, no I/O, no DOM; identical in Node and the browser.
 *
 * @typedef {Object} CalendarSlot
 * @property {string} id
 * @property {'kickoff'|'stage'|'masters'|'champions'} type
 * @property {'regional'|'international'} scope
 * @property {string} formatId               // kickoff | stage | masters | champions
 * @property {string} [feedsFrom]            // masters: the regional slot whose qualifiers seed it
 * @property {boolean} [finalMasters]        // the last Masters (m2): its winner gets the Champions direct slot
 * @property {number} index                  // position in the calendar (0-based)
 */

/** @type {ReadonlyArray<CalendarSlot>} */
export const CALENDAR = Object.freeze([
  Object.freeze({ id: 'kickoff', type: 'kickoff', scope: 'regional', formatId: 'kickoff', index: 0 }),
  Object.freeze({ id: 'm0', type: 'masters', scope: 'international', formatId: 'masters', feedsFrom: 'kickoff', index: 1 }),
  Object.freeze({ id: 'stage1', type: 'stage', scope: 'regional', formatId: 'stage', index: 2 }),
  Object.freeze({ id: 'm1', type: 'masters', scope: 'international', formatId: 'masters', feedsFrom: 'stage1', index: 3 }),
  Object.freeze({ id: 'stage2', type: 'stage', scope: 'regional', formatId: 'stage', index: 4 }),
  Object.freeze({ id: 'm2', type: 'masters', scope: 'international', formatId: 'masters', feedsFrom: 'stage2', finalMasters: true, index: 5 }),
  Object.freeze({ id: 'stage3', type: 'stage', scope: 'regional', formatId: 'stage', index: 6 }),
  Object.freeze({ id: 'champions', type: 'champions', scope: 'international', formatId: 'champions', index: 7 })
]);
