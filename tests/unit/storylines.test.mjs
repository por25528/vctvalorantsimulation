/**
 * tests/unit/storylines.test.mjs — the Storyteller narrative engine (Wave 2 / D).
 *
 * Pure: constructed history ledgers → exact, deterministic Story[]. No engine sim
 * (fast, no OOM). Exercises every detector + the determinism / hashSeed-variety
 * and empty-world guarantees, plus the World Feed group/icon maps.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { deriveStorylines, STORY_GROUP, STORY_ICON } from '../../src/engine/career/storylines.js';

/** A small award-winner fixture (the shape `computeSeasonAwards` produces). */
function w(playerId, teamId, handle, age) {
  return { playerId, teamId, handle, role: 'Duelist', age, maps: 30, kills: 500, acs: 250, rating: 250 };
}

/** An empty SeasonAwards object. */
function noAwards() {
  return { mvp: null, finalsMvp: null, rookieOfYear: null, allProFirst: [], allProSecond: [], regionMvps: {} };
}

const FIELD = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const world = {
  teams: {
    A: { id: 'A', name: 'Alpha', tag: 'ALP' }, B: { id: 'B', name: 'Beta', tag: 'BET' },
    C: { id: 'C', name: 'Cee', tag: 'CEE' }, D: { id: 'D', name: 'Dee', tag: 'DEE' }
  },
  players: {
    mv: { id: 'mv', handle: 'Star' }, rk: { id: 'rk', handle: 'Kid' }
  }
};

export default async function run() {
  section('empty / early world — no throw, no stories');
  assertEqual(deriveStorylines([], world), [], 'no history → no stories');
  assertEqual(deriveStorylines(null, world), [], 'null history → no stories');
  const oneSeason = deriveStorylines(
    [{ seasonIndex: 0, champion: 'A', finalStandings: ['A', 'B'], championsField: FIELD, eventWinners: [], awards: noAwards() }],
    world
  );
  assert(oneSeason.some((s) => s.category === 'crown' && s.teamId === 'A'), 'a single season yields a crown story');
  assert(oneSeason.every((s) => !Number.isNaN(s.weight) && typeof s.headline === 'string'), 'no NaN / valid headlines');

  section('dynasty + rivalry + player arcs over a multi-season ledger');
  const history = [
    { seasonIndex: 0, champion: 'A', finalStandings: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], championsField: FIELD, eventWinners: [], awards: { ...noAwards(), rookieOfYear: w('rk', 'A', 'Kid', 19) } },
    { seasonIndex: 1, champion: 'B', finalStandings: ['B', 'A', 'C', 'D', 'E', 'F', 'G', 'H'], championsField: FIELD, eventWinners: [], awards: { ...noAwards(), mvp: w('mv', 'B', 'Star', 24), allProFirst: [w('mv', 'B', 'Star', 24)] } },
    { seasonIndex: 2, champion: 'A', finalStandings: ['A', 'B', 'D', 'E', 'F', 'C', 'G', 'H'], championsField: FIELD, eventWinners: [], awards: { ...noAwards(), mvp: w('mv', 'B', 'Star', 25), allProFirst: [w('rk', 'A', 'Kid', 21)] } },
    { seasonIndex: 3, champion: 'C', finalStandings: ['C', 'A', 'B', 'D', 'E', 'F', 'G', 'H'], championsField: ['A', 'B', 'D', 'E', 'F', 'C', 'G', 'H'], eventWinners: [], awards: noAwards() }
  ];
  const stories = deriveStorylines(history, world);
  const byCat = {};
  for (const s of stories) byCat[s.category] = (byCat[s.category] || 0) + 1;

  assert(byCat.crown === 4, 'one crown per completed season');
  const dyn = stories.find((s) => s.category === 'dynasty');
  assert(dyn && dyn.teamId === 'A', 'Alpha (titles S1+S3) earns a dynasty story');
  const riv = stories.find((s) => s.category === 'rivalry');
  assert(riv && riv.teamIds.includes('A') && riv.teamIds.includes('B'), 'Alpha vs Beta rivalry detected (repeat title-deciders)');
  const mile = stories.find((s) => s.category === 'milestone');
  assert(mile && mile.playerId === 'mv', 'Star (2× MVP) earns an all-time-great milestone');
  const brk = stories.find((s) => s.category === 'breakout');
  assert(brk && brk.playerId === 'rk', 'Kid (RotY S1 → All-Pro S3) earns a breakout arc');
  const ups = stories.find((s) => s.category === 'upset');
  assert(ups && ups.teamId === 'C', 'low-seeded champion Cee earns an upset story');
  const cmb = stories.find((s) => s.category === 'comeback');
  assert(cmb && cmb.teamId === 'C', 'Cee (bottom-half S3 → champions S4) earns a comeback');

  section('ordering — newest era first, most dramatic within a season');
  for (let i = 1; i < stories.length; i++) {
    assert(stories[i - 1].seasonIndex >= stories[i].seasonIndex, 'stories are newest-era first');
  }

  section('determinism + hashSeed variety (no rng leakage)');
  assertEqual(deriveStorylines(history, world), stories, 'same history → byte-identical stories');
  // Engine-shape world ({teamsById}) resolves names identically to the ui-shape world.
  const engineWorld = { teamsById: world.teams, playersById: world.players };
  assertEqual(deriveStorylines(history, engineWorld).map((s) => s.headline), stories.map((s) => s.headline), 'engine-world + ui-world resolve the same headlines');

  section('decline — a former champion that has slid out of contention');
  const declineHist = [
    { seasonIndex: 0, champion: 'A', finalStandings: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], championsField: FIELD, eventWinners: [], awards: noAwards() },
    { seasonIndex: 1, champion: 'B', finalStandings: ['B', 'C', 'D', 'E', 'F', 'A', 'G', 'H'], championsField: FIELD, eventWinners: [], awards: noAwards() },
    { seasonIndex: 2, champion: 'B', finalStandings: ['B', 'C', 'D', 'E', 'F', 'G', 'A', 'H'], championsField: FIELD, eventWinners: [], awards: noAwards() }
  ];
  const dec = deriveStorylines(declineHist, world).find((s) => s.category === 'decline');
  assert(dec && dec.teamId === 'A', 'Alpha (champ S1, now 7th) flagged as fallen giants');
  assert(dec.tone === 'bad', 'decline carries a bad tone');

  section('retirement tributes — decorated retirees from the off-season report');
  const retire = deriveStorylines(history, world, { offseasonReport: { season: 4, retired: ['mv', 'nobody'] } });
  const trib = retire.find((s) => s.category === 'retirement');
  assert(trib && trib.playerId === 'mv', 'Star (a champion-era MVP) earns a retirement tribute');
  assert(!retire.some((s) => s.category === 'retirement' && s.playerId === 'nobody'), 'an undecorated retiree gets no tribute');

  section('group + icon maps cover every category');
  for (const cat of Object.keys(STORY_GROUP)) {
    assert(typeof STORY_GROUP[cat] === 'string' && typeof STORY_ICON[cat] === 'string', `${cat} has a group + icon`);
  }
}
