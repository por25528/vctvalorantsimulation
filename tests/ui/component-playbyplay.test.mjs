/**
 * tests/ui/component-playbyplay.test.mjs — P12.7 spectator components.
 * Headless via toHtml. Renders CommentaryLog / KillFeed / MomentumTimeline over a
 * synthetic MapResult and asserts content + reveal gating (playback hides rounds
 * beyond the cursor).
 */

import { assert, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { CommentaryLog } from '../../src/ui/components/CommentaryLog.js';
import { KillFeed } from '../../src/ui/components/KillFeed.js';
import { MomentumTimeline } from '../../src/ui/components/MomentumTimeline.js';

function countOccurrences(haystack, needle) {
  let c = 0; let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { c += 1; i += needle.length; }
  return c;
}

const players = { p1: { handle: 'Alfa' }, e1: { handle: 'Xeno' }, e2: { handle: 'Yuki' } };
const teamsById = { TA: { tag: 'AAA' }, TB: { tag: 'BBB' } };

function rnd(n, winnerTeam, events) {
  return { n, winnerTeam, winnerSide: 'atk', endCondition: 'elim', economy: { A: { type: 'full' }, B: { type: 'full' } }, events, aliveEnd: { A: 1, B: 0 }, planted: false, clutchPlayerId: null };
}

const mapResult = {
  score: { A: 2, B: 1 },
  rounds: [
    rnd(1, 'A', [{ killerId: 'p1', victimId: 'e1', isFirstBlood: true }]),
    rnd(2, 'B', [{ killerId: 'e2', victimId: 'p1', isFirstBlood: true }]),
    rnd(3, 'A', [{ killerId: 'p1', victimId: 'e2', isFirstBlood: true }])
  ]
};

export default async function run() {
  section('CommentaryLog — renders revealed beats, newest first');
  {
    const full = toHtml(CommentaryLog({ mapResult, playersById: players, teamsById, teamAId: 'TA', teamBId: 'TB' }));
    assert(full.includes('commentary'), 'commentary container present');
    assert(full.includes('Alfa') && full.includes('Xeno'), 'commentary names players');
    assert(full.includes('R3') && full.includes('R1'), 'round badges present');

    // Playback gating: at cursor 1, only round 1 appears (no R2/R3).
    const gated = toHtml(CommentaryLog({ mapResult, playersById: players, teamsById, teamAId: 'TA', teamBId: 'TB', index: 1, playing: true }));
    assert(gated.includes('R1') && !gated.includes('R3'), 'playback hides rounds beyond the cursor');
  }

  section('KillFeed — shows the cursor round and marks first bloods');
  {
    const html = toHtml(KillFeed({ mapResult, playersById: players, index: 1, playing: true }));
    assert(html.includes('killfeed'), 'killfeed container present');
    assert(html.includes('Round 1'), 'shows the watched round number');
    assert(html.includes('killfeed__glyph--first'), 'first-blood marker present');
    assert(html.includes('Alfa') && html.includes('Xeno'), 'killer + victim handles shown');
  }

  section('MomentumTimeline — one bar per revealed round + score readout');
  {
    const full = toHtml(MomentumTimeline({ mapResult, index: 3, playing: true }));
    assert(full.includes('momentum__svg'), 'momentum svg present');
    assert(countOccurrences(full, '<rect') === 3, 'one bar per round when fully revealed');
    assert(full.includes('2 – 1'), 'shows the current score');

    const gated = toHtml(MomentumTimeline({ mapResult, index: 1, playing: true }));
    assert(countOccurrences(gated, '<rect') === 1, 'momentum reveals only up to the cursor');
  }

  section('empty guards');
  {
    assert(toHtml(CommentaryLog({ mapResult: { rounds: [], score: { A: 0, B: 0 } } })).includes('commentary--empty'), 'empty commentary placeholder');
    assert(toHtml(MomentumTimeline({ mapResult: { rounds: [], score: { A: 0, B: 0 } } })).includes('momentum--empty'), 'empty momentum placeholder');
  }
}
