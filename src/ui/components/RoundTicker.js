/**
 * ui/components/RoundTicker.js — shared component rendering a round-by-round
 * ticker from a MapResult.
 * Phase 3 (UI shell). Pure props -> VNode (CONTRACTS-UI §6).
 *
 * Renders a running scoreline plus a horizontal strip of round cells. The strip
 * has EXACTLY `mapResult.score.A + mapResult.score.B` cells (one per played
 * round). Each cell is colored by the round's `winnerTeam` (teamA/teamB theme)
 * and the winning side (atk/def), carries a small glyph for the winning side's
 * economy type (pistol/eco/force/full) and one for the round's end condition
 * (elim/spike/defuse/time). A halftime divider is inserted after round 12 and an
 * OT divider after round 24. During playback (`playing`), only rounds with
 * `n <= index` are revealed; otherwise the full strip is shown. Clicking a cell
 * calls `onSeek(n)`.
 */

import { h, classNames } from '../render.js';

/** Glyph per economy type (winning side's buy). */
const ECON_GLYPH = {
  pistol: '•',
  eco: '↓',
  force: '⇡',
  full: '$'
};

/** Glyph per round end condition. */
const END_GLYPH = {
  elim: '✕',
  spike: '✸',
  defuse: '⌫',
  time: '⏱'
};

/** Human label per economy type (for title/aria). */
const ECON_LABEL = {
  pistol: 'pistol',
  eco: 'eco',
  force: 'force buy',
  full: 'full buy'
};

/**
 * @typedef {import('../render.js').VNode} VNode
 */

/**
 * @param {object} props
 * @param {object} props.mapResult  a MapResult (CONTRACTS §9): { score:{A,B}, rounds:RoundLog[], ... }
 * @param {number} [props.index]    playback cursor: highest round number (1-based) revealed
 * @param {boolean} [props.playing] when true, hide rounds with n > index
 * @param {(n:number)=>void} [props.onSeek] called with a round number when a cell is clicked
 * @returns {VNode}
 */
export function RoundTicker(props) {
  const { mapResult, index, playing = false, onSeek } = props || {};
  const score = (mapResult && mapResult.score) || { A: 0, B: 0 };
  const rounds = (mapResult && mapResult.rounds) || [];
  const total = (score.A || 0) + (score.B || 0);

  // Live (playback) score = wins among revealed rounds; full score otherwise.
  const cursor = typeof index === 'number' ? index : total;
  let liveA = 0;
  let liveB = 0;
  if (playing) {
    for (const r of rounds) {
      if (r.n <= cursor) {
        if (r.winnerTeam === 'A') liveA += 1;
        else if (r.winnerTeam === 'B') liveB += 1;
      }
    }
  } else {
    liveA = score.A || 0;
    liveB = score.B || 0;
  }

  const cells = [];
  for (let i = 0; i < total; i++) {
    const r = rounds[i] || { n: i + 1 };
    const n = typeof r.n === 'number' ? r.n : i + 1;

    // Halftime divider after round 12, OT divider after round 24/36/...
    if (n === 13) cells.push(divider('halftime', n));
    else if (n > 24 && (n - 1) % 12 === 0) cells.push(divider('ot', n));

    cells.push(roundCell(r, n, { playing, cursor, onSeek }));
  }

  return h(
    'div',
    { class: 'ticker' },
    h(
      'div',
      { class: 'ticker__score' },
      h('span', { class: 'ticker__score-a' }, String(liveA)),
      h('span', { class: 'ticker__score-sep' }, '–'),
      h('span', { class: 'ticker__score-b' }, String(liveB))
    ),
    h('div', { class: 'ticker__strip' }, ...cells)
  );
}

/**
 * Build one round cell vnode.
 * @param {object} r RoundLog (may be a stub with only {n})
 * @param {number} n round number (1-based)
 * @param {{playing:boolean, cursor:number, onSeek?:(n:number)=>void}} ctx
 * @returns {VNode}
 */
function roundCell(r, n, ctx) {
  const winnerTeam = r.winnerTeam === 'A' || r.winnerTeam === 'B' ? r.winnerTeam : null;
  const side = r.winnerSide === 'atk' || r.winnerSide === 'def' ? r.winnerSide : null;
  const econ = winnerTeam && r.economy && r.economy[winnerTeam] ? r.economy[winnerTeam].type : null;
  const end = r.endCondition || null;

  const hidden = ctx.playing && n > ctx.cursor;
  const current = ctx.playing && n === ctx.cursor;

  const cls = classNames('ticker__cell', {
    'ticker__cell--teamA': winnerTeam === 'A',
    'ticker__cell--teamB': winnerTeam === 'B',
    'ticker__cell--atk': side === 'atk',
    'ticker__cell--def': side === 'def',
    'ticker__cell--hidden': hidden,
    'ticker__cell--current': current
  });

  const title =
    `Round ${n}` +
    (winnerTeam ? ` — Team ${winnerTeam} (${side || ''})` : '') +
    (econ ? `, ${ECON_LABEL[econ] || econ}` : '') +
    (end ? `, ${end}` : '');

  return h(
    'button',
    {
      class: cls,
      type: 'button',
      key: `r${n}`,
      title,
      'data-round': n,
      onClick: ctx.onSeek ? () => ctx.onSeek(n) : undefined
    },
    h('span', { class: 'ticker__cell-n' }, String(n)),
    econ ? h('span', { class: classNames('ticker__econ', `ticker__econ--${econ}`) }, ECON_GLYPH[econ] || '') : null,
    end ? h('span', { class: classNames('ticker__end', `ticker__end--${end}`) }, END_GLYPH[end] || '') : null
  );
}

/**
 * Build a divider vnode (halftime or overtime).
 * @param {'halftime'|'ot'} kind
 * @param {number} n round number the divider precedes
 * @returns {VNode}
 */
function divider(kind, n) {
  return h(
    'div',
    {
      class: classNames('ticker__divider', `ticker__divider--${kind}`),
      key: `div-${kind}-${n}`,
      'aria-hidden': 'true'
    },
    kind === 'halftime' ? 'HT' : 'OT'
  );
}
