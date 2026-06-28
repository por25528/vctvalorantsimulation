/**
 * ui/components/ReplayTimeline.js — round-by-round REPLAY panel for the match
 * viewer. Pure props -> VNode (CONTRACTS-UI §6); no DOM, no rng.
 *
 * Plays the map's timeline back beat by beat from the engine replay (or the
 * deterministic reconstruction) via {@link deriveMapReplay}:
 *   - a TRUE-momentum strip (the engine's decay-smoothed momentum scalar, A above
 *     the centre line / B below) so the swing of the map reads at a glance — this
 *     is the real engine momentum, not a score-lead proxy;
 *   - a "key beats" feed: the notable rounds (pistol, eco steal, ult round, ace,
 *     clutch, match point, map won) with the involved team + player handles.
 *
 * Reveal-gated like the other viewer components: when `playing`, only rounds with
 * `n <= index` are shown, so nothing past the watch cursor is spoiled.
 */

import { h, classNames } from '../render.js';
import { Icon } from './Icon.js';
import { deriveMapReplay } from '../replayDerive.js';

const H = 56; // svg height
const MID = H / 2;
const STEP = 12; // px per round
const BARW = 7;

/** Beat metadata: ordered priority, icon name, and label builder. */
const BEAT_META = {
  mapwon: { icon: 'trophy', label: () => 'Map won' },
  ace: { icon: 'star', label: (ctx) => `ACE — ${ctx.aceHandle}` },
  clutch: { icon: 'target', label: (ctx) => `Clutch — ${ctx.clutchHandle}` },
  eco: { icon: 'finance', label: () => 'Eco steal' },
  ult: { icon: 'wand', label: () => 'Ult round' },
  matchpoint: { icon: 'target', label: () => 'Match point' },
  pistol: { icon: 'medal', label: () => 'Pistol won' }
};

/** The order beats are shown within a round row (headline first). */
const BEAT_ORDER = ['mapwon', 'matchpoint', 'clutch', 'ace', 'eco', 'ult', 'pistol'];

/** Resolve a player's display handle (falls back to name, then id). */
function handleOf(playersById, id) {
  const p = playersById && id ? playersById[id] : null;
  return (p && (p.handle || p.name)) || id || '?';
}

/** Resolve a team's short label for a side letter. */
function teamTag(teamsById, id, fallback) {
  const t = teamsById && id ? teamsById[id] : null;
  return (t && (t.tag || t.name)) || id || fallback;
}

/**
 * @param {object} props
 * @param {object} props.mapResult  a MapResult
 * @param {Record<string,object>} [props.playersById]
 * @param {Record<string,object>} [props.teamsById]
 * @param {string} [props.teamAId]
 * @param {string} [props.teamBId]
 * @param {number} [props.index]    reveal cursor (highest round revealed)
 * @param {boolean} [props.playing] hide rounds with n > index when true
 * @returns {import('../render.js').VNode}
 */
export function ReplayTimeline(props) {
  const {
    mapResult, playersById = {}, teamsById = {},
    teamAId, teamBId, index, playing = false
  } = props || {};

  const model = deriveMapReplay(mapResult);
  const all = model.rounds;
  const total = all.length;
  const cursor = typeof index === 'number' ? index : total;
  const shown = playing ? all.filter((r) => r.n <= cursor) : all;

  if (shown.length === 0) {
    return h('div', { class: 'replay replay--empty muted' }, 'The replay builds as rounds play.');
  }

  const tagA = teamTag(teamsById, teamAId, 'A');
  const tagB = teamTag(teamsById, teamBId, 'B');
  const last = shown[shown.length - 1];

  // --- TRUE-momentum strip: net momentum (A − B) in [-1,+1] per round. -------
  const W = Math.max(shown.length * STEP, STEP);
  const bars = shown.map((r, i) => {
    const net = Math.max(-1, Math.min(1, r.momentum.A - r.momentum.B));
    const mag = Math.abs(net) * (MID - 3);
    const x = i * STEP + (STEP - BARW) / 2;
    const up = net >= 0;
    const y = up ? MID - mag : MID;
    const big = Math.abs(r.swing) >= 0.18; // a notable momentum shift this round
    return h('rect', {
      key: `rb-${r.n}`,
      x, y,
      width: BARW,
      height: Math.max(mag, 1),
      rx: 1,
      class: classNames(
        'replay__bar',
        up ? 'replay__bar--a' : 'replay__bar--b',
        big && 'replay__bar--swing'
      ),
      title: `Round ${r.n}: momentum ${tagA} ${r.momentum.A.toFixed(2)} / ${tagB} ${r.momentum.B.toFixed(2)}`
    });
  });

  // --- Key beats feed: notable rounds, newest first. -------------------------
  const beats = [];
  for (let i = shown.length - 1; i >= 0; i -= 1) {
    const r = shown[i];
    if (!r.tags || r.tags.length === 0) continue;
    const ctx = {
      aceHandle: handleOf(playersById, r.aceId),
      clutchHandle: handleOf(playersById, r.clutchPlayerId)
    };
    const wt = r.winnerTeam;
    const chips = BEAT_ORDER
      .filter((t) => r.tags.includes(t))
      .map((t) => {
        const meta = BEAT_META[t];
        return h(
          'span',
          { key: `beat-${r.n}-${t}`, class: classNames('replay__beat', `replay__beat--${t}`) },
          Icon(meta.icon, { size: 13, class: 'replay__beat-icon' }),
          h('span', { class: 'replay__beat-label' }, meta.label(ctx))
        );
      });
    if (chips.length === 0) continue;
    beats.push(
      h(
        'li',
        {
          key: `beatrow-${r.n}`,
          class: classNames('replay__row', wt === 'A' ? 'replay__row--a' : 'replay__row--b')
        },
        h('span', { class: 'replay__rn' }, `R${r.n}`),
        h('span', { class: 'replay__rteam' }, wt === 'A' ? tagA : tagB),
        h('span', { class: 'replay__rscore' }, `${r.score.A}–${r.score.B}`),
        h('span', { class: 'replay__beats' }, ...chips)
      )
    );
  }

  return h(
    'div',
    { class: 'replay' },
    h(
      'div',
      { class: 'replay__head' },
      Icon('chart', { size: 15, class: 'replay__title-icon' }),
      h('h3', { class: 'replay__title' }, 'Replay'),
      h('span', { class: 'replay__score' }, `${last.score.A} – ${last.score.B}`),
      h('span', { class: 'replay__round' }, `Round ${last.n} / ${total}`)
    ),
    h(
      'svg',
      {
        class: 'replay__svg',
        viewBox: `0 0 ${W} ${H}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': 'Momentum swing by round'
      },
      h('line', { class: 'replay__mid', x1: 0, y1: MID, x2: W, y2: MID }),
      ...bars
    ),
    beats.length > 0
      ? h('ul', { class: 'replay__feed' }, ...beats)
      : h('p', { class: 'replay__feed replay__feed--empty muted' }, 'No standout beats yet — the round-by-round momentum is above.')
  );
}
