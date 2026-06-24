/**
 * state/slices/inbox.js — the career news inbox (CONTRACTS-POLISH §0/P7b).
 *
 * An accumulating, capped feed of NewsItem objects (engine/career/news.js
 * generates them; this slice stamps each with a monotonic id + an unread flag on
 * append). Newest items live at the END of `items`; the feed is capped to the
 * last BALANCE.CAREER.NEWS.INBOX_CAP so a long career's save stays bounded.
 *
 * Pure reducer (state, action) -> new state. No Date.now / Math.random / DOM — ids
 * come from a deterministic per-slice sequence (never wall-clock), so the inbox is
 * reproducible from the same sequence of appends.
 *
 * @typedef {import('../../engine/career/news.js').NewsItem} NewsItem
 * @typedef {NewsItem & { id:string, read:boolean }} InboxItem
 * @typedef {Object} InboxSlice
 * @property {InboxItem[]} items  oldest first; capped to INBOX_CAP
 * @property {number} seq         next id ordinal
 */

import { BALANCE } from '../../config/balance.js';

const CAP = BALANCE.CAREER.NEWS.INBOX_CAP;

/** Action type constants (owned here; re-exported by state/actions.js). */
export const INBOX_APPEND = 'inbox/append';
export const INBOX_MARK_READ = 'inbox/markRead';
export const INBOX_LOAD = 'inbox/load';

/** @type {InboxSlice} */
export const initialInboxState = Object.freeze({ items: Object.freeze([]), seq: 0 });

/** Parse the ordinal out of an `n<seq>` id (NaN if not one). */
function seqOf(id) {
  return typeof id === 'string' && id[0] === 'n' ? parseInt(id.slice(1), 10) : NaN;
}

/**
 * Inbox reducer.
 *   inbox/append  { items?:NewsItem[], item?:NewsItem }  — stamp + append, cap
 *   inbox/markRead { id? }                                — mark one (or all) read
 *   inbox/load     { items:InboxItem[] }                  — install a saved inbox
 *
 * @param {InboxSlice} [slice]
 * @param {{type:string, items?:object[], item?:object, id?:string}} action
 * @returns {InboxSlice}
 */
export function inboxReducer(slice = initialInboxState, action) {
  switch (action.type) {
    case INBOX_APPEND: {
      const incoming = Array.isArray(action.items)
        ? action.items
        : action.item ? [action.item] : [];
      if (incoming.length === 0) return slice;
      let seq = slice.seq;
      const stamped = incoming.map((it) => ({ ...it, id: `n${seq++}`, read: false }));
      const merged = [...slice.items, ...stamped];
      const items = merged.length > CAP ? merged.slice(merged.length - CAP) : merged;
      return { items, seq };
    }
    case INBOX_MARK_READ: {
      if (action.id) {
        let changed = false;
        const items = slice.items.map((it) => {
          if (it.id === action.id && !it.read) { changed = true; return { ...it, read: true }; }
          return it;
        });
        return changed ? { ...slice, items } : slice;
      }
      if (slice.items.every((it) => it.read)) return slice;
      return { ...slice, items: slice.items.map((it) => (it.read ? it : { ...it, read: true })) };
    }
    case INBOX_LOAD: {
      const loaded = Array.isArray(action.items) ? action.items : [];
      const items = loaded.length > CAP ? loaded.slice(loaded.length - CAP) : loaded.slice();
      let seq = 0;
      for (const it of items) {
        const n = seqOf(it && it.id);
        if (Number.isFinite(n) && n + 1 > seq) seq = n + 1;
      }
      return { items, seq };
    }
    default:
      return slice;
  }
}
