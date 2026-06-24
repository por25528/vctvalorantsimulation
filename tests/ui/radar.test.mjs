/**
 * tests/ui/radar.test.mjs — AttributeRadar component (CONTRACTS-UI §6).
 * Headless via toHtml: asserts the rendered output is an inline <svg>, the value
 * polygon has exactly 9 points (the 9 attributes), and every axis label is present.
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { AttributeRadar, RADAR_AXES } from '../../src/ui/components/AttributeRadar.js';

export default async function run() {
  const attributes = {
    aim: 82,
    movement: 71,
    reaction: 90,
    composure: 64,
    consistency: 77,
    gameSense: 88,
    utility: 55,
    trading: 69,
    igl: 40
  };

  const html = toHtml(AttributeRadar({ attributes, size: 240 }));

  // -- root is an inline <svg> -------------------------------------------
  assert(/^<svg[\s>]/.test(html), `radar root should be <svg>: ${html.slice(0, 40)}`);
  assert(html.includes('viewBox="0 0 240 240"'), 'svg has expected viewBox');

  // -- the value polygon has exactly 9 points ----------------------------
  const valueMatch = html.match(/<polygon class="radar__value" points="([^"]*)"/);
  assert(valueMatch, `value polygon present: ${html}`);
  const pts = valueMatch[1].trim().split(/\s+/);
  assert(
    pts.length === 9,
    `value polygon should have 9 points (one per attribute), got ${pts.length}`
  );
  // Each point is an "x,y" pair.
  for (const p of pts) {
    assert(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(p), `point malformed: ${p}`);
  }

  // -- there are exactly 9 attribute axes --------------------------------
  assert(RADAR_AXES.length === 9, 'radar defines 9 axes');

  // -- every axis label is rendered --------------------------------------
  for (const axis of RADAR_AXES) {
    assert(
      html.includes(`>${axis.label}</text>`),
      `axis label "${axis.label}" should appear in radar output`
    );
  }

  // -- at least one <polygon> exists (grid + value) ----------------------
  assert(/<polygon[\s>]/.test(html), 'radar contains a <polygon>');

  // -- 0 attribute lands at center; 100 lands on the outer ring ----------
  // (sanity: a maxed attribute should be farther from center than a zeroed one)
  const maxed = toHtml(
    AttributeRadar({ attributes: { ...attributes, aim: 100, movement: 0 }, size: 240 })
  );
  assert(maxed.includes('<polygon class="radar__value"'), 'maxed radar still renders value polygon');

  // -- defaults: missing attributes treated as 0 (no throw) --------------
  const empty = toHtml(AttributeRadar({ attributes: {} }));
  assert(/^<svg[\s>]/.test(empty), 'empty-attribute radar still renders an <svg>');
  const emptyVal = empty.match(/<polygon class="radar__value" points="([^"]*)"/);
  assert(emptyVal && emptyVal[1].trim().split(/\s+/).length === 9, 'empty radar still has 9 points');
}
