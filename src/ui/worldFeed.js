/**
 * ui/worldFeed.js — pure presentation model for the World Feed (News screen) and
 * the God-View "happenings" panel. DOM-free, deterministic, no randomness.
 *
 * It BLENDS two narrative sources into one render-ready, categorised feed:
 *   1. the live inbox news (granular moments as they happen — results, awards,
 *      signings, knocks), read through `selectInbox`; and
 *   2. the cross-season STORYLINES mined from the frozen history ledger
 *      (dynasties, rivalries, breakout arcs, upsets…), via the pure storyline
 *      engine (`engine/career/storylines.js`).
 *
 * Each entry is tagged with a coarse GROUP (the filter chips), an Icon name, an
 * era tag and a tone accent, and carries the team/player ids for click-through.
 * The feed reads game truth only through selectors, so it never touches the raw
 * state shape, and is fully guarded for empty / early-career worlds.
 */

import {
  selectCareerHistory,
  selectInbox,
  selectOffseasonReport,
  selectWorld
} from '../state/selectors.js';
import { deriveStorylines, STORY_GROUP, STORY_ICON } from '../engine/career/storylines.js';
import { SLOT_LABELS } from './eventFormats.js';

/* --------------------------- group + kind maps -------------------------- */

/** The World Feed filter groups, in display order (with their chip labels). */
export const FEED_GROUPS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'titles', label: 'Titles' },
  { id: 'rivalries', label: 'Rivalries' },
  { id: 'stars', label: 'Stars' },
  { id: 'results', label: 'Results' },
  { id: 'moves', label: 'Transfers' },
  { id: 'drama', label: 'Drama' },
  { id: 'farewells', label: 'Farewells' }
]);

/** Live news `kind` → feed group. */
const NEWS_GROUP = Object.freeze({
  champion: 'titles', result: 'results', award: 'stars',
  transfer: 'moves', retirement: 'farewells', newgen: 'stars', injury: 'results'
});

/** Live news `kind` → Icon name. */
const NEWS_ICON = Object.freeze({
  champion: 'trophy', result: 'target', award: 'medal',
  transfer: 'swap', retirement: 'star', newgen: 'flame', injury: 'cross'
});

/** Rough drama weight for a live news item (so stories lead within a season). */
const NEWS_WEIGHT = Object.freeze({
  champion: 6, award: 4, transfer: 3, retirement: 4, result: 2, newgen: 2, injury: 1
});

/** A short era tag for a live news item ("S2 · Stage 1" / "S2 · Off-season"). */
function newsEra(it) {
  const s = `S${(it.seasonIndex || 0) + 1}`;
  if (it.slotId && SLOT_LABELS[it.slotId]) return `${s} · ${SLOT_LABELS[it.slotId]}`;
  if (it.kind === 'retirement' || it.kind === 'transfer' || it.kind === 'newgen') return `${s} · Off-season`;
  return s;
}

/* ------------------------------ blending -------------------------------- */

/**
 * Build the full, unified World Feed — every storyline + every live news item,
 * de-duplicated and ordered newest-era-first then most-dramatic-first.
 *
 * @param {object} state
 * @returns {Array<{ id:string, source:'story'|'news', group:string, category:string,
 *   icon:string, headline:string, blurb:string, era:string, tone:string,
 *   seasonIndex:number, teamId:string|null, playerId:string|null, weight:number }>}
 */
