/**
 * ui/derive.js — pure presentation-model derivations for the UI layer
 * (CONTRACTS-UI §6). DOM-free: these helpers turn engine outputs (EventResult,
 * StageResult, SeriesRef[]) into the flat, render-ready view models the
 * components consume. No `document`/`window`, no engine mutation.
 */

import { buildTemplate } from '../engine/format/bracket.js';

/**
 * @typedef {Object} BracketSide
 * @property {string|undefined} teamId  resolved competitor (undefined if unknown)
 * @property {number|undefined} score   that side's map-wins in the series
 * @property {boolean} winner           true if this side won the series
 *
 * @typedef {Object} BracketMatchView
 * @property {string} matchId
 * @property {string} round            display round name (e.g. 'Upper Quarterfinal')
 * @property {number} bestOf
 * @property {BracketSide} a
 * @property {BracketSide} b
 * @property {boolean} played          true once the series resolved
 * @property {boolean} decidesTitle    true if the winner takes 1st place (the final)
 *
 * @typedef {Object} BracketColumn
 * @property {string} id               'upper' | 'middle' | 'lower' | 'winners' | 'losers'
 * @property {string} label            human column header
 * @property {BracketMatchView[]} matches
 *
 * @typedef {Object} BracketView
 * @property {string} bracketType
 * @property {BracketColumn[]} columns
 */

/** Column layout per bracket type, keyed by a match-id prefix classifier. */
const TRIPLE_COLUMNS = [
  { id: 'upper', label: 'Upper' },
  { id: 'middle', label: 'Middle' },
  { id: 'lower', label: 'Lower' }
];
const DOUBLE_COLUMNS = [
  { id: 'winners', label: 'Winners' },
  { id: 'losers', label: 'Losers' },
  { id: 'final', label: 'Grand Final' }
];

/**
 * Classify a bracket match id into a column id for a given bracket type.
 *   triple : Uxx -> upper, Mxx -> middle, Lxx -> lower
 *   double : Uxx -> winners, Lxx -> losers, Gxx -> final (the Grand Final stands alone)
 * @param {string} matchId
 * @param {string} bracketType
 * @returns {string}
 */
function columnOf(matchId, bracketType) {
  const c = matchId.charAt(0).toUpperCase();
  if (bracketType === 'triple') {
    if (c === 'U') return 'upper';
    if (c === 'M') return 'middle';
    return 'lower'; // L*
  }
  if (bracketType === 'double') {
    if (c === 'U') return 'winners';
    if (c === 'G') return 'final'; // the Grand Final gets its own column
    return 'losers'; // L*
  }
  // single / other: a single 'main' column.
  return 'main';
}

/**
 * Build the bracket presentation model for a bracket stage.
 *
 * Calls {@link buildTemplate}(stageDescriptor.bracketType, stageDescriptor.size)
 * to get the fixed match graph, joins each match to its played SeriesRef from
 * `eventResult.series` (by matchId), and groups the matches into the bracket's
 * columns (Upper/Middle/Lower for triple; Winners/Losers for double).
 *
 * Each match becomes:
 *   { matchId, round, bestOf, a:{teamId,score,winner}, b:{...}, played }
 *
 * Pure — never mutates its inputs; missing series (unplayed matches) yield a
 * card with `teamId: undefined` and `played: false`.
 *
 * @param {Object} eventResult  EventResult (uses `.series`)
 * @param {Object} stageDescriptor  { bracketType, size?, id? }
 * @returns {BracketView}
 */
export function buildBracketView(eventResult, stageDescriptor) {
  if (!stageDescriptor || typeof stageDescriptor !== 'object') {
    throw new Error('buildBracketView: stageDescriptor is required');
  }
  const bracketType = stageDescriptor.bracketType;
  if (!bracketType) {
    throw new Error('buildBracketView: stageDescriptor.bracketType is required');
  }

  const template = buildTemplate(bracketType, stageDescriptor.size);

  // Index this stage's series by matchId. When a stageDescriptor.id is given we
  // restrict to that stage; otherwise match purely on matchId (a single bracket
  // stage in the event). Inputs are never mutated.
  const stageId = stageDescriptor.id;
  const seriesByMatch = new Map();
  for (const s of (eventResult && eventResult.series) || []) {
    if (!s || typeof s.matchId !== 'string') continue;
    if (stageId !== undefined && s.stageId !== stageId) continue;
    if (!seriesByMatch.has(s.matchId)) seriesByMatch.set(s.matchId, s);
  }

  // Column buckets in canonical order for this bracket type.
  const colDefs =
    bracketType === 'triple'
      ? TRIPLE_COLUMNS
      : bracketType === 'double'
        ? DOUBLE_COLUMNS
        : [{ id: 'main', label: 'Bracket' }];

  /** @type {Map<string, BracketColumn>} */
  const columns = new Map();
  for (const def of colDefs) {
    columns.set(def.id, { id: def.id, label: def.label, matches: [] });
  }

  for (const match of template) {
    const s = seriesByMatch.get(match.id);
    const view = matchView(match, s);
    const colId = columnOf(match.id, bracketType);
    let col = columns.get(colId);
    if (!col) {
      col = { id: colId, label: colId, matches: [] };
      columns.set(colId, col);
    }
    col.matches.push(view);
  }

  return {
    bracketType,
    columns: [...columns.values()]
  };
}

/**
 * Build a single match view from its template entry + (optional) played series.
 * The series exposes teamAId/teamBId/winnerId/score{A,B}; an unplayed match has
 * no series and yields undefined competitors.
 * @param {Object} match  BracketMatch (id, round, bestOf)
 * @param {Object|undefined} series  SeriesRef
 * @returns {BracketMatchView}
 */
function matchView(match, series) {
  const played = !!series;
  const aTeam = played ? series.teamAId : undefined;
  const bTeam = played ? series.teamBId : undefined;
  const winnerId = played ? series.winnerId : undefined;
  const score = played && series.score ? series.score : { A: undefined, B: undefined };
  const bestOf =
    played && typeof series.bestOf === 'number' ? series.bestOf : match.bestOf;

  return {
    matchId: match.id,
    round: match.round,
    bestOf,
    played,
    // The match whose winner takes 1st place — used to crown the champion.
    decidesTitle: !!(match.winnerTo && match.winnerTo.placement === 1),
    a: {
      teamId: aTeam,
      score: score.A,
      winner: played && winnerId === aTeam
    },
    b: {
      teamId: bTeam,
      score: score.B,
      winner: played && winnerId === bTeam
    }
  };
}
