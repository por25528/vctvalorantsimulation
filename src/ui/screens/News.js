/**
 * ui/screens/News.js — the career news inbox (CONTRACTS-POLISH §0/P7b, id 'news').
 *
 * Pure `(state, dispatch) => VNode`. Renders the accumulated news feed newest
 * first: each item shows a kind glyph, the headline, a season tag, and a tone
 * accent (good/bad are followed-team flavored). Items with a playerId/teamId
 * click through. A "Mark all read" control clears the unread state. Read-only of
 * game truth; serializes headlessly via toHtml.
 */

import { h, classNames } from '../render.js';
import { navigate, markNewsRead } from '../../state/actions.js';
import { selectInbox, selectUnreadNews } from '../../state/selectors.js';

/** Slot labels for the per-item season/when tag. */
const SLOT_LABELS = {
  kickoff: 'Kickoff', m0: 'Masters One', stage1: 'Stage 1', m1: 'Masters Two',
  stage2: 'Stage 2', m2: 'Masters Three', stage3: 'Stage 3', champions: 'Champions'
};

/** Per-kind display glyph. */
const KIND_GLYPH = {
  champion: '🏆', result: '🎯', award: '🏅', transfer: '⇄', retirement: '🎖', newgen: '🌱', injury: '🩹'
};

/** A short "when" tag for an item, e.g. "S2 · Stage 1" or "S2 · Off-season". */
function whenLabel(it) {
  const s = `S${(it.seasonIndex || 0) + 1}`;
  if (it.slotId && SLOT_LABELS[it.slotId]) return `${s} · ${SLOT_LABELS[it.slotId]}`;
  if (it.kind === 'retirement' || it.kind === 'transfer' || it.kind === 'newgen') return `${s} · Off-season`;
  return s;
}

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @returns {import('../render.js').VNode}
 */
export function News(state, dispatch) {
  const items = selectInbox(state);
  const unread = selectUnreadNews(state);
  const go = (screen, params) => (dispatch ? dispatch(navigate(screen, params || {})) : undefined);

  return h(
    'section',
    { class: 'screen screen--news', id: 'screen-news' },
    h(
      'header',
      { class: 'screen__head' },
      h('h1', { class: 'screen__title' }, 'Inbox'),
      unread > 0 ? h('span', { class: 'badge news__unread' }, `${unread} new`) : null,
      items.length > 0
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn--sm news__mark-all',
              disabled: unread === 0 ? true : undefined,
              onClick: dispatch && unread > 0 ? () => dispatch(markNewsRead()) : undefined
            },
            'Mark all read'
          )
        : null
    ),
    items.length === 0
      ? h('p', { class: 'card__muted news__empty' }, 'No news yet — hit Continue to play through the season and the headlines will roll in.')
      : h('ul', { class: 'news__feed' }, items.map((it) => newsRow(it, go)))
  );
}

/** One news row. */
function newsRow(it, go) {
  const clickPlayer = it.playerId ? () => go('player', { playerId: it.playerId }) : null;
  const clickTeam = !it.playerId && it.teamId ? () => go('team', { teamId: it.teamId }) : null;
  const onClick = clickPlayer || clickTeam || undefined;

  return h(
    'li',
    {
      key: it.id,
      class: classNames('news__item', `news__item--${it.tone}`, `news__item--${it.kind}`, !it.read && 'news__item--unread'),
      onClick
    },
    h('span', { class: 'news__glyph', 'aria-hidden': 'true' }, KIND_GLYPH[it.kind] || '•'),
    h(
      'div',
      { class: 'news__body' },
      h('span', { class: 'news__headline' }, it.headline),
      h('span', { class: 'news__when' }, whenLabel(it))
    ),
    !it.read ? h('span', { class: 'news__dot', 'aria-label': 'unread' }) : null
  );
}