export function buildWorldFeed(state) {
  const history = selectCareerHistory(state);
  const world = selectWorld(state);
  const stories = deriveStorylines(history, world, { offseasonReport: selectOffseasonReport(state) });

  // Storyline crownings supersede the live "champion" line for the same title,
  // so a crowned season shows the richer story, not a bare duplicate.
  const crowned = new Set();
  for (const s of stories) {
    if (s.category === 'crown' && s.teamId != null) crowned.add(`${s.seasonIndex}:${s.teamId}`);
  }

  const out = [];
  for (const s of stories) {
    out.push({
      id: `story:${s.id}`,
      source: 'story',
      group: STORY_GROUP[s.category] || 'drama',
      category: s.category,
      icon: STORY_ICON[s.category] || 'inbox',
      headline: s.headline,
      blurb: s.blurb || '',
      era: s.era,
      tone: s.tone,
      seasonIndex: s.seasonIndex,
      teamId: s.teamId,
      playerId: s.playerId,
      weight: s.weight
    });
  }

  for (const it of selectInbox(state)) {
    if (it.kind === 'champion' && it.teamId != null && crowned.has(`${it.seasonIndex}:${it.teamId}`)) continue;
    out.push({
      id: `news:${it.id}`,
      source: 'news',
      group: NEWS_GROUP[it.kind] || 'results',
      category: it.kind,
      icon: NEWS_ICON[it.kind] || 'inbox',
      headline: it.headline,
      blurb: '',
      era: newsEra(it),
      tone: it.tone || 'neutral',
      seasonIndex: it.seasonIndex || 0,
      teamId: it.teamId || null,
      playerId: it.playerId || null,
      weight: NEWS_WEIGHT[it.kind] || 1
    });
  }

  out.sort((a, b) =>
    b.seasonIndex - a.seasonIndex ||
    b.weight - a.weight ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  return out;
}

/**
 * The World Feed view-model for the News screen: the grouped, filtered feed plus
 * the per-group counts that drive the filter chips. Unknown/empty filters fall
 * back to 'all'.
 *
 * @param {object} state
 * @param {string} [filter='all']
 * @returns {{ items:object[], total:number, filter:string,
 *   groups:Array<{id:string, label:string, count:number}> }}
 */
export function worldFeedView(state, filter = 'all') {
  const all = buildWorldFeed(state);
  const counts = { all: all.length };
  for (const it of all) counts[it.group] = (counts[it.group] || 0) + 1;
  const groups = FEED_GROUPS
    .filter((g) => g.id === 'all' || (counts[g.id] || 0) > 0)
    .map((g) => ({ id: g.id, label: g.label, count: counts[g.id] || 0 }));
  const active = counts[filter] != null && filter !== undefined ? filter : 'all';
  const safeFilter = groups.some((g) => g.id === active) ? active : 'all';
  const items = safeFilter === 'all' ? all : all.filter((it) => it.group === safeFilter);
  return { items, total: all.length, filter: safeFilter, groups };
}

/**
 * The compact happenings feed for the God-View hub: the freshest, most dramatic
 * items (stories + live news), newest-first, capped at `limit`. Falls back to the
 * marquee transfer of the latest window when the feed is otherwise quiet so the
 * panel always tells a story.
 *
 * @param {object} state
 * @param {number} [limit=8]
 * @returns {Array<{id:string, icon:string, headline:string, blurb:string,
 *   era:string, tone:string, category:string, teamId:string|null, playerId:string|null}>}
 */
export function happeningsFeed(state, limit = 8) {
  const feed = buildWorldFeed(state);
  if (!feed.length) return [];

  // The hub panel is a HIGHLIGHT reel, not a raw timeline: rank by drama, but keep
  // it fresh by bonusing the most recent seasons so a current champion / signing
  // still bubbles up alongside the all-time arcs (and granular old results sink).
  const latest = feed.reduce((m, it) => Math.max(m, it.seasonIndex), 0);
  const priority = (it) => it.weight + Math.max(0, 5 - (latest - it.seasonIndex));
  const ranked = feed.slice().sort((a, b) =>
    priority(b) - priority(a) ||
    b.seasonIndex - a.seasonIndex ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );

  return ranked.slice(0, Math.max(0, limit)).map((it) => ({
    id: it.id,
    icon: it.icon,
    headline: it.headline,
    blurb: it.blurb,
    era: it.era,
    tone: it.tone,
    category: it.category,
    teamId: it.teamId,
    playerId: it.playerId
  }));
}
