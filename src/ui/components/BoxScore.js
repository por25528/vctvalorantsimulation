/**
 * ui/components/BoxScore.js — shared component rendering a MapResult box score
 * (CONTRACTS-UI §6). Phase 3 (UI shell). Pure props -> VNode; emits the
 * `.boxscore` / `.table` BEM classes from styles/main.css.
 *
 * Two team blocks (A / B). Players sorted by ACS descending. Columns:
 * K/D/A, ACS, ADR, KAST, FB, CL, KD. The MVP row is highlighted
 * (`.boxscore__row--mvp`) with an inline marker.
 */

import { h, classNames } from '../render.js';
import { mapRating } from '../../engine/career/rating.js';

/** Stat columns (in display order) after the player handle. */
const STAT_COLUMNS = [
  { key: 'rat', label: 'RAT' },
  { key: 'kda', label: 'K/D/A' },
  { key: 'acs', label: 'ACS' },
  { key: 'adr', label: 'ADR' },
  { key: 'kast', label: 'KAST' },
  { key: 'fb', label: 'FB' },
  { key: 'cl', label: 'CL' },
  { key: 'kd', label: 'KD' }
];

/** Color an HLTV-style rating by tier. */
function ratingClass(r) {
  const v = Number(r) || 0;
  if (v >= 1.1) return 'boxscore__stat rating rating--elite';
  if (v >= 1.0) return 'boxscore__stat rating rating--good';
  if (v < 0.95) return 'boxscore__stat rating rating--low';
  return 'boxscore__stat rating';
}

/**
 * @param {object} props
 * @param {import('../../engine/match/matchSim.js').MapResult} props.mapResult
 * @param {Record<string, object>} props.playersById  playerId -> Player (for handles)
 * @param {Record<string, object>} props.teamsById    teamId -> Team (for rosters/names)
 * @param {string} [props.teamAId]  explicit team A id (falls back to mapResult.teamAId)
 * @param {string} [props.teamBId]  explicit team B id
 * @returns {*} VNode
 */
export function BoxScore(props) {
  const {
    mapResult,
    playersById = {},
    teamsById = {},
    teamAId = mapResult && mapResult.teamAId,
    teamBId = mapResult && mapResult.teamBId
  } = props || {};

  if (!mapResult || !mapResult.boxScore) {
    return h('div', { class: 'boxscore boxscore--empty muted' }, 'No box score.');
  }

  const box = mapResult.boxScore;
  const mvpId = mapResult.mvpPlayerId;
  const score = mapResult.score || { A: 0, B: 0 };
  const rounds = (score.A || 0) + (score.B || 0);

  // Partition the box-score player ids into team A and team B. Prefer the
  // teams' rosters (authoritative); fall back to the comp arrays' lengths.
  const teamA = teamAId ? teamsById[teamAId] : undefined;
  const teamB = teamBId ? teamsById[teamBId] : undefined;
  const { aIds, bIds } = partition(box, teamA, teamB);

  return h(
    'div',
    { class: 'boxscore' },
    teamBlock('A', teamA, teamAId, aIds, box, mvpId, playersById, score.A, rounds),
    teamBlock('B', teamB, teamBId, bIds, box, mvpId, playersById, score.B, rounds)
  );
}

/** Render one team's block (header + table). */
function teamBlock(side, team, teamId, playerIds, box, mvpId, playersById, mapScore, rounds) {
  const name = team && team.name ? team.name : teamId || `Team ${side}`;

  // Sort the team's players by ACS descending.
  const sorted = playerIds
    .slice()
    .sort((a, b) => acsOf(box, b) - acsOf(box, a));

  const head = h(
    'thead',
    { class: 'table__head' },
    h(
      'tr',
      { class: 'table__row' },
      h('th', { class: 'table__cell', scope: 'col' }, name),
      STAT_COLUMNS.map((c) =>
        h('th', { key: c.key, class: 'table__cell table__cell--num', scope: 'col' }, c.label)
      )
    )
  );

  const body = h(
    'tbody',
    null,
    sorted.map((pid) => playerRow(pid, box[pid], pid === mvpId, playersById, rounds))
  );

  return h(
    'div',
    { class: classNames('boxscore__team', `boxscore__team--${side}`) },
    h(
      'div',
      { class: 'boxscore__teamhead' },
      h('span', { class: 'boxscore__teamname' }, name),
      h('span', { class: 'boxscore__teamscore' }, String(mapScore == null ? '' : mapScore))
    ),
    h('table', { class: 'table boxscore__table' }, head, body)
  );
}

