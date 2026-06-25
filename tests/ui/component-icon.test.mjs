/**
 * tests/ui/component-icon.test.mjs — the inline-SVG Icon set (UI polish pass).
 *
 * Headless via toHtml (no DOM). Asserts that:
 *   - every known icon name renders a single decorative <svg> with currentColor
 *     so it inherits the surrounding text colour;
 *   - icons are accessibility-hidden (aria-hidden + non-focusable) since they
 *     always sit beside a real text label;
 *   - the Sidebar wires an icon into every nav item's glyph slot (no emoji), and
 *     still renders every text label (the contract the shell tests rely on);
 *   - the TopBar's toolbar toggles render an icon next to their text label.
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { Icon, ICON_NAMES } from '../../src/ui/components/Icon.js';
import { Sidebar, NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { TopBar } from '../../src/ui/components/TopBar.js';

/** Count occurrences of a substring. */
function count(haystack, needle) {
  let c = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    c += 1;
    i += needle.length;
  }
  return c;
}

export default async function run() {
  // ---- every icon renders a single decorative, colour-inheriting svg --------
  assert(ICON_NAMES.length >= 16, 'icon set covers the nav surface');
  for (const name of ICON_NAMES) {
    const html = toHtml(Icon(name));
    assert(count(html, '<svg') === 1, `icon "${name}" renders exactly one svg`);
    assert(html.includes('stroke="currentColor"'), `icon "${name}" inherits text colour`);
    assert(html.includes('aria-hidden="true"'), `icon "${name}" is aria-hidden`);
    assert(html.includes('focusable="false"'), `icon "${name}" is non-focusable`);
    assert(html.includes('<path') || html.includes('<rect') || html.includes('<circle'),
      `icon "${name}" has drawn geometry`);
  }

  // unknown icon degrades to an empty (still valid) svg rather than throwing
  const blank = toHtml(Icon('definitely-not-an-icon'));
  assert(count(blank, '<svg') === 1, 'unknown icon still yields one svg');

  // size override flows through to width/height
  const sized = toHtml(Icon('home', { size: 28 }));
  assert(sized.includes('width="28"') && sized.includes('height="28"'), 'icon size override applies');

  // ---- Sidebar: an icon per nav item, no emoji, all labels present ----------
  const sidebar = toHtml(Sidebar({ route: { screen: 'home' }, followedTeam: { id: 'drx', name: 'DRX', tag: 'DRX' } }));
  assert(count(sidebar, 'sidebar__glyph') === NAV_ITEMS.length, 'every nav item has a glyph slot');
  assert(count(sidebar, '<svg') >= NAV_ITEMS.length, 'every nav glyph slot holds an svg icon');
  for (const it of NAV_ITEMS) {
    assert(sidebar.includes(`>${it.label}</span>`), `nav label "${it.label}" still renders`);
    assert(typeof it.icon === 'string' && it.icon.length > 0, `nav item "${it.screen}" names an icon`);
    assert(ICON_NAMES.includes(it.icon), `nav item "${it.screen}" icon "${it.icon}" exists in the set`);
  }
  // no stray emoji left in the rendered sidebar (covers the common offenders)
  for (const emoji of ['📰', '👥', '🔁', '🌐', '🏆', '🏅', '💾']) {
    assert(!sidebar.includes(emoji), `sidebar no longer ships emoji "${emoji}"`);
  }
  // The responsive icon-rail (≤820px) hides the text label, so each nav button
  // must carry an explicit aria-label to keep an accessible name in that mode.
  for (const it of NAV_ITEMS) {
    assert(sidebar.includes(`aria-label="${it.label}"`), `nav button "${it.label}" has an aria-label for the icon rail`);
  }

  // ---- TopBar: toolbar toggles pair an icon with their text label -----------
  const topbar = toHtml(
    TopBar({
      eventLabel: 'Pacific Kickoff',
      seasonLabel: '2026 — Pacific',
      onToggleSpoilerFree: () => {},
      onToggleAutoplay: () => {},
      spoilerFree: true
    })
  );
  assert(topbar.includes('topbar__btn-label'), 'topbar toolbar buttons carry text labels');
  assert(topbar.includes('Spoiler-free'), 'spoiler-free toggle keeps its label');
  assert(topbar.includes('Auto'), 'autoplay toggle keeps its label');
  assert(count(topbar, '<svg') >= 2, 'topbar toggles render icons');
  assert(!topbar.includes('🙈') && !topbar.includes('👁'), 'topbar no longer ships emoji toggles');
  // toolbar toggles collapse to icon-only on narrow viewports — keep an aria-label
  assert(topbar.includes('aria-label="Spoiler-free"'), 'spoiler toggle has an aria-label when collapsed');
  assert(topbar.includes('aria-label="Autoplay"'), 'autoplay toggle has an aria-label when collapsed');
}
