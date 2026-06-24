/**
 * engine/format/tiebreakers.js — the ordered tiebreak chain for standings rows:
 *   map-diff DESC -> round-diff DESC -> head-to-head -> seed ASC.
 * Phase 2. Pure functions, named exports, no randomness/DOM.
 *
 * compareStandings is a comparator over two standings rows. Rows are expected to
 * carry: { teamId, mapW, mapL, roundDiff, seed } and (optionally) a `series`
 * array used to resolve the head-to-head step. When `series` is absent the
 * head-to-head step is a no-op (0) and ordering falls through to seed.
 */

/**
 * Compare two standings rows by the ordered tiebreak chain. Returns a negative
 * number if `a` ranks ahead of `b`, positive if behind, 0 if fully tied.
 *
 * Order:
 *   1. map differential (mapW - mapL) DESC
 *   2. round differential (roundDiff) DESC
 *   3. head-to-head record between the two teams (more series wins ranks ahead)
 *   4. seed ASC (lower seed number ranks ahead)
 *
 * @param {{teamId:string,mapW:number,mapL:number,roundDiff:number,seed:number,series?:object[]}} a
 * @param {{teamId:string,mapW:number,mapL:number,roundDiff:number,seed:number,series?:object[]}} b
 * @returns {number}
 */
export function compareStandings(a, b) {
  // 1. map differential, higher first.
  const mapDiffA = (a.mapW || 0) - (a.mapL || 0);
  const mapDiffB = (b.mapW || 0) - (b.mapL || 0);
  if (mapDiffA !== mapDiffB) return mapDiffB - mapDiffA;

  // 2. round differential, higher first.
  const rdA = a.roundDiff || 0;
  const rdB = b.roundDiff || 0;
  if (rdA !== rdB) return rdB - rdA;

  // 3. head-to-head — uses whichever row carries the series list.
  const series = a.series || b.series;
  if (series) {
    // h2h is from a's perspective: 1 => a beat b overall => a ranks ahead.
    const h2h = headToHead(a.teamId, b.teamId, series);
    if (h2h !== 0) return -h2h;
  }

  // 4. seed, lower first.
  return (a.seed || 0) - (b.seed || 0);
}

/**
 * Head-to-head result of `teamId` versus `otherId` across the given series.
 * Counts series wins between exactly these two teams.
 *   +1 => teamId won more of their meetings (ranks ahead)
 *   -1 => otherId won more
 *    0 => even or never met
 *
 * @param {string} teamId
 * @param {string} otherId
 * @param {object[]} series
 * @returns {-1|0|1}
 */
export function headToHead(teamId, otherId, series) {
  let teamWins = 0;
  let otherWins = 0;
  for (const s of series || []) {
    if (!s || !s.teamAId || !s.teamBId) continue;
    const involvesBoth =
      (s.teamAId === teamId && s.teamBId === otherId) ||
      (s.teamAId === otherId && s.teamBId === teamId);
    if (!involvesBoth) continue;

    let winnerId = s.winnerId;
    if (winnerId !== teamId && winnerId !== otherId) {
      // fall back to map score if winnerId is missing/unexpected.
      const aMaps = (s.score && typeof s.score.A === 'number') ? s.score.A : 0;
      const bMaps = (s.score && typeof s.score.B === 'number') ? s.score.B : 0;
      winnerId = aMaps >= bMaps ? s.teamAId : s.teamBId;
    }
    if (winnerId === teamId) teamWins += 1;
    else if (winnerId === otherId) otherWins += 1;
  }
  if (teamWins > otherWins) return 1;
  if (otherWins > teamWins) return -1;
  return 0;
}
