/**
 * tests/unit/commentary.test.mjs — casted play-by-play generation (P12.7).
 * Pure: deterministic commentary + momentum derived from RoundLog data the engine
 * already logs. No store, no DOM.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { roundCommentary, mapMomentum } from '../../src/engine/match/commentary.js';

const players = {
  p1: { handle: 'Alfa' }, p2: { handle: 'Bravo' },
  e1: { handle: 'Xeno' }, e2: { handle: 'Yuki' }, e3: { handle: 'Zed' }, e4: { handle: 'Wren' }, e5: { handle: 'Vex' }
};
const teamsById = { TA: { tag: 'AAA', name: 'Team A' }, TB: { tag: 'BBB', name: 'Team B' } };
const ctx = { players, teamsById, teamAId: 'TA', teamBId: 'TB' };

const kill = (killerId, victimId, extra = {}) => ({ killerId, victimId, killerSide: 'atk', isFirstBlood: false, isTrade: false, isClutchKill: false, ...extra });

export default async function run() {
  section('roundCommentary — ace + first blood + eco upset');
  {
    const rl = {
      n: 5, winnerTeam: 'A', winnerSide: 'atk', endCondition: 'elim',
      economy: { A: { type: 'eco' }, B: { type: 'full' } },
      events: [
        kill('p1', 'e1', { isFirstBlood: true }),
        kill('p1', 'e2'), kill('p1', 'e3'), kill('p1', 'e4'),
        kill('p1', 'e5', { isClutchKill: true })
      ],
      aliveEnd: { A: 1, B: 0 }, planted: false, clutchPlayerId: 'p1'
    };
    const lines = roundCommentary(rl, ctx);
    assertEqual(lines[0].tone, 'first', 'first event is the first-blood beat');
    assert(lines[0].text.includes('Alfa') && lines[0].text.includes('Xeno'), 'first blood names killer + victim');
    const ace = lines.find((l) => l.tone === 'ace');
    assert(ace && ace.text.includes('Alfa') && ace.text.includes('5K'), 'ace line called for a 5-kill round');
    const result = lines.find((l) => l.tone === 'eco');
    assert(result && result.text.includes('STEAL') && result.text.includes('AAA'), 'eco-upset result line');
    // Determinism.
    assertEqual(roundCommentary(rl, ctx), roundCommentary(rl, ctx), 'same input → identical commentary');
  }

  section('roundCommentary — clutch (no ace) + spike result');
  {
    const rl = {
      n: 12, winnerTeam: 'A', winnerSide: 'def', endCondition: 'spike',
      economy: { A: { type: 'full' }, B: { type: 'full' } },
      events: [kill('p2', 'e1', { isFirstBlood: true }), kill('p1', 'e2', { isClutchKill: true })],
      aliveEnd: { A: 1, B: 0 }, planted: true, clutchPlayerId: 'p1'
    };
    const lines = roundCommentary(rl, ctx);
    assert(!lines.some((l) => l.tone === 'ace'), 'no ace for a 2-kill round');
    const clutch = lines.find((l) => l.tone === 'clutch' && l.text.includes('CLUTCH!'));
    assert(clutch && clutch.text.includes('Alfa'), 'clutch callout names the clutcher');
    const result = lines.find((l) => l.tone === 'result');
    assert(result && result.text.includes('Spike') && result.text.includes('AAA'), 'spike result line, team-tagged');
    assertEqual(result.team, 'A', 'result line carries the winning side for tinting');
  }

  section('roundCommentary — empty / malformed input is safe');
  {
    assertEqual(roundCommentary(null, ctx), [], 'null round → no lines');
    assertEqual(roundCommentary({ n: 1, events: [] }, ctx), [], 'no events + no winner → no lines');
  }

  section('mapMomentum — cumulative score + lead');
  {
    const mapResult = { rounds: [{ n: 1, winnerTeam: 'A' }, { n: 2, winnerTeam: 'B' }, { n: 3, winnerTeam: 'A' }], score: { A: 2, B: 1 } };
    const m = mapMomentum(mapResult);
    assertEqual(m.length, 3, 'one entry per round');
    assertEqual(m[0], { n: 1, a: 1, b: 0, lead: 1, winnerTeam: 'A' }, 'round 1 cumulative');
    assertEqual(m[2], { n: 3, a: 2, b: 1, lead: 1, winnerTeam: 'A' }, 'round 3 cumulative');
    assertEqual(mapMomentum({}), [], 'no rounds → empty momentum');
  }
}
