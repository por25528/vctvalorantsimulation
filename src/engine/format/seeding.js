/**
 * engine/format/seeding.js — entrant resolution & seed-driven pairings.
 * Phase 2 (CONTRACTS-FORMAT §2). Pure functions, named exports, no DOM, no
 * Math.random — the only randomness (the Kickoff draw) flows through an injected
 * Rng. Runs unchanged in Node and the browser.
 *
 * @typedef {Object} StageStanding
 * @property {string} teamId
 * @property {number} rank      // 1 = best placement in that stage
 *
 * @typedef {Object} StageResult
 * @property {string} stageId
 * @property {string} kind
 * @property {StageStanding[]} standings
 * @property {string[]} advancers   // teamIds in advance order (advance:1 first)
 *
 * @typedef {{ from:'seed', seed:number } | { from:string, slot:string }} EntrantRef
 *
 * @typedef {Object} SeedingCtx
 * @property {string[]} seedOrder            // event-level seeding, teamIds by seed (index 0 => seed 1)
 * @property {Record<string,*>} [teamsById]
 * @property {Record<string,*>} [playersById]
 */

/**
 * Resolve a stage's entrant list into concrete teamIds, index 0 => seed 1.
 *
 * Each entry of `stage.entrants` is an EntrantRef:
 *   { from:'seed', seed:n }      -> ctx.seedOrder[n-1]
 *   { from:stageId, slot }       -> a placement/advancer from that prior stage:
 *       slot = '1'..'N'          -> standings entry with rank === Number(slot)
 *       slot = 'advance:k'       -> priorStage.advancers[k-1]
 *
 * @param {{ entrants:EntrantRef[] }} stage
 * @param {SeedingCtx} ctx
 * @param {Record<string, StageResult>} priorStages  // keyed by stageId
 * @returns {string[]} teamIds (seed order)
 */
export function resolveEntrants(stage, ctx, priorStages) {
  if (!stage || !Array.isArray(stage.entrants)) {
    throw new Error('resolveEntrants: stage.entrants must be an array');
  }
  const seedOrder = (ctx && ctx.seedOrder) || [];
  const prior = priorStages || {};

  return stage.entrants.map((ref, i) => {
    if (!ref || typeof ref !== 'object') {
      throw new Error(`resolveEntrants: entrant[${i}] must be an EntrantRef object`);
    }

    if (ref.from === 'seed') {
      const idx = ref.seed - 1;
      if (!Number.isInteger(ref.seed) || idx < 0 || idx >= seedOrder.length) {
        throw new Error(`resolveEntrants: seed ${ref.seed} out of range (seedOrder length ${seedOrder.length})`);
      }
      return seedOrder[idx];
    }

    // { from:stageId, slot }
    const src = prior[ref.from];
    if (!src) {
      throw new Error(`resolveEntrants: no prior stage result for '${ref.from}'`);
    }
    const slot = String(ref.slot);

    if (slot.startsWith('advance:')) {
      const k = Number(slot.slice('advance:'.length));
      const advancers = src.advancers || [];
      if (!Number.isInteger(k) || k < 1 || k > advancers.length) {
        throw new Error(`resolveEntrants: advance slot '${slot}' out of range for stage '${ref.from}'`);
      }
      return advancers[k - 1];
    }

    // numeric placement slot -> standings entry with that rank
    const rank = Number(slot);
    if (!Number.isInteger(rank) || rank < 1) {
      throw new Error(`resolveEntrants: invalid slot '${slot}' for stage '${ref.from}'`);
    }
    const standings = src.standings || [];
    const hit = standings.find((s) => s.rank === rank);
    if (!hit) {
      throw new Error(`resolveEntrants: no standing with rank ${rank} in stage '${ref.from}'`);
    }
    return hit.teamId;
  });
}

/**
 * Cross-seed two groups of advancers (4 each) into a single 8-team seed list
 * for the playoff bracket: [A1,B1,A2,B2,A3,B3,A4,B4]
 * (seed1=A1, seed2=B1, seed3=A2, seed4=B2, seed5=A3, seed6=B3, seed7=A4, seed8=B4).
 * This guarantees every round-1 pairing is cross-group.
 *
 * @param {string[]} groupAEntrants  // 4 teamIds, index 0 = group A 1st
 * @param {string[]} groupBEntrants  // 4 teamIds, index 0 = group B 1st
 * @returns {string[]} 8 teamIds in seed order
 */
export function crossSeed(groupAEntrants, groupBEntrants) {
  if (!Array.isArray(groupAEntrants) || groupAEntrants.length !== 4) {
    throw new Error('crossSeed: groupAEntrants must have exactly 4 teamIds');
  }
  if (!Array.isArray(groupBEntrants) || groupBEntrants.length !== 4) {
    throw new Error('crossSeed: groupBEntrants must have exactly 4 teamIds');
  }
  const out = [];
  for (let i = 0; i < 4; i++) {
    out.push(groupAEntrants[i], groupBEntrants[i]);
  }
  return out;
}

/**
 * First-round pairings for an 8-seed single-side bracket draw:
 * [[s1,s8],[s4,s5],[s3,s6],[s2,s7]] mapped from a seed-ordered team list.
 *
 * @param {string[]} seedTeamIds  // 8 teamIds, index 0 = seed 1
 * @returns {string[][]} 4 pairs of teamIds
 */
export function bracketPairing8(seedTeamIds) {
  if (!Array.isArray(seedTeamIds) || seedTeamIds.length !== 8) {
    throw new Error('bracketPairing8: expected exactly 8 seedTeamIds');
  }
  const s = (n) => seedTeamIds[n - 1]; // 1-based seed -> teamId
  return [
    [s(1), s(8)],
    [s(4), s(5)],
    [s(3), s(6)],
    [s(2), s(7)]
  ];
}

/**
 * Opening pairings for the gsl6 group template (6 teams, seeds 1 & 2 bye into
 * the second upper matches). Per CONTRACTS-FORMAT §5c:
 *   M1 = seed3 vs seed6
 *   M2 = seed4 vs seed5
 * (seeds 1 & 2 enter at M3/M4 against the M2/M1 winners.)
 *
 * @param {string[]} seedTeamIds  // 6 teamIds, index 0 = seed 1
 * @returns {string[][]} the two opening pairs [[s3,s6],[s4,s5]]
 */
export function bracketPairing6(seedTeamIds) {
  if (!Array.isArray(seedTeamIds) || seedTeamIds.length !== 6) {
    throw new Error('bracketPairing6: expected exactly 6 seedTeamIds');
  }
  const s = (n) => seedTeamIds[n - 1];
  return [
    [s(3), s(6)],
    [s(4), s(5)]
  ];
}

/**
 * Deterministic Fisher-Yates shuffle of teamIds using an injected Rng (the
 * Kickoff draw). Pure with respect to the rng stream: same seeded rng + input
 * always yields the same order. Does not mutate the input array.
 *
 * @param {string[]} teamIds
 * @param {import('../../core/rng.js').Rng} rng
 * @returns {string[]} shuffled teamIds (the drawn seed order)
 */
export function drawSeedOrder(teamIds, rng) {
  if (!Array.isArray(teamIds)) {
    throw new Error('drawSeedOrder: teamIds must be an array');
  }
  if (!rng || typeof rng.int !== 'function') {
    throw new Error('drawSeedOrder: rng with int(maxExclusive) is required');
  }
  const a = teamIds.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1); // uniform in [0, i]
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
