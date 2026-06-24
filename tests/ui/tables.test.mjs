/**
 * tests/ui/tables.test.mjs — headless tests for the table components
 * (DataTable, StandingsTable, BoxScore) per CONTRACTS-UI §6 / §8.
 *
 * BoxScore is exercised against a REAL MapResult produced by simSeries on two
 * PACIFIC_SEED teams, so we verify it renders every active player handle and
 * exactly one MVP marker over engine-backed data.
 */

import { assert, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { DataTable } from '../../src/ui/components/DataTable.js';
import { StandingsTable } from '../../src/ui/components/StandingsTable.js';
import { BoxScore } from '../../src/ui/components/BoxScore.js';

import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { PACIFIC_SEED } from '../../src/data/seed/pacific.js';
import { simSeries } from '../../src/engine/match/matchSim.js';

/** Count non-overlapping occurrences of a substring. */
function countOf(haystack, needle) {
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

/** Build a real MapResult fixture from two Pacific teams. */
function buildFixture() {
  const playersById = {};
  for (const p of PACIFIC_SEED.players) {
    const pp = createPlayer(p);
    playersById[pp.id] = pp;
  }
  const teamsById = {};
  const teams = [];
  for (const t of PACIFIC_SEED.teams) {
    const tt = createTeam(t);
    teamsById[tt.id] = tt;
    teams.push(tt);
  }
  const teamA = teams[0];
  const teamB = teams[1];
  const series = simSeries(teamA, teamB, playersById, 3, 4242);
  return { playersById, teamsById, teamA, teamB, series, mapResult: series.maps[0] };
}

export default async function run() {
  section('DataTable');
  {
    const columns = [
      { key: 'name', label: 'Player' },
      { key: 'acs', label: 'ACS', numeric: true, sortable: true },
      { key: 'k', label: 'K', numeric: true, render: (r) => r.k }
    ];
    const rows = [
      { id: 'p1', name: 'alpha', acs: 240, k: 18 },
      { id: 'p2', name: 'bravo', acs: 198, k: 14 }
    ];
    const html = toHtml(
      DataTable({
        columns,
        rows,
        sortKey: 'acs',
        sortDir: 'desc',
        onSort: () => {},
        rowKey: (r) => r.id
      })
    );
    assert(html.includes('class="table'), 'DataTable emits .table');
    assert(html.includes('table__head'), 'DataTable renders a header');
    assert(countOf(html, 'table__sort') >= 1, 'sortable column emits a sort button');
    assert(html.includes('table__sort--active'), 'active sort column marked');
    assert(html.includes('alpha') && html.includes('bravo'), 'DataTable renders rows');
    assert(html.includes('240') && html.includes('198'), 'DataTable renders cell values');
    assert(countOf(html, 'table__cell--num') >= 4, 'numeric header + body cells present');
  }

  section('StandingsTable');
  {
    const rows = [
      { rank: 1, teamId: 'drx', teamName: 'DRX', w: 4, l: 0, mapW: 8, mapL: 2, roundDiff: 36 },
      { rank: 2, teamId: 'geng', teamName: 'Gen.G', w: 3, l: 1, mapW: 7, mapL: 4, roundDiff: -5, me: true }
    ];
    let clicked = null;
    const html = toHtml(StandingsTable({ rows, onTeam: (id) => (clicked = id) }));
    assert(html.includes('standings'), 'StandingsTable emits .standings');
    assert(html.includes('DRX') && html.includes('Gen.G'), 'standings rows render team names');
    assert(html.includes('4-0') && html.includes('3-1'), 'W-L cells render');
    assert(html.includes('+36'), 'positive round diff signed');
    assert(html.includes('standings__diff--pos'), 'positive diff tinted');
    assert(html.includes('standings__diff--neg'), 'negative diff tinted');
    assert(html.includes('table__row--me'), 'followed-team row emphasized');
    // onTeam wiring exists (handler is dropped by toHtml, so just assert prop builds)
    assert(typeof StandingsTable({ rows, onTeam: () => {} }) === 'object', 'returns a VNode');
  }

  section('BoxScore (real MapResult)');
  {
    const { playersById, teamsById, teamA, teamB, mapResult } = buildFixture();
    const html = toHtml(
      BoxScore({ mapResult, playersById, teamsById, teamAId: teamA.id, teamBId: teamB.id })
    );

    // Every active player handle from BOTH teams must appear.
    const activeIds = [...teamA.roster.slice(0, 5), ...teamB.roster.slice(0, 5)];
    assert(activeIds.length === 10, 'fixture has 10 active players');
    for (const id of activeIds) {
      const handle = playersById[id].handle;
      assert(html.includes(handle), `BoxScore contains handle ${handle}`);
    }

    // Exactly one MVP marker.
    assert(countOf(html, 'boxscore__row--mvp') === 1, 'exactly one MVP row');
    assert(countOf(html, 'boxscore__mvp-badge') === 1, 'exactly one MVP badge');
    assert(
      html.includes(playersById[mapResult.mvpPlayerId].handle),
      'the MVP handle is present'
    );

    // Two team blocks + structure.
    assert(countOf(html, 'boxscore__team--A') === 1, 'team A block');
    assert(countOf(html, 'boxscore__team--B') === 1, 'team B block');
    assert(countOf(html, 'boxscore__player') === 10, 'ten player rows total');
    assert(html.includes('K/D/A') && html.includes('ACS') && html.includes('KAST'), 'stat headers');
    assert(html.includes('KD'), 'KD column header');

    // Players sorted by ACS descending within team A: first listed row of A
    // should be the highest-ACS player on team A.
    const box = mapResult.boxScore;
    const aSorted = teamA.roster
      .slice(0, 5)
      .slice()
      .sort((x, y) => box[y].acs - box[x].acs);
    const topHandle = playersById[aSorted[0]].handle;
    const lowHandle = playersById[aSorted[aSorted.length - 1]].handle;
    assert(
      html.indexOf(topHandle) < html.indexOf(lowHandle),
      'team A players sorted by ACS desc'
    );
  }
}
