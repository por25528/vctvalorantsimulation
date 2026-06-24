/**
 * ui/components/Sidebar.js — the FM-style navigation hub (CONTRACTS-UI §4, §6).
 *
 * Vertical nav of the primary screens (home / squad / market / calendar /
 * standings / bracket / cp / champions / leaders / saves). The contextual screens
 * (team / player / development / match) are reached by clicking through other
 * screens, so they don't get their own top-level item — but if the active route
 * IS one of them we still surface a sensible highlight via NAV_PARENT. Includes
 * the followed-team badge.
 *
 * Pure props -> VNode. Navigation is delegated to `onNavigate(screen)`.
 */

import { h, classNames } from '../render.js';

/**
 * Primary nav items: screen id + label + glyph.
 * @type {Array<{screen:string,label:string,glyph:string}>}
 */
export const NAV_ITEMS = [
  { screen: 'home', label: 'Home', glyph: '⌂' },          // house
  { screen: 'matchday', label: 'Match Day', glyph: '▶' }, // day-by-day reveal
  { screen: 'news', label: 'Inbox', glyph: '📰' },        // news feed
  { screen: 'squad', label: 'Squad', glyph: '👥' },       // your team's roster
  { screen: 'market', label: 'Transfers', glyph: '⇄' },   // transfer market
  { screen: 'offseason', label: 'Transfer Window', glyph: '🔁' }, // end-of-season league transfer board
  { screen: 'calendar', label: 'Calendar', glyph: '▦' },  // grid
  { screen: 'standings', label: 'Standings', glyph: '≡' },// bars
  { screen: 'bracket', label: 'Bracket', glyph: '⑂' },    // bracket-ish
  { screen: 'rankings', label: 'World Ranking', glyph: '🌐' }, // global Elo ranking
  { screen: 'cp', label: 'CP Race', glyph: '◈' },         // points race
  { screen: 'champions', label: 'Champions', glyph: '🏆' },// trophy
  { screen: 'awards', label: 'Awards', glyph: '🏅' },     // medal
  { screen: 'leaders', label: 'Leaders', glyph: '★' },    // star
  { screen: 'editor', label: 'God Mode', glyph: '✎' },    // sandbox editor
  { screen: 'saves', label: 'Saves', glyph: '💾' }        // floppy disk
];

/**
 * Map a contextual screen to the nav item that should appear active when it's
 * showing (team/player relate to standings; match relates to bracket).
 * @type {Record<string,string>}
 */
const NAV_PARENT = {
  team: 'standings',
  player: 'standings',
  development: 'squad',
  match: 'bracket'
};

/**
 * @param {object} props
 * @param {{screen:string,params?:object}} [props.route]  active route
 * @param {{id?:string,name?:string,tag?:string}|null} [props.followedTeam]
 * @param {(screen:string) => void} [props.onNavigate]  nav handler
 * @returns {import('../render.js').VNode}
 */
export function Sidebar(props) {
  const { route = { screen: 'home' }, followedTeam = null, onNavigate = null, unread = 0 } =
    props || {};
  const current = (route && route.screen) || 'home';
  const activeScreen = NAV_PARENT[current] || current;

  return h(
    'nav',
    { class: 'sidebar', 'aria-label': 'Primary' },
    h(
      'div',
      { class: 'sidebar__brand' },
      h('span', { class: 'sidebar__logo' }, 'VCT'),
      h('span', { class: 'sidebar__title' }, '2026')
    ),
    h(
      'ul',
      { class: 'sidebar__nav' },
      NAV_ITEMS.map((item) => navItem(item, activeScreen, onNavigate, unread))
    ),
    followedBadge(followedTeam, onNavigate)
  );
}

/** One nav button (active item highlighted; News carries an unread badge). */
function navItem(item, activeScreen, onNavigate, unread) {
  const active = item.screen === activeScreen;
  const showBadge = item.screen === 'news' && unread > 0;
  return h(
    'li',
    { key: item.screen, class: 'sidebar__nav-item' },
    h(
      'button',
      {
        type: 'button',
        class: classNames('sidebar__item', active && 'sidebar__item--active'),
        'aria-current': active ? 'page' : undefined,
        onClick: onNavigate ? () => onNavigate(item.screen) : undefined
      },
      h('span', { class: 'sidebar__glyph', 'aria-hidden': 'true' }, item.glyph),
      h('span', { class: 'sidebar__label' }, item.label),
      showBadge ? h('span', { class: 'badge sidebar__badge' }, unread > 99 ? '99+' : String(unread)) : null
    )
  );
}

/** The followed-team badge (clicks through to the team screen). */
function followedBadge(team, onNavigate) {
  if (!team) {
    return h(
      'div',
      { class: 'sidebar__follow sidebar__follow--empty' },
      h('span', { class: 'sidebar__follow-label' }, 'No team followed')
    );
  }
  const name = team.name != null ? team.name : team.id;
  const tag = team.tag || (name ? String(name).slice(0, 3).toUpperCase() : '');
  return h(
    'button',
    {
      type: 'button',
      class: 'sidebar__follow badge badge--team',
      onClick: onNavigate ? () => onNavigate('team') : undefined,
      'aria-label': `Followed team: ${name}`
    },
    h('span', { class: 'sidebar__follow-tag' }, tag),
    h('span', { class: 'sidebar__follow-name' }, name)
  );
}
