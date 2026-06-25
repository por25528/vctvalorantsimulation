/**
 * config/cpTable.js — Championship Points (CP) award table.
 * Keyed by event type -> placement (1-based) -> points awarded.
 * Defaults follow ARCHITECTURE §12:
 *   - Kickoff: 4/3/2/1 to the top 4.
 *   - Stage:   1st = 5, descending (5/4/3/2/1 to the top 5).
 *   - Masters: champion = 8, descending (8/7/.../1 to the top 8).
 *   - Champions: the season finale — awards no CP (empty table).
 *
 * Frozen so the award schedule is immutable; the career CP engine reads from
 * here and never hardcodes these numbers.
 *
 * @typedef {'kickoff'|'stage'|'masters'|'champions'} CpEventType
 */

/**
 * Build a placement->points map descending from `top` down to 1.
 * Placement `top` yields `top` points, placement (top-1) yields top-1, etc.
 * @param {number} top  points (and placements) for 1st place
 * @returns {Readonly<Record<number, number>>}
 */
function descending(top) {
  /** @type {Record<number, number>} */
  const table = {};
  for (let placement = 1; placement <= top; placement++) {
    table[placement] = top - placement + 1;
  }
  return Object.freeze(table);
}

/**
 * Explicit placement->points map from an ordered point list (index 0 == 1st).
 * @param {ReadonlyArray<number>} points
 * @returns {Readonly<Record<number, number>>}
 */
function fromList(points) {
  /** @type {Record<number, number>} */
  const table = {};
  points.forEach((pts, i) => {
    table[i + 1] = pts;
  });
  return Object.freeze(table);
}

/**
 * CP awards by event type and placement.
 * @type {Readonly<Record<CpEventType, Readonly<Record<number, number>>>>}
 */
export const CP_TABLE = Object.freeze({
  kickoff: fromList([4, 3, 2, 1]),
  stage: descending(5),
  masters: descending(8),
  lcq: fromList([3, 2, 1]),
  champions: Object.freeze({})
});
