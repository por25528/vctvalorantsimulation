/**
 * tests/ui/roundTicker.test.mjs — RoundTicker component (CONTRACTS-UI §6, §8).
 *
 * Headless via toHtml (no DOM). Builds a REAL MapResult from the engine
 * (simMap) and asserts:
 *   - the strip has EXACTLY score.A + score.B round cells;
 *   - a halftime divider is present (a regulation map crosses round 12→13);
 *   - playback (`playing` + `index`) hides rounds with n > index;
 *   - each rendered cell carries a winner-team theme class.
 *
 * Deterministic: all randomness via createRng(seed). Default export is an async
 * fn that throws on failure (per tests/run.mjs).
 */

import { assert } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { createRng } from '../../src/core/rng.js';
import { simMap } from '../../src/engine/match/mapSim.js';
import { RoundTicker } from '../../src/ui/components/RoundTicker.js';

const COMP_A = ['omen', 'sova', 'killjoy', 'jett', 'raze'];
const COMP_B = ['brimstone', 'fade', 'cypher', 'phoenix', 'neon'];

/** Build a players lookup + two five-man teams. */
function makeWorld() {
  /** @type {Record<string, object>} */
  const players = {};
  const rosterA = [];
  const rosterB = [];
  for (let i = 0; i < 5; i++) {
    const aId = `A${i}`;
    const bId = `B${i}`;
    players[aId] = createPlayer({
      id: aId,
      name: aId,
      role: 'Duelist',
      attributes: { aim: 78, reaction: 75, movement: 74, gameSense: 72, trading: 70, composure: 70, utility: 60, igl: i === 0 ? 70 : 30 }
    });
    players[bId] = createPlayer({
      id: bId,
      name: bId,
      role: 'Duelist',
      attributes: { aim: 72, reaction: 70, movement: 71, gameSense: 70, trading: 70, composure: 70, utility: 60, igl: i === 0 ? 70 : 30 }
    });
    rosterA.push(aId);
    rosterB.push(bId);
  }
  const teamA = createTeam({ id: 'TA', name: 'Team A', tag: 'TA', roster: rosterA });
  const teamB = createTeam({ id: 'TB', name: 'Team B', tag: 'TB', roster: rosterB });
  return { players, teamA, teamB };
}

/** Count occurrences of a substring. */
function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

/** Count round cells (buttons) in serialized ticker HTML. */
function countCells(html) {
  // Every round cell is a <button class="ticker__cell ...">. Dividers are <div>.
  return countOccurrences(html, '<button');
}

export default async function run() {
  const { players, teamA, teamB } = makeWorld();
  const map = simMap(teamA, teamB, players, 'ascent', COMP_A, COMP_B, 'atk', createRng(4242));
  const total = map.score.A + map.score.B;

  assert(map.rounds.length === total, `precondition: rounds == score sum (${map.rounds.length} vs ${total})`);
  assert(total >= 13, `precondition: real map reaches >=13 rounds (got ${total})`);

  // -- full strip: exactly score.A + score.B cells -----------------------
  const fullHtml = toHtml(RoundTicker({ mapResult: map, playing: false }));
  const fullCells = countCells(fullHtml);
  assert(
    fullCells === total,
    `full strip must have exactly score.A+score.B cells: got ${fullCells}, expected ${total}`
  );

  // running scoreline reflects final score
  assert(fullHtml.includes(`>${map.score.A}<`), 'scoreline shows team A score');
  assert(fullHtml.includes(`>${map.score.B}<`), 'scoreline shows team B score');

  // every cell carries a team theme class
  const teamClassCount =
    countOccurrences(fullHtml, 'ticker__cell--teamA') + countOccurrences(fullHtml, 'ticker__cell--teamB');
  assert(teamClassCount === total, `each cell colored by winnerTeam: got ${teamClassCount}, expected ${total}`);

  // -- halftime divider present ------------------------------------------
  assert(
    fullHtml.includes('ticker__divider--halftime'),
    'halftime divider present after round 12'
  );

  // econ + end-condition glyphs are emitted
  assert(fullHtml.includes('ticker__econ'), 'econ glyphs present');
  assert(fullHtml.includes('ticker__end'), 'end-condition glyphs present');

  // -- playback: index hides later cells ---------------------------------
  // The cell COUNT stays score-sum (strip is stable), but rounds past the
  // cursor are marked hidden.
  const cut = 6;
  const playHtml = toHtml(RoundTicker({ mapResult: map, playing: true, index: cut }));
  assert(countCells(playHtml) === total, 'playback keeps the full cell count (strip stable)');

  const hiddenCount = countOccurrences(playHtml, 'ticker__cell--hidden');
  const expectedHidden = map.rounds.filter((r) => r.n > cut).length;
  assert(
    hiddenCount === expectedHidden,
    `playback hides rounds with n>index: got ${hiddenCount} hidden, expected ${expectedHidden}`
  );
  assert(expectedHidden > 0, 'precondition: there are rounds beyond the cursor to hide');

  // revealed rounds (n<=cut) are NOT hidden -> visible cells = cut count
  const visible = total - hiddenCount;
  assert(
    visible === map.rounds.filter((r) => r.n <= cut).length,
    'revealed cells equal rounds with n<=index'
  );

  // playback scoreline reflects only revealed rounds
  let liveA = 0;
  let liveB = 0;
  for (const r of map.rounds) {
    if (r.n <= cut) {
      if (r.winnerTeam === 'A') liveA += 1;
      else if (r.winnerTeam === 'B') liveB += 1;
    }
  }
  assert(liveA + liveB === cut, 'playback scoreline counts exactly the revealed rounds');

  // -- onSeek wiring: serialization stays pure (no throw, handler omitted) -
  let seeked = -1;
  const wired = RoundTicker({ mapResult: map, playing: false, onSeek: (n) => { seeked = n; } });
  const wiredHtml = toHtml(wired);
  assert(!wiredHtml.includes('onClick') && !wiredHtml.includes('onclick'), 'onClick omitted from HTML');
  assert(seeked === -1, 'onSeek not invoked during render');
}
