/**
 * ui/components/Sidebar.js — the broadcast control rail (CONTRACTS-UI §4, §6).
 *
 * The mission-control navigation surface for the god-observer world sim. A
 * vertical rail of the primary screens, grouped into labelled sections (WATCH /
 * COMPETITION / WORLD / GOD TOOLS) so it reads like a control desk rather than a
 * flat menu. The Tournament item is the single entry point for an event's group
 * stage + playoff bracket. Contextual screens (team / player / development /
 * match) have no top-level item; if the active route IS one of them we surface a
 * sensible highlight via NAV_PARENT.
 *
 * The footer carries the "NOW VIEWING" free-camera chip — the spectator's
 * current focus (any team), NOT a managed/owned team. Clicking it jumps to that
 * team's page.
 *
 * Pure props -> VNode. Navigation is delegated to `onNavigate(screen)`.
 */

import { h, classNames } from '../render.js';
import { Icon } from './Icon.js';

/**
 * Primary nav items: screen id + label + icon name (see {@link Icon}) + the
 * section the item is grouped under. The legacy `glyph` is retained only as a
 * textual fallback / accessibility hint — the rendered marker is the coherent
 * inline-SVG `icon`.
 * @type {Array<{screen:string,label:string,icon:string,glyph:string,section:string}>}
 */
export const NAV_ITEMS = [
  { screen: 'home', label: 'God View', icon: 'home', glyph: '⌂', section: 'watch' },
  { screen: 'matchday', label: 'Match Day', icon: 'play', glyph: '▶', section: 'watch' },
  { screen: 'news', label: 'World Feed', icon: 'inbox', glyph: '✉', section: 'watch' },
  // Unified Tournament tab (group stage + playoff bracket). Label pinned by tests.
  { screen: 'tournament', label: 'Tournament', icon: 'bracket', glyph: '⑂', section: 'competition' },
  { screen: 'calendar', label: 'Calendar', icon: 'calendar', glyph: '▦', section: 'competition' },
  { screen: 'cp', label: 'CP Race', icon: 'target', glyph: '◈', section: 'competition' },
  { screen: 'champions', label: 'Champions', icon: 'trophy', glyph: '♚', section: 'competition' },
  { screen: 'hof', label: 'Hall of Fame', icon: 'hall', glyph: '♛', section: 'competition' },
  { screen: 'awards', label: 'Awards', icon: 'medal', glyph: '✦', section: 'competition' },
  { screen: 'leaders', label: 'Leaders', icon: 'star', glyph: '★', section: 'competition' },
  { screen: 'legends', label: 'All-Time', icon: 'crown', glyph: '♛', section: 'competition' },
  { screen: 'tier2', label: 'Challengers', icon: 'standings', glyph: '≡', section: 'competition' },
  { screen: 'rankings', label: 'World Ranking', icon: 'globe', glyph: '◍', section: 'world' },
  { screen: 'ladder', label: 'Ranked Ladder', icon: 'standings', glyph: '≣', section: 'world' },
  { screen: 'stats', label: 'Stats', icon: 'chart', glyph: '▥', section: 'world' },
  { screen: 'scouting', label: 'Scouting', icon: 'binoculars', glyph: '⊙', section: 'world' },
  { screen: 'squad', label: 'Roster', icon: 'squad', glyph: '⛶', section: 'world' },
  { screen: 'market', label: 'Market Watch', icon: 'swap', glyph: '⇄', section: 'world' },
  { screen: 'finances', label: 'Finances', icon: 'finance', glyph: '$', section: 'world' },
  { screen: 'offseason', label: 'Transfer Window', icon: 'refresh', glyph: '↻', section: 'world' },
  { screen: 'editor', label: 'God Mode', icon: 'wand', glyph: '✎', section: 'tools' },
  { screen: 'saves', label: 'Saves', icon: 'save', glyph: '▤', section: 'tools' }
];

/** Section order + display titles for the grouped rail. */
const SECTIONS = [
  { id: 'watch', title: 'Watch' },
  { id: 'competition', title: 'Competition' },
  { id: 'world', title: 'World' },
  { id: 'tools', title: 'God Tools' }
];

/**
 * Map a contextual screen to the nav item that should appear active when it's
 * showing. The former Standings/Bracket items are unified under 'tournament',
 * so team/player/match (and the legacy 'standings'/'bracket' route ids) all
 * surface the Tournament nav highlight.
 * @type {Record<string,string>}
 */
const NAV_PARENT = {
  team: 'tournament',
  player: 'tournament',
  development: 'squad',
  match: 'tournament',
  standings: 'tournament',
  bracket: 'tournament',
  // A player's Life Story belongs under the All-Time leaders highlight.
  career: 'legends'
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
      h('span', { class: 'sidebar__title' }, '// WORLD SIM')
    ),
    h(
      'ul',
      { class: 'sidebar__nav' },
      SECTIONS.flatMap((sec) => {
        const items = NAV_ITEMS.filter((it) => it.section === sec.id);
        if (!items.length) return [];
        return [
          h('li', { key: `sec-${sec.id}`, class: 'sidebar__section', 'aria-hidden': 'true' }, sec.title),
          ...items.map((item) => navItem(item, activeScreen, onNavigate, unread))
        ];
      })
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
        // The label text is the button's accessible name, but the responsive
        // icon-rail (≤820px) hides .sidebar__label — keep an explicit aria-label
        // so the nav stays usable for screen-reader / voice-control users there.
        'aria-label': item.label,
        'aria-current': active ? 'page' : undefined,
        onClick: onNavigate ? () => onNavigate(item.screen) : undefined
      },
      h('span', { class: 'sidebar__glyph', 'aria-hidden': 'true' }, Icon(item.icon, { size: 18 })),
      h('span', { class: 'sidebar__label' }, item.label),
      showBadge ? h('span', { class: 'badge sidebar__badge' }, unread > 99 ? '99+' : String(unread)) : null
    )
  );
}

/**
 * The "NOW VIEWING" free-camera chip — the spectator's current focus. There is
 * no ownership/management here; it just jumps to whoever is in focus. Renders an
 * empty placeholder when no team is focused.
 */
function followedBadge(team, onNavigate) {
  if (!team) {
    return h(
      'div',
      { class: 'sidebar__follow sidebar__follow--empty' },
      h('span', { class: 'sidebar__follow-kicker' }, 'Now viewing'),
      h('span', { class: 'sidebar__follow-label' }, 'Free camera — pick a team')
    );
  }
  const name = team.name != null ? team.name : team.id;
  const tag = team.tag || (name ? String(name).slice(0, 3).toUpperCase() : '');
  return h(
    'button',
    {
      type: 'button',
      class: 'sidebar__follow',
      onClick: onNavigate ? () => onNavigate('team') : undefined,
      'aria-label': `Now viewing: ${name}`
    },
    h('span', { class: 'sidebar__follow-tag' }, tag),
    h(
      'span',
      { class: 'sidebar__follow-body' },
      h('span', { class: 'sidebar__follow-kicker' }, 'Now viewing'),
      h('span', { class: 'sidebar__follow-name' }, name)
    )
  );
}
