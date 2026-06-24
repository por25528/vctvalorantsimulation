/**
 * ui/components/MomentumTimeline.js — round-by-round momentum strip (P12.7).
 * Pure props -> VNode (inline SVG). Draws the running lead (team A above the
 * centre line, team B below) across the rounds revealed so far, so the swing of
 * a map reads at a glance. Built from engine/match/commentary.mapMomentum.
 */

import { h, classNames } from '../render.js';
import { mapMomentum } from '../../engine/match/commentary.js';

const H = 56; // svg height
const MID = H / 2;
const STEP = 12; // px per round
const BARW = 7;
const MAX_LEAD = 13; // a full map lead saturates the bar

/**
 * @param {object} props
 * @param {object} props.mapResult
 * @param {number} [props.index]   reveal cursor
 * @param {boolean} [props.playing]
 * @returns {import('../render.js').VNode}
 */
export function MomentumTimeline(props) {
  const { mapResult, index, playing = false } = props || {};
  const series = mapMomentum(mapResult);
  const score = (mapResult && mapResult.score) || { A: 0, B: 0 };
  const total = (score.A || 0) + (score.B || 0);
  const cursor = typeof index === 'number' ? index : total;
  const shown = series.filter((s) => (playing ? s.n <= cursor : true));

  if (shown.length === 0) {
    return h('div', { class: 'momentum momentum--empty muted' }, 'Momentum builds as rounds play.');
  }

  const W = Math.max(shown.length * STEP, STEP);
  const last = shown[shown.length - 1] || { a: 0, b: 0 };

  const bars = shown.map((s, i) => {
    const mag = Math.min(Math.abs(s.lead) / MAX_LEAD, 1) * (MID - 3);
    const x = i * STEP + (STEP - BARW) / 2;
    const up = s.lead >= 0;
    const y = up ? MID - mag : MID;
    const team = s.winnerTeam;
    return h('rect', {
      key: `m-${s.n}`,
      x,
      y,
      width: BARW,
      height: Math.max(mag, 1),
      rx: 1,
      class: classNames('momentum__bar', up ? 'momentum__bar--a' : 'momentum__bar--b', team && `momentum__win--${team}`)
    });
  });

  return h(
    'div',
    { class: 'momentum' },
    h(
      'div',
      { class: 'momentum__head' },
      h('h3', { class: 'momentum__title' }, '📈 Momentum'),
      h('span', { class: 'momentum__score' }, `${last.a} – ${last.b}`)
    ),
    h(
      'svg',
      { class: 'momentum__svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Round momentum' },
      h('line', { class: 'momentum__mid', x1: 0, y1: MID, x2: W, y2: MID }),
      ...bars
    )
  );
}
