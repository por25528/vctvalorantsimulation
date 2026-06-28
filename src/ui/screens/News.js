/**
 * ui/screens/News.js — the World Feed (route id 'news').
 *
 * The spectator's window into the world's STORIES. A rich, scrollable, categorised
 * feed that blends the live news inbox (results, awards, signings, knocks) with the
 * cross-season storylines mined from the frozen history ledger — dynasties,
 * rivalries, breakout arcs, upsets, comebacks, retirement tributes. Each item
 * carries an icon, an era tag, a tone accent and a sentence of context, and clicks
 * through into the team / player it's about.
 *
 * Pure `(state, dispatch) => VNode`. Reads game truth ONLY through the worldFeed
 * derive (which itself reads selectors), never the raw state shape. The category
 * filter lives in the route params, so the feed stays a pure function of state and
 * serializes headlessly via toHtml. Icons, never emoji (emoji render as tofu).
 */

import { h, classNames } from '../render.js';
import { Icon } from '../components/Icon.js';
import { navigate, markNewsRead } from '../../state/actions.js';
import { selectUnreadNews, selectRoute } from '../../state/selectors.js';
import { worldFeedView } from '../worldFeed.js';

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @returns {import('../render.js').VNode}
 */
export function News(state, dispatch) {
  const route = selectRoute(state) || {};
  const filter = (route.params && route.params.filter) || 'all';
  const view = worldFeedView(state, filter);
  const unread = selectUnreadNews(state);

  const go = (screen, params) => (dispatch ? dispatch(navigate(screen, params || {})) : undefined);
  const setFilter = (id) => (dispatch ? dispatch(navigate('news', { filter: id })) : undefined);

  return h(
    'section',
    { class: 'screen screen--news', id: 'screen-news' },
    h(
      'header',
      { class: 'screen__head' },
      h('h1', { class: 'screen__title' }, 'World Feed'),
      unread > 0 ? h('span', { class: 'badge news__unread' }, `${unread} new`) : null,
      view.total > 0
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
    h(
      'p',
      { class: 'screen__subtitle news__lede' },
      'Every storyline the world is writing — dynasties, rivalries, breakouts and upsets — newest first.'
    ),
    view.total > 0 ? filterBar(view, filter, setFilter) : null,
    view.total === 0
      ? empty('The world is quiet — step time forward on the hub and the headlines will roll in.')
      : view.items.length === 0
        ? empty('No stories in this category yet.')
        : h('ul', { class: 'news__feed worldfeed' }, view.items.map((it) => feedRow(it, go)))
  );
}

/** Empty-state paragraph. */
function empty(text) {
  return h('p', { class: 'card__muted news__empty' }, text);
}

/** The category filter chips (only groups with items show; active highlighted). */
function filterBar(view, filter, setFilter) {
  return h(
    'div',
    { class: 'worldfeed__filters', role: 'group', 'aria-label': 'Filter the world feed' },
    view.groups.map((g) =>
      h(
        'button',
        {
          key: g.id,
          type: 'button',
          class: classNames('worldfeed__chip', g.id === filter && 'worldfeed__chip--active'),
          'aria-pressed': g.id === filter ? 'true' : 'false',
          onClick: () => setFilter(g.id)
        },
        h('span', { class: 'worldfeed__chip-label' }, g.label),
        h('span', { class: 'worldfeed__chip-count' }, `${g.count}`)
      )
    )
  );
}

/** One feed row — icon, headline, context blurb, era tag; clickable into subject. */
function feedRow(it, go) {
  const clickPlayer = it.playerId ? () => go('player', { playerId: it.playerId }) : null;
  const clickTeam = !it.playerId && it.teamId ? () => go('team', { teamId: it.teamId }) : null;
  const onClick = clickPlayer || clickTeam || undefined;

  return h(
    'li',
    {
      key: it.id,
      class: classNames(
        'worldfeed__item',
        `worldfeed__item--${it.tone}`,
        `worldfeed__item--${it.category}`,
        it.source === 'story' && 'worldfeed__item--story',
        onClick && 'worldfeed__item--link'
      ),
      onClick
    },
    h('span', { class: 'worldfeed__icon' }, Icon(it.icon, { size: 18 })),
    h(
      'div',
      { class: 'worldfeed__body' },
      h('span', { class: 'worldfeed__headline' }, it.headline),
      it.blurb ? h('span', { class: 'worldfeed__blurb' }, it.blurb) : null
    ),
    h('span', { class: 'worldfeed__era' }, it.era)
  );
}