/** Render one player row. */
function playerRow(playerId, stat, isMvp, playersById, rounds) {
  const s = stat || {};
  const player = playersById[playerId];
  const handle = player && player.handle ? player.handle : playerId;

  const kd = s.kd != null ? s.kd : safeKd(s);
  const kdCls = kd > 1 ? 'boxscore__kd--pos' : kd < 1 ? 'boxscore__kd--neg' : null;
  const rating = mapRating(s, rounds);

  return h(
    'tr',
    {
      key: String(playerId),
      class: classNames('boxscore__row', isMvp && 'boxscore__row--mvp')
    },
    h(
      'td',
      { class: 'table__cell boxscore__player' },
      handle,
      isMvp ? h('span', { class: 'boxscore__mvp-badge' }, 'MVP') : null
    ),
    h('td', { class: classNames('table__cell table__cell--num', ratingClass(rating)) }, rating.toFixed(2)),
    statCell(`${num(s.kills)}/${num(s.deaths)}/${num(s.assists)}`),
    statCell(round1(s.acs)),
    statCell(round1(s.adr)),
    statCell(pct(s.kast)),
    statCell(num(s.firstBloods)),
    statCell(num(s.clutches)),
    statCell(round2(kd), kdCls)
  );
}

/** A right-aligned numeric stat cell (with optional extra class). */
function statCell(value, extra) {
  return h('td', { class: classNames('table__cell table__cell--num boxscore__stat', extra) }, value);
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

/** ACS for a player id (0 if absent). */
function acsOf(box, pid) {
  const s = box[pid];
  return s && typeof s.acs === 'number' ? s.acs : 0;
}

/** K/D ratio guarding zero deaths. */
function safeKd(s) {
  const k = Number(s.kills) || 0;
  const d = Number(s.deaths) || 0;
  return d === 0 ? k : k / d;
}

function num(v) {
  return v == null ? 0 : v;
}
function round1(v) {
  return v == null ? 0 : Math.round(Number(v) * 10) / 10;
}
function round2(v) {
  return v == null ? 0 : Math.round(Number(v) * 100) / 100;
}
function pct(v) {
  if (v == null) return '0%';
  // KAST may be a 0..1 fraction or a 0..100 number; normalize to a percent.
  const n = Number(v);
  const p = n <= 1 ? n * 100 : n;
  return `${Math.round(p)}%`;
}

/**
 * Split box-score player ids into team A vs team B. When rosters are available
 * use them (authoritative); otherwise fall back to a stable id split in half.
 * @returns {{aIds:string[], bIds:string[]}}
 */
function partition(box, teamA, teamB) {
  const ids = Object.keys(box);
  const rosterA = new Set((teamA && teamA.roster) || []);
  const rosterB = new Set((teamB && teamB.roster) || []);

  if (rosterA.size || rosterB.size) {
    const aIds = [];
    const bIds = [];
    for (const id of ids) {
      if (rosterA.has(id)) aIds.push(id);
      else if (rosterB.has(id)) bIds.push(id);
      else bIds.push(id); // unknown -> bucket into B to keep it visible
    }
    if (aIds.length || bIds.length) return { aIds, bIds };
  }

  // Fallback: split the (stable-ordered) ids into two halves of five.
  const half = Math.ceil(ids.length / 2);
  return { aIds: ids.slice(0, half), bIds: ids.slice(half) };
}
