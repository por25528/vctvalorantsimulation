/**
 * ui/components/AttributeRadar.js — pure inline-SVG radar chart of a player's
 * 9 attributes (0-100 scale). Phase 3 (UI shell).
 *
 * Per CONTRACTS-UI §6: `AttributeRadar(props:{attributes})` — a small inline-SVG
 * radar of the 9 attributes, built purely via `h('svg',...)`. No external libs.
 * Returns a VNode; renders headlessly via toHtml.
 */

import { h } from '../render.js';

/**
 * The 9 attribute axes, in clockwise order starting from the top.
 * @type {Array<{key:string,label:string}>}
 */
export const RADAR_AXES = [
  { key: 'aim', label: 'Aim' },
  { key: 'movement', label: 'Movement' },
  { key: 'reaction', label: 'Reaction' },
  { key: 'composure', label: 'Composure' },
  { key: 'consistency', label: 'Consistency' },
  { key: 'gameSense', label: 'Game Sense' },
  { key: 'utility', label: 'Utility' },
  { key: 'trading', label: 'Trading' },
  { key: 'igl', label: 'IGL' }
];

const MAX = 100;
/** Concentric grid rings (as fraction of full scale). */
const RINGS = [0.25, 0.5, 0.75, 1];

/** Clamp a raw attribute to the 0..MAX scale. */
function clamp(v) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  if (n < 0) return 0;
  if (n > MAX) return MAX;
  return n;
}

/**
 * Polar -> cartesian for axis i (0 at top, clockwise) at a given radius.
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} i axis index
 * @param {number} n axis count
 * @returns {{x:number,y:number}}
 */
function point(cx, cy, radius, i, n) {
  const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle)
  };
}

/** Round to 2 decimals for compact, deterministic SVG coordinates. */
function r2(x) {
  return Math.round(x * 100) / 100;
}

/**
 * AttributeRadar — pure props -> VNode inline-SVG radar.
 * @param {object} props
 * @param {Record<string,number>} props.attributes 9 named 0-100 attributes
 * @param {number} [props.size] square viewport size in px (default 240)
 * @returns {import('../render.js').VNode}
 */
export function AttributeRadar(props) {
  const attributes = (props && props.attributes) || {};
  const size = (props && props.size) || 240;
  const cx = size / 2;
  const cy = size / 2;
  const labelPad = 26;
  const radius = size / 2 - labelPad;
  const n = RADAR_AXES.length;

  // Background grid rings (polygons at each ring fraction).
  const rings = RINGS.map((frac, ri) => {
    const pts = RADAR_AXES.map((_, i) => {
      const p = point(cx, cy, radius * frac, i, n);
      return `${r2(p.x)},${r2(p.y)}`;
    }).join(' ');
    return h('polygon', {
      key: `ring-${ri}`,
      class: 'radar__ring',
      points: pts,
      fill: 'none',
      stroke: 'var(--panel-2, #2a2f3a)',
      'stroke-width': 1
    });
  });

  // Spokes from center to each axis tip.
  const spokes = RADAR_AXES.map((_, i) => {
    const p = point(cx, cy, radius, i, n);
    return h('line', {
      key: `spoke-${i}`,
      class: 'radar__spoke',
      x1: r2(cx),
      y1: r2(cy),
      x2: r2(p.x),
      y2: r2(p.y),
      stroke: 'var(--panel-2, #2a2f3a)',
      'stroke-width': 1
    });
  });

  // The value polygon (the 9 attribute points).
  const valuePoints = RADAR_AXES.map((axis, i) => {
    const v = clamp(attributes[axis.key]);
    const p = point(cx, cy, radius * (v / MAX), i, n);
    return `${r2(p.x)},${r2(p.y)}`;
  }).join(' ');

  const valuePolygon = h('polygon', {
    class: 'radar__value',
    points: valuePoints,
    fill: 'var(--accent, #ff4655)',
    'fill-opacity': 0.35,
    stroke: 'var(--accent, #ff4655)',
    'stroke-width': 2
  });

  // Vertex dots on each attribute value point.
  const dots = RADAR_AXES.map((axis, i) => {
    const v = clamp(attributes[axis.key]);
    const p = point(cx, cy, radius * (v / MAX), i, n);
    return h('circle', {
      key: `dot-${i}`,
      class: 'radar__dot',
      cx: r2(p.x),
      cy: r2(p.y),
      r: 2.5,
      fill: 'var(--accent, #ff4655)'
    });
  });

  // Axis labels just outside the outer ring.
  const labels = RADAR_AXES.map((axis, i) => {
    const p = point(cx, cy, radius + 14, i, n);
    // Anchor text based on horizontal position so labels don't overflow.
    let anchor = 'middle';
    if (p.x < cx - 1) anchor = 'end';
    else if (p.x > cx + 1) anchor = 'start';
    return h(
      'text',
      {
        key: `label-${i}`,
        class: 'radar__label',
        x: r2(p.x),
        y: r2(p.y),
        'text-anchor': anchor,
        'dominant-baseline': 'middle',
        'font-size': 10,
        fill: 'var(--muted, #9aa3b2)'
      },
      axis.label
    );
  });

  return h(
    'svg',
    {
      class: 'radar',
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      role: 'img',
      'aria-label': 'Attribute radar'
    },
    h('g', { class: 'radar__grid' }, ...rings, ...spokes),
    valuePolygon,
    ...dots,
    h('g', { class: 'radar__labels' }, ...labels)
  );
}
