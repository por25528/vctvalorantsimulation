/**
 * ui/components/Icon.js — a small, dependency-free inline-SVG icon set.
 *
 * Why this exists: the shell previously leaned on emoji + lone Unicode symbols
 * (📰 👥 🔁 ⑂ …) for its navigation and toolbar glyphs. Emoji render
 * inconsistently across platforms (and not at all in many headless/Linux
 * environments — they show as tofu □), and mixing full-colour emoji with thin
 * geometric symbols reads as visually incoherent in an otherwise sleek dark UI.
 *
 * `Icon(name)` returns a monochrome, stroke-based 24×24 SVG that inherits the
 * current text colour (`currentColor`), so every icon picks up the same hover /
 * active / muted treatment as the text beside it. Icons are decorative: they are
 * `aria-hidden` and non-focusable, and always sit next to a real text label.
 *
 * Pure: returns a VNode tree built with `h`, so it serializes via `toHtml`
 * headlessly (used by the UI tests) exactly like every other component.
 */

import { h, classNames } from '../render.js';

/**
 * SVG path/shape children per icon name. Each entry is an array of VNodes drawn
 * inside a shared 24×24 viewBox with `fill="none" stroke="currentColor"`.
 * Kept deliberately simple (1–4 strokes) so they stay crisp at 16–20px.
 * @type {Record<string, () => Array<import('../render.js').VNode>>}
 */
const SHAPES = {
  // house
  home: () => [path('M3 11.5 12 4l9 7.5'), path('M5 10v9h14v-9'), path('M10 19v-5h4v5')],
  // play triangle (match day / autoplay)
  play: () => [h('path', { d: 'M8 5.5v13l11-6.5z', fill: 'currentColor', stroke: 'none' })],
  // pause
  pause: () => [h('rect', rect(7, 5, 3.5, 14)), h('rect', rect(13.5, 5, 3.5, 14))],
  // skip-forward (sim event)
  skip: () => [h('path', { d: 'M6 5.5v13l9-6.5z', fill: 'currentColor', stroke: 'none' }), h('rect', rect(16.5, 5, 2.5, 14, 'currentColor'))],
  // envelope / inbox
  inbox: () => [h('rect', rect(3, 5.5, 18, 13, null, 2)), path('M3.5 7 12 13l8.5-6')],
  // two people (squad)
  squad: () => [h('circle', circle(9, 8.5, 3)), path('M3.5 19a5.5 5.5 0 0 1 11 0'), path('M16 6.2a3 3 0 0 1 0 5.6'), path('M17 13.6A5.5 5.5 0 0 1 20.5 19')],
  // swap arrows (transfers)
  swap: () => [path('M4 8h13l-3.5-3.5'), path('M20 16H7l3.5 3.5')],
  // refresh / cycle (transfer window)
  refresh: () => [path('M20 11a8 8 0 0 0-14-4.5L4 8'), path('M4 4v4h4'), path('M4 13a8 8 0 0 0 14 4.5L20 16'), path('M20 20v-4h-4')],
  // calendar grid
  calendar: () => [h('rect', rect(3.5, 5, 17, 15, null, 2)), path('M3.5 9.5h17'), path('M8 3.5v3'), path('M16 3.5v3')],
  // bar list / standings
  standings: () => [path('M4 7h11'), path('M4 12h16'), path('M4 17h8')],
  // bar chart on an axis (stats / analytics)
  chart: () => [path('M4 4v16h16'), h('rect', rect(7, 13, 2.6, 4)), h('rect', rect(11.7, 9, 2.6, 8)), h('rect', rect(16.4, 11.5, 2.6, 5.5))],
  // bracket
  bracket: () => [path('M4 5h4v6h5'), path('M4 19h4v-6'), path('M13 12h3'), path('M16 8.5l4 3.5-4 3.5')],
  // globe (world ranking)
  globe: () => [h('circle', circle(12, 12, 8)), path('M4 12h16'), path('M12 4c2.5 2.2 3.8 5 3.8 8s-1.3 5.8-3.8 8c-2.5-2.2-3.8-5-3.8-8s1.3-5.8 3.8-8z')],
  // target / points (CP race)
  target: () => [h('circle', circle(12, 12, 8)), h('circle', circle(12, 12, 4)), h('circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor', stroke: 'none' })],
  // trophy (champions)
  trophy: () => [path('M7 4.5h10v4a5 5 0 0 1-10 0z'), path('M7 5.5H4.5V8a3 3 0 0 0 3 3'), path('M17 5.5h2.5V8a3 3 0 0 1-3 3'), path('M12 13.5V17'), path('M8.5 20h7'), path('M9.5 20a2.5 2.5 0 0 1 5 0')],
  // medal (awards)
  medal: () => [path('M8.5 3.5 12 9l3.5-5.5'), h('circle', circle(12, 15, 5)), path('M12 13v4'), path('M10 15h4')],
  // star (leaders / followed)
  star: () => [h('path', { d: 'M12 4.5l2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.7 5.2-.8z' })],
  // wand / god mode editor
  wand: () => [path('M5 19 16 8'), path('M14 6l4 4'), path('M18 4l.6 1.4L20 6l-1.4.6L18 8l-.6-1.4L16 6l1.4-.6z'), path('M6.5 4l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z')],
  // floppy / save
  save: () => [path('M5 5h11l3 3v11H5z'), path('M8 5v4h7V5'), h('rect', rect(8, 13, 8, 6, null, 1))],
  // eye (spoilers shown)
  eye: () => [path('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'), h('circle', circle(12, 12, 2.7))],
  // eye-off (spoiler-free)
  'eye-off': () => [path('M9.5 6c.8-.3 1.6-.5 2.5-.5 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.6'), path('M6.2 7.7A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.6-.3 3.7-.8'), path('M4 4l16 16')],
  // binoculars (scouting)
  binoculars: () => [
    h('circle', circle(7, 13, 3.5)),
    h('circle', circle(17, 13, 3.5)),
    path('M10.5 13h3'),
    path('M3.5 13V8l3-3h3v3'),
    path('M20.5 13V8l-3-3h-3v3')
  ],
  // finance / wallet (Finances screen)
  finance: () => [path('M12 4v16'), path('M16 8.5H10a2.5 2.5 0 0 0 0 5h4a2.5 2.5 0 0 1 0 5H8')]
};

/** Build a stroked `<path>` child (the icon default style). */
function path(d) {
  return h('path', { d });
}

/** Build a `<rect>` child; pass a fill to make it solid. */
function rect(x, y, w, hgt, fill, rx) {
  const p = { x, y, width: w, height: hgt };
  if (rx != null) p.rx = rx;
  if (fill) { p.fill = fill; p.stroke = 'none'; }
  return p;
}

/** Build a `<circle>` child. */
function circle(cx, cy, r) {
  return { cx, cy, r };
}

/**
 * Render an icon by name. Unknown names render an empty (but valid) svg so a
 * typo degrades to blank rather than throwing.
 *
 * @param {string} name   one of the keys in {@link SHAPES}
 * @param {object} [opts]
 * @param {number} [opts.size=18]   pixel size (width = height)
 * @param {string} [opts.class]     extra class on the svg
 * @returns {import('../render.js').VNode}
 */
export function Icon(name, opts = {}) {
  const { size = 18, class: extra = '' } = opts || {};
  const make = SHAPES[name];
  const children = make ? make() : [];
  return h(
    'svg',
    {
      class: classNames('icon', extra),
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.75,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false'
    },
    children
  );
}

/** The set of available icon names (handy for tests / introspection). */
export const ICON_NAMES = Object.freeze(Object.keys(SHAPES));
