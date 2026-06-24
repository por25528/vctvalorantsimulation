/**
 * ui/components/KillFeed.js — the current round's kill feed (P12.7).
 * Pure props -> VNode. Shows the kill-by-kill exchanges of the round at the
 * reveal cursor (the round currently animating, or the last round when paused),
 * with first-blood / trade / clutch markers — built from RoundLog.events, which
 * the engine already records.
 */

import { h, classNames } from '../render.js';

/** Marker glyph + label for a kill event kind. */
function killKind(ev) {
  if (ev.isClutchKill) return { glyph: '★', kind: 'clutch', label: 'clutch kill' };
  if (ev.isFirstBlood) return { glyph: '⚡', kind: 'first', label: 'first blood' };
  if (ev.isTrade) return { glyph: '⇄', kind: 'trade', label: 'trade' };
  return { glyph: '✕', kind: 'kill', label: 'kill' };
}

function handleOf(players, id) {
  const p = players && players[id];
  return (p && (p.handle || p.name)) || id || '?';
}

/**
 * @param {object} props
 * @param {object} props.mapResult
 * @param {Record<string,object>} props.playersById
 * @param {number} [props.index]   reveal cursor (round being watched)
 * @param {boolean} [props.playing]
 * @returns {import('../render.js').VNode}
 */
export function KillFeed(props) {
  const { mapResult, playersById = {}, index, playing = false } = props || {};
  const rounds = (mapResult && mapResult.rounds) || [];
  const score = (mapResult && mapResult.score) || { A: 0, B: 0 };
  const total = (score.A || 0) + (score.B || 0);
  const cursor = typeof index === 'number' ? index : total;

  // The round to show: while playing, the cursor round; otherwise the final round.
  const n = playing ? Math.min(Math.max(cursor, 1), total) : total;
  const round = rounds.find((r) => r.n === n) || rounds[rounds.length - 1] || null;
  const events = (round && Array.isArray(round.events) ? round.events : []).filter((e) => e && typeof e.killerId === 'string');

  return h(
    'div',
    { class: 'killfeed' },
    h('h3', { class: 'killfeed__title' }, round ? `Round ${round.n} — kill feed` : 'Kill feed'),
    events.length === 0
      ? h('div', { class: 'killfeed__empty muted' }, 'No kills logged.')
      : h(
          'ul',
          { class: 'killfeed__list' },
          events.map((ev, i) => {
            const m = killKind(ev);
            return h(
              'li',
              { key: `kf-${n}-${i}`, class: classNames('killfeed__row', `killfeed__row--${m.kind}`) },
              h('span', { class: 'killfeed__killer' }, handleOf(playersById, ev.killerId)),
              h('span', { class: classNames('killfeed__glyph', `killfeed__glyph--${m.kind}`), title: m.label }, m.glyph),
              h('span', { class: 'killfeed__victim' }, handleOf(playersById, ev.victimId))
            );
          })
        )
  );
}
