/**
 * engine/career/qualification.js — qualification glue.
 * Phase 2 career slice. Binding contract: CONTRACTS-FORMAT §7.
 *
 * Pure, deterministic, named export only. No randomness, no I/O.
 */

/** Fixed international region order — directs and swiss ties resolve in this order. */
export const REGION_ORDER = Object.freeze(['pacific', 'americas', 'emea', 'china']);

/**
 * Resolve the three Masters qualifiers from a completed regional EventResult
 * (Kickoff or any Stage — the rule is identical).
 *
 * Per the locked rule: placement 1 seeds into the Masters playoff (a direct
 * seed); placements 2 and 3 seed into the Masters Swiss. Exactly 3 qualifiers,
 * in placement order.
 *
 * @param {{ placements:Array<{rank:number, teamId:string}> }} eventResult
 * @returns {Array<{teamId:string, seedInto:string}>} frozen, length 3
 */
export function regionQualifiers(eventResult) {
  const byRank = new Map(eventResult.placements.map((p) => [p.rank, p.teamId]));
  const seedInto = { 1: 'masters-playoff', 2: 'masters-swiss', 3: 'masters-swiss' };
  const qualifiers = [1, 2, 3].map((rank) =>
    Object.freeze({ teamId: byRank.get(rank), seedInto: seedInto[rank] })
  );
  return Object.freeze(qualifiers);
}

/**
 * Alias kept for the Phase-2 contract / existing callers.
 * @see regionQualifiers
 */
export const kickoffQualifiers = regionQualifiers;

/**
 * Build the 12-team seed order for a Masters from the four feeding regional
 * events.
 *
 * Seeds 1..4  = the four regions' direct (placement-1) teams, in FIXED region
 *               order [pacific, americas, emea, china].
 * Seeds 5..12 = the eight Swiss teams (placements 2 & 3 of each region),
 *               ordered by (placement asc, region order). So all four
 *               placement-2 teams come first (in region order), then the four
 *               placement-3 teams (in region order).
 *
 * @param {Record<string, {placements:Array<{rank:number, teamId:string}>}>} regionResultsByRegion
 *   keyed by region name; must contain all four REGION_ORDER regions.
 * @returns {string[]} frozen array of 12 teamIds (index 0 == seed 1)
 */
export function mastersSeedOrder(regionResultsByRegion) {
  /** @param {{placements:Array<{rank:number, teamId:string}>}} res @param {number} rank */
  const teamAt = (res, rank) => {
    const p = res.placements.find((x) => x.rank === rank);
    return p ? p.teamId : undefined;
  };

  // Seeds 1..4: placement-1 of each region, in fixed region order.
  const directs = REGION_ORDER.map((region) => teamAt(regionResultsByRegion[region], 1));

  // Seeds 5..12: placement 2 then placement 3, each in region order.
  const swiss = [];
  for (const placement of [2, 3]) {
    for (const region of REGION_ORDER) {
      swiss.push(teamAt(regionResultsByRegion[region], placement));
    }
  }

  return Object.freeze([...directs, ...swiss]);
}

/**
 * Build the 16-team seed order for the Champions event.
 *
 * Index 0      = the direct-slot team (the final Masters champion).
 * Indices 1..15 = the top-15 teams by cumulative CP, EXCLUDING the direct team,
 *                 ties broken by teamId ascending.
 *
 * @param {{ totals:Record<string, number> }} cpLedger
 * @param {string} directSlotTeamId
 * @returns {string[]} frozen array of 16 teamIds (index 0 == seed 1)
 */
export function championsField(cpLedger, directSlotTeamId) {
  const totals = cpLedger.totals || {};
  const ranked = Object.keys(totals)
    .filter((teamId) => teamId !== directSlotTeamId)
    .sort((a, b) =>
      (totals[b] - totals[a]) || (a < b ? -1 : a > b ? 1 : 0)
    )
    .slice(0, 15);
  return Object.freeze([directSlotTeamId, ...ranked]);
}
