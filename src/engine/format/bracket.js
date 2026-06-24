/**
 * engine/format/bracket.js — generic elimination bracket engine (CONTRACTS-FORMAT §4, §5).
 *
 * A bracket is a FIXED, hand-verified graph of {@link BracketMatch}es. Each match
 * draws its two competitors from {@link SourceRef}s (a seed, or the winner/loser of
 * an earlier match) and routes its winner & loser onward via {@link Routing}s
 * (into another match's slot, to a final placement, to elimination, or to advance).
 *
 *   buildTemplate(bracketType, size) -> BracketMatch[]         // the §5 graphs
 *   simulateBracket(template, seedTeamIds, ctx, makeSeed)      // play it out
 *   run(stage, entrants, ctx, makeSeed, rng) -> StageResult    // stage-kind entry
 *
 * Hard rules (CONTRACTS §0-§2): pure functions, named exports only, no
 * Math.random / Date.now / window / document. Every series is decided by
 * `simSeries(...)` seeded with `makeSeed(matchId)` (== hashSeed(eventSeed, stageId,
 * matchId)) — never by the bracket's own rng — so each series is independently
 * reproducible. Outputs are fresh objects; inputs are never mutated. Runs
 * unchanged in Node and the browser.
 *
 * @typedef {{ seed:number } | { winnerOf:string } | { loserOf:string } | { entrant:string }} SourceRef
 * @typedef {{ to:string, slot:'a'|'b' } | { placement:number } | { eliminated:true } | { advance:true }} Routing
 * @typedef {Object} BracketMatch
 * @property {string} id
 * @property {string} round
 * @property {number} bestOf
 * @property {SourceRef} a
 * @property {SourceRef} b
 * @property {Routing} winnerTo
 * @property {Routing} loserTo
 *
 * @typedef {{ rank:number, teamId:string, losses:number, eliminatedIn?:string }} Placement
 * @typedef {Object} SeriesRef   // a Series (CONTRACTS §9) + stage/match provenance
 */

import { simSeries } from '../match/matchSim.js';

/** Loss cap (elimination threshold) per bracket type. */
const LOSS_CAP = Object.freeze({ single: 1, double: 2, triple: 3, gsl6: 2 });

/**
 * Build the fixed bracket graph for a (bracketType, size) pair.
 *
 * @param {'single'|'double'|'triple'|'gsl6'} bracketType
 * @param {number} [size]
 * @returns {BracketMatch[]}
 */
export function buildTemplate(bracketType, size) {
  switch (bracketType) {
    case 'triple':
      requireSize(bracketType, size, 8);
      return tripleElim8();
    case 'double':
      requireSize(bracketType, size, 8);
      return doubleElim8();
    case 'gsl6':
      return gsl6();
    case 'single':
      return singleElim(size);
    default:
      throw new Error(`buildTemplate: unknown bracketType '${bracketType}'`);
  }
}

/** @param {string} t @param {number} size @param {number} want */
function requireSize(t, size, want) {
  if (size !== undefined && size !== want) {
    throw new Error(`buildTemplate('${t}'): size must be ${want}, got ${size}`);
  }
}

/* ---------------------------------------------------------------------------
 * 5a. triple / 8 — the Kickoff playoff (THE centerpiece).
 * Upper (loss 0->1), Middle (1->2), Lower (2->3). A team is eliminated only on
 * its 3rd loss, so final loss counts are exactly 1st:0, 2nd:1, 3rd:2, 4th:3.
 * Seeds 1..8 -> first-round pairings [1,8],[4,5],[3,6],[2,7] (all cross-group).
 * ------------------------------------------------------------------------- */
function tripleElim8() {
  return [
    // UPPER ----------------------------------------------------------------
    m('UQF1', 'Upper Quarterfinal', 3, { seed: 1 }, { seed: 8 },
      { to: 'USF1', slot: 'a' }, { to: 'MR1a', slot: 'a' }),
    m('UQF2', 'Upper Quarterfinal', 3, { seed: 4 }, { seed: 5 },
      { to: 'USF1', slot: 'b' }, { to: 'MR1a', slot: 'b' }),
    m('UQF3', 'Upper Quarterfinal', 3, { seed: 3 }, { seed: 6 },
      { to: 'USF2', slot: 'a' }, { to: 'MR1b', slot: 'a' }),
    m('UQF4', 'Upper Quarterfinal', 3, { seed: 2 }, { seed: 7 },
      { to: 'USF2', slot: 'b' }, { to: 'MR1b', slot: 'b' }),
    m('USF1', 'Upper Semifinal', 3, { winnerOf: 'UQF1' }, { winnerOf: 'UQF2' },
      { to: 'UF', slot: 'a' }, { to: 'MR2a', slot: 'b' }),
    m('USF2', 'Upper Semifinal', 3, { winnerOf: 'UQF3' }, { winnerOf: 'UQF4' },
      { to: 'UF', slot: 'b' }, { to: 'MR2b', slot: 'b' }),
    m('UF', 'Upper Final', 3, { winnerOf: 'USF1' }, { winnerOf: 'USF2' },
      { placement: 1 }, { to: 'MF', slot: 'b' }),

    // MIDDLE ---------------------------------------------------------------
    m('MR1a', 'Middle Round 1', 3, { loserOf: 'UQF1' }, { loserOf: 'UQF2' },
      { to: 'MR2a', slot: 'a' }, { to: 'LR1', slot: 'a' }),
    m('MR1b', 'Middle Round 1', 3, { loserOf: 'UQF3' }, { loserOf: 'UQF4' },
      { to: 'MR2b', slot: 'a' }, { to: 'LR1', slot: 'b' }),
    m('MR2a', 'Middle Round 2', 3, { winnerOf: 'MR1a' }, { loserOf: 'USF1' },
      { to: 'MR3', slot: 'a' }, { to: 'LR2', slot: 'b' }),
    m('MR2b', 'Middle Round 2', 3, { winnerOf: 'MR1b' }, { loserOf: 'USF2' },
      { to: 'MR3', slot: 'b' }, { to: 'LR3', slot: 'b' }),
    m('MR3', 'Middle Round 3', 3, { winnerOf: 'MR2a' }, { winnerOf: 'MR2b' },
      { to: 'MF', slot: 'a' }, { to: 'LR4', slot: 'b' }),
    m('MF', 'Middle Final', 3, { winnerOf: 'MR3' }, { loserOf: 'UF' },
      { placement: 2 }, { to: 'LF', slot: 'b' }),

    // LOWER (loss 2->3); LF is the series final (Bo5) ----------------------
    m('LR1', 'Lower Round 1', 3, { loserOf: 'MR1a' }, { loserOf: 'MR1b' },
      { to: 'LR2', slot: 'a' }, { eliminated: true }),
    m('LR2', 'Lower Round 2', 3, { winnerOf: 'LR1' }, { loserOf: 'MR2a' },
      { to: 'LR3', slot: 'a' }, { eliminated: true }),
    m('LR3', 'Lower Round 3', 3, { winnerOf: 'LR2' }, { loserOf: 'MR2b' },
      { to: 'LR4', slot: 'a' }, { eliminated: true }),
    m('LR4', 'Lower Round 4', 3, { winnerOf: 'LR3' }, { loserOf: 'MR3' },
      { to: 'LF', slot: 'a' }, { eliminated: true }),
    m('LF', 'Lower Final', 5, { winnerOf: 'LR4' }, { loserOf: 'MF' },
      { placement: 3 }, { placement: 4 })
  ];
}

/* ---------------------------------------------------------------------------
 * 5b. double / 8 — standard 8-team double elimination (GF Bo5). Loss cap 2.
 * Placements: 1=GF win, 2=GF loss, 3=LF loss, 4=LR4 loss, 5/6=LR2 losers,
 * 7/8=LR1 losers (by elimination round).
 * ------------------------------------------------------------------------- */
function doubleElim8() {
  return [
    // UPPER
    m('UQF1', 'Upper Quarterfinal', 3, { seed: 1 }, { seed: 8 },
      { to: 'USF1', slot: 'a' }, { to: 'LR1a', slot: 'a' }),
    m('UQF2', 'Upper Quarterfinal', 3, { seed: 4 }, { seed: 5 },
      { to: 'USF1', slot: 'b' }, { to: 'LR1a', slot: 'b' }),
    m('UQF3', 'Upper Quarterfinal', 3, { seed: 3 }, { seed: 6 },
      { to: 'USF2', slot: 'a' }, { to: 'LR1b', slot: 'a' }),
    m('UQF4', 'Upper Quarterfinal', 3, { seed: 2 }, { seed: 7 },
      { to: 'USF2', slot: 'b' }, { to: 'LR1b', slot: 'b' }),
    m('USF1', 'Upper Semifinal', 3, { winnerOf: 'UQF1' }, { winnerOf: 'UQF2' },
      { to: 'UF', slot: 'a' }, { to: 'LR2b', slot: 'b' }),
    m('USF2', 'Upper Semifinal', 3, { winnerOf: 'UQF3' }, { winnerOf: 'UQF4' },
      { to: 'UF', slot: 'b' }, { to: 'LR2a', slot: 'b' }),
    m('UF', 'Upper Final', 3, { winnerOf: 'USF1' }, { winnerOf: 'USF2' },
      { to: 'GF', slot: 'a' }, { to: 'LR4', slot: 'b' }),

    // LOWER
    m('LR1a', 'Lower Round 1', 3, { loserOf: 'UQF1' }, { loserOf: 'UQF2' },
      { to: 'LR2a', slot: 'a' }, { eliminated: true }),
    m('LR1b', 'Lower Round 1', 3, { loserOf: 'UQF3' }, { loserOf: 'UQF4' },
      { to: 'LR2b', slot: 'a' }, { eliminated: true }),
    m('LR2a', 'Lower Round 2', 3, { winnerOf: 'LR1a' }, { loserOf: 'USF2' },
      { to: 'LR3', slot: 'a' }, { eliminated: true }),
    m('LR2b', 'Lower Round 2', 3, { winnerOf: 'LR1b' }, { loserOf: 'USF1' },
      { to: 'LR3', slot: 'b' }, { eliminated: true }),
    m('LR3', 'Lower Round 3', 3, { winnerOf: 'LR2a' }, { winnerOf: 'LR2b' },
      { to: 'LR4', slot: 'a' }, { eliminated: true }),
    m('LR4', 'Lower Round 4', 3, { winnerOf: 'LR3' }, { loserOf: 'UF' },
      { to: 'GF', slot: 'b' }, { eliminated: true }),
    m('GF', 'Grand Final', 5, { winnerOf: 'UF' }, { winnerOf: 'LR4' },
      { placement: 1 }, { placement: 2 })
  ];
}

/* ---------------------------------------------------------------------------
 * 5c. gsl6 — 6-team GSL double-elim group; EXACTLY 4 advance, 2 eliminated.
 * Loss cap 2. Seeds 1,2 bye into M3,M4.
 *   M1: seed3 vs seed6    winner->M4.b   loser->LBb.a   (opening)
 *   M2: seed4 vs seed5    winner->M3.b   loser->LBa.a   (opening)
 *   M3: seed1 vs W(M2)    winner->UF.a   loser->LBa.b   (winners)
 *   M4: seed2 vs W(M1)    winner->UF.b   loser->LBb.b   (winners)
 *   UF: W(M3) vs W(M4)    winner->{advance:1}  loser->{advance:2}   (0/1 loss)
 *   LBa: L(M2) vs L(M3)   winner->{advance:3}  loser->{eliminated}  (rank 5/6)
 *   LBb: L(M1) vs L(M4)   winner->{advance:4}  loser->{eliminated}  (rank 5/6)
 *
 * The four 1-loss droppers are split into TWO independent decider matches, each
 * sending its winner to advance (still 1 loss) and its loser home (2 losses).
 * Net: exactly 4 advancers (each ≤1 loss), exactly 2 eliminated (each exactly 2
 * losses). The loss cap (2) is never exceeded.
 * ------------------------------------------------------------------------- */
function gsl6() {
  return [
    m('M1', 'Opening', 3, { seed: 3 }, { seed: 6 },
      { to: 'M4', slot: 'b' }, { to: 'LBb', slot: 'a' }),
    m('M2', 'Opening', 3, { seed: 4 }, { seed: 5 },
      { to: 'M3', slot: 'b' }, { to: 'LBa', slot: 'a' }),
    m('M3', 'Winners', 3, { seed: 1 }, { winnerOf: 'M2' },
      { to: 'UF', slot: 'a' }, { to: 'LBa', slot: 'b' }),
    m('M4', 'Winners', 3, { seed: 2 }, { winnerOf: 'M1' },
      { to: 'UF', slot: 'b' }, { to: 'LBb', slot: 'b' }),
    m('UF', 'Upper Final', 3, { winnerOf: 'M3' }, { winnerOf: 'M4' },
      { advance: true }, { advance: true }),
    m('LBa', 'Decider A', 3, { loserOf: 'M2' }, { loserOf: 'M3' },
      { advance: true }, { eliminated: true }),
    m('LBb', 'Decider B', 3, { loserOf: 'M1' }, { loserOf: 'M4' },
      { advance: true }, { eliminated: true })
  ];
}

/* ---------------------------------------------------------------------------
 * 5d. single / N — generic single elimination (N a power of two). Loss cap 1.
 * Standard-seed bracket: seed i meets seed (size+1-i) in round 1, high seeds
 * kept apart. Losers are eliminated; the final winner is placement 1, the loser
 * placement 2.
 * ------------------------------------------------------------------------- */
function singleElim(size) {
  const n = size;
  if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`buildTemplate('single'): size must be a power of two >= 2, got ${size}`);
  }
  const rounds = Math.log2(n);
  /** @type {BracketMatch[]} */
  const out = [];

  // Round 1: standard seeding order.
  const order = standardSeedOrder(n); // 1-based seed numbers, paired sequentially
  let prevRoundIds = [];
  const r1Count = n / 2;
  for (let i = 0; i < r1Count; i++) {
    const id = `R1M${i + 1}`;
    out.push(m(id, 'Round 1', 3, { seed: order[2 * i] }, { seed: order[2 * i + 1] },
      null, { eliminated: true }));
    prevRoundIds.push(id);
  }

  // Subsequent rounds: winners feed forward.
  for (let r = 2; r <= rounds; r++) {
    const count = prevRoundIds.length / 2;
    const nextIds = [];
    const isFinal = r === rounds;
    const roundName = isFinal ? 'Final' : `Round ${r}`;
    for (let i = 0; i < count; i++) {
      const id = isFinal ? 'FINAL' : `R${r}M${i + 1}`;
      const a = { winnerOf: prevRoundIds[2 * i] };
      const b = { winnerOf: prevRoundIds[2 * i + 1] };
      const winnerTo = isFinal ? { placement: 1 } : null;
      const loserTo = isFinal ? { placement: 2 } : { eliminated: true };
      out.push(m(id, roundName, 3, a, b, winnerTo, loserTo));
      nextIds.push(id);
    }
    prevRoundIds = nextIds;
  }

  // Patch round-1 / intermediate winnerTo routings now that the next round exists.
  for (let r = 1; r < rounds; r++) {
    const thisRound = out.filter((x) => x.round === (r === 1 ? 'Round 1' : `Round ${r}`));
    const nextRound = out.filter((x) =>
      x.round === (r + 1 === rounds ? 'Final' : `Round ${r + 1}`));
    for (let i = 0; i < thisRound.length; i++) {
      const target = nextRound[Math.floor(i / 2)];
      thisRound[i].winnerTo = { to: target.id, slot: i % 2 === 0 ? 'a' : 'b' };
    }
  }

  return out;
}

/** Standard single-elim seed order for size n (1-based seeds). */
function standardSeedOrder(n) {
  let seeds = [1, 2];
  while (seeds.length < n) {
    const m2 = seeds.length * 2 + 1;
    const next = [];
    for (const s of seeds) {
      next.push(s);
      next.push(m2 - s);
    }
    seeds = next;
  }
  return seeds;
}

/** BracketMatch constructor (fresh object). */
function m(id, round, bestOf, a, b, winnerTo, loserTo) {
  return { id, round, bestOf, a, b, winnerTo, loserTo };
}

/* ===========================================================================
 * Execution
 * ========================================================================= */

/**
 * Topologically resolve & simulate a bracket template.
 *
 * @param {BracketMatch[]} template     the fixed graph
 * @param {string[]} seedTeamIds        teamIds in seed order (index 0 = seed 1)
 * @param {Object} ctx
 *   { teamsById:Record<string,Team>, playersById:Record<string,Player>,
 *     stageId?:string, bracketType?:string }
 * @param {(matchId:string)=>number} makeSeed  deterministic series seed factory
 * @returns {{ placements:Placement[], series:Object[] }}
 */
export function simulateBracket(template, seedTeamIds, ctx, makeSeed) {
  if (!Array.isArray(template)) throw new Error('simulateBracket: template must be an array');
  if (!Array.isArray(seedTeamIds)) throw new Error('simulateBracket: seedTeamIds must be an array');
  if (!ctx || typeof makeSeed !== 'function') {
    throw new Error('simulateBracket: ctx and makeSeed(matchId) are required');
  }
  const teamsById = ctx.teamsById || {};
  const playersById = ctx.playersById || {};
  const stageId = ctx.stageId || 'bracket';
  const bracketType = ctx.bracketType || inferType(template);
  const lossCap = LOSS_CAP[bracketType] !== undefined ? LOSS_CAP[bracketType] : Infinity;

  const byId = new Map(template.map((mm) => [mm.id, mm]));

  /** matchId -> { winnerId, loserId } once played. */
  const outcome = new Map();
  /** matchId -> { a:teamId, b:teamId } as slots fill in. */
  const slots = new Map();
  /** teamId -> loss count. */
  const losses = new Map();
  /** Placement assignments collected from routings. */
  const placedByRank = new Map(); // rank -> teamId
  /** eliminated teamId -> matchId where eliminated (for rank-by-round). */
  const eliminatedIn = new Map();
  /** order in which eliminations happened, with their match for round ranking. */
  const eliminations = [];
  /** advancers, in advance order (advance:1 first). */
  const advancers = [];
  /** @type {Object[]} */
  const series = [];

  for (const id of byId.keys()) slots.set(id, { a: undefined, b: undefined });
  for (const tid of seedTeamIds) losses.set(tid, 0);

  /** Resolve a SourceRef to a concrete teamId, or undefined if not ready. */
  const resolveRef = (ref) => {
    if (!ref) return undefined;
    if (ref.seed !== undefined) {
      const t = seedTeamIds[ref.seed - 1];
      if (t === undefined) throw new Error(`simulateBracket: seed ${ref.seed} has no team`);
      return t;
    }
    if (ref.entrant !== undefined) return ref.entrant;
    if (ref.winnerOf !== undefined) {
      const o = outcome.get(ref.winnerOf);
      return o ? o.winnerId : undefined;
    }
    if (ref.loserOf !== undefined) {
      const o = outcome.get(ref.loserOf);
      return o ? o.loserId : undefined;
    }
    throw new Error(`simulateBracket: unrecognised SourceRef ${JSON.stringify(ref)}`);
  };

  /** Apply a routing for a resolved teamId. */
  const applyRouting = (routing, teamId, fromMatchId) => {
    if (!routing) {
      throw new Error(`simulateBracket: match '${fromMatchId}' missing a routing`);
    }
    if (routing.to !== undefined) {
      const s = slots.get(routing.to);
      if (!s) throw new Error(`simulateBracket: routing target '${routing.to}' not in template`);
      if (s[routing.slot] !== undefined && s[routing.slot] !== teamId) {
        throw new Error(`simulateBracket: slot '${routing.to}.${routing.slot}' double-booked`);
      }
      s[routing.slot] = teamId;
      return;
    }
    if (routing.placement !== undefined) {
      if (placedByRank.has(routing.placement)) {
        throw new Error(`simulateBracket: placement ${routing.placement} assigned twice`);
      }
      placedByRank.set(routing.placement, teamId);
      return;
    }
    if (routing.eliminated === true) {
      eliminatedIn.set(teamId, fromMatchId);
      eliminations.push({ teamId, matchId: fromMatchId });
      return;
    }
    if (routing.advance === true) {
      advancers.push(teamId);
      return;
    }
    throw new Error(`simulateBracket: unrecognised Routing ${JSON.stringify(routing)}`);
  };

  // Topological loop: keep playing any ready, unplayed match until none remain.
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const match of template) {
      if (outcome.has(match.id)) continue;

      const slot = slots.get(match.id);
      // Seed-based slots are resolvable immediately; winner/loser slots fill via routing.
      const aId = slot.a !== undefined ? slot.a : resolveRef(match.a);
      const bId = slot.b !== undefined ? slot.b : resolveRef(match.b);
      if (aId === undefined || bId === undefined) continue;
      if (aId === bId) {
        throw new Error(`simulateBracket: match '${match.id}' has identical teams (${aId})`);
      }

      const teamA = teamsById[aId];
      const teamB = teamsById[bId];
      if (!teamA || !teamB) {
        throw new Error(`simulateBracket: missing Team object for '${!teamA ? aId : bId}'`);
      }

      const s = simSeries(teamA, teamB, playersById, match.bestOf, makeSeed(match.id));
      const winnerId = s.winnerId;
      const loserId = winnerId === aId ? bId : aId;

      series.push(Object.assign({}, s, { stageId, matchId: match.id }));
      outcome.set(match.id, { winnerId, loserId });

      // Loss counter + cap assertion.
      const nextLoss = (losses.get(loserId) || 0) + 1;
      losses.set(loserId, nextLoss);
      if (nextLoss > lossCap) {
        throw new Error(
          `simulateBracket: loss cap ${lossCap} exceeded — '${loserId}' reached ${nextLoss} losses at '${match.id}'`);
      }

      applyRouting(match.winnerTo, winnerId, match.id);
      applyRouting(match.loserTo, loserId, match.id);
      progressed = true;
    }
  }

  // Every match must have resolved.
  if (outcome.size !== template.length) {
    const stuck = template.filter((x) => !outcome.has(x.id)).map((x) => x.id);
    throw new Error(`simulateBracket: bracket did not fully resolve; stuck on [${stuck.join(', ')}]`);
  }

  // Rank eliminated teams by elimination round: later round => better rank.
  // eliminations are pushed in chronological order; topo order roughly follows
  // rounds, but we rank explicitly by the round depth of the match they lost.
  const roundDepth = computeRoundDepth(template);
  const elimSorted = eliminations
    .slice()
    .sort((x, y) => roundDepth.get(y.matchId) - roundDepth.get(x.matchId));

  // Assemble placements, in this rank order:
  //   1) explicit {placement:n} routings (sorted by n),
  //   2) advancers that have no explicit placement, in advance order (gsl6),
  //   3) eliminated teams, deepest elimination round first (later round = better).
  const explicitRanks = [...placedByRank.keys()].sort((p, q) => p - q);
  const placedTeamSet = new Set(placedByRank.values());
  const placements = [];
  for (const rank of explicitRanks) {
    const teamId = placedByRank.get(rank);
    placements.push(placement(rank, teamId, losses.get(teamId) || 0, eliminatedIn.get(teamId)));
  }
  let nextRank = (explicitRanks.length ? Math.max(...explicitRanks) : 0) + 1;
  for (const teamId of advancers) {
    if (placedTeamSet.has(teamId)) continue;
    placements.push(placement(nextRank++, teamId, losses.get(teamId) || 0, undefined));
  }
  for (const { teamId } of elimSorted) {
    if (placedTeamSet.has(teamId)) continue;
    placements.push(placement(nextRank++, teamId, losses.get(teamId) || 0, eliminatedIn.get(teamId)));
  }

  // --- triple/8 loss invariant (CRITICAL) ---------------------------------
  if (bracketType === 'triple') {
    assertTripleInvariant(placements);
  }

  return {
    placements: placements.map((p) => Object.freeze({ ...p })),
    series,
    advancers: advancers.slice()
  };
}

/** Placement constructor. */
function placement(rank, teamId, lossCount, elimIn) {
  const p = { rank, teamId, losses: lossCount };
  if (elimIn) p.eliminatedIn = elimIn;
  return p;
}

/**
 * The CRITICAL triple-elim invariant: placement 1 has 0 losses, 2 has 1, 3 has 2,
 * 4 has 3, and every eliminated team (ranks 5-8) has exactly 3 losses.
 * @param {Placement[]} placements
 */
function assertTripleInvariant(placements) {
  const want = { 1: 0, 2: 1, 3: 2, 4: 3 };
  for (const p of placements) {
    if (want[p.rank] !== undefined) {
      if (p.losses !== want[p.rank]) {
        throw new Error(
          `triple-elim invariant violated: placement ${p.rank} (${p.teamId}) has ${p.losses} losses, expected ${want[p.rank]}`);
      }
    } else if (p.rank >= 5) {
      if (p.losses !== 3) {
        throw new Error(
          `triple-elim invariant violated: eliminated placement ${p.rank} (${p.teamId}) has ${p.losses} losses, expected 3`);
      }
    }
  }
}

/**
 * Compute a round-depth integer per match (longest predecessor chain), so that
 * eliminated teams from deeper (later) matches get better ranks.
 * @param {BracketMatch[]} template
 * @returns {Map<string, number>}
 */
function computeRoundDepth(template) {
  const byId = new Map(template.map((mm) => [mm.id, mm]));
  const depth = new Map();
  const deps = (ref) => (ref && (ref.winnerOf || ref.loserOf)) || null;
  const visit = (id, seen) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0; // defensive (no cycles expected)
    seen.add(id);
    const mm = byId.get(id);
    if (!mm) return 0;
    const da = deps(mm.a);
    const db = deps(mm.b);
    const d = 1 + Math.max(da ? visit(da, seen) : 0, db ? visit(db, seen) : 0);
    depth.set(id, d);
    seen.delete(id);
    return d;
  };
  for (const mm of template) visit(mm.id, new Set());
  return depth;
}

/** Best-effort bracket-type inference from a template (for standalone use). */
function inferType(template) {
  const ids = new Set(template.map((x) => x.id));
  if (ids.has('LF') && ids.has('MF') && ids.has('UF')) return 'triple';
  if (ids.has('GF')) return 'double';
  if (ids.has('LBa') && ids.has('LBb') && ids.has('UF')) return 'gsl6';
  return 'single';
}

/* ===========================================================================
 * Stage-kind entry point
 * ========================================================================= */

/**
 * Run a bracket stage and return a StageResult (CONTRACTS-FORMAT §1, §4).
 *
 * @param {Object} stage   StageDescriptor; uses stage.bracketType, stage.id,
 *                         stage.seriesLen, stage.advancersOut, optional stage.size.
 * @param {string[]} entrants  teamIds seeded (index 0 = seed 1).
 * @param {Object} ctx     { teamsById, playersById, ... }
 * @param {(matchId:string)=>number} makeSeed
 * @param {import('../../core/rng.js').Rng} [rng]  unused here (no in-stage randomness).
 * @returns {Object} StageResult
 */
export function run(stage, entrants, ctx, makeSeed, rng) {
  if (!stage || typeof stage !== 'object') throw new Error('bracket.run: stage required');
  const bracketType = stage.bracketType;
  if (!bracketType) throw new Error('bracket.run: stage.bracketType required');
  const stageId = stage.id || 'bracket';
  const size = stage.size !== undefined ? stage.size : entrants.length;

  const template = applySeriesLen(buildTemplate(bracketType, size), stage.seriesLen);

  const result = simulateBracket(template, entrants, {
    teamsById: ctx.teamsById,
    playersById: ctx.playersById,
    stageId,
    bracketType
  }, makeSeed);

  // Standings derived from placements (rank order already encodes loss-order).
  const standings = result.placements.map((p) => {
    const rec = recordFor(p.teamId, result.series);
    return {
      teamId: p.teamId,
      rank: p.rank,
      w: rec.w,
      l: rec.l,
      mapW: rec.mapW,
      mapL: rec.mapL,
      roundDiff: rec.roundDiff
    };
  });

  // Advancers: gsl6 -> the 4 advancers in rank order; others -> top advancersOut by rank.
  let advancers;
  const advancersOut =
    stage.advancersOut !== undefined
      ? stage.advancersOut
      : bracketType === 'gsl6'
        ? 4
        : 0;
  if (bracketType === 'gsl6') {
    // advancers were collected in advance order; re-rank them by placement rank.
    const advSet = new Set(result.advancers);
    advancers = standings
      .filter((s) => advSet.has(s.teamId))
      .slice(0, advancersOut)
      .map((s) => s.teamId);
  } else {
    advancers = standings.slice(0, advancersOut).map((s) => s.teamId);
  }

  return {
    stageId,
    kind: 'bracket',
    standings,
    // Placements carry per-team loss counts + eliminatedIn provenance straight
    // from the bracket; formatEngine prefers these for the deciding stage so the
    // final EventResult preserves eliminatedIn (CONTRACTS-FORMAT §1, §6).
    placements: result.placements,
    advancers,
    series: result.series
  };
}

/**
 * Overlay a stage's seriesLen ({ default, final? }) onto a template: every match
 * gets seriesLen.default, and any match already marked as a final (bestOf 5 in
 * the template, i.e. the bracket/grand/lower final) gets seriesLen.final.
 * @param {BracketMatch[]} template
 * @param {{ default?:number, final?:number }} [seriesLen]
 * @returns {BracketMatch[]}
 */
function applySeriesLen(template, seriesLen) {
  if (!seriesLen) return template;
  const def = seriesLen.default;
  const fin = seriesLen.final;
  return template.map((mm) => {
    let bestOf = mm.bestOf;
    if (def !== undefined) bestOf = def;
    if (fin !== undefined && mm.bestOf === 5) bestOf = fin; // template-marked finals
    return Object.assign({}, mm, { bestOf });
  });
}

/** Per-team series/map/round record across a list of SeriesRefs. */
function recordFor(teamId, series) {
  let w = 0, l = 0, mapW = 0, mapL = 0, roundDiff = 0;
  for (const s of series) {
    const isA = s.teamAId === teamId;
    const isB = s.teamBId === teamId;
    if (!isA && !isB) continue;
    if (s.winnerId === teamId) w += 1;
    else l += 1;
    const my = isA ? s.score.A : s.score.B;
    const opp = isA ? s.score.B : s.score.A;
    mapW += my;
    mapL += opp;
    for (const mp of s.maps || []) {
      // MapResult.score = { A, B } round counts on the map.
      if (mp && mp.score && typeof mp.score.A === 'number') {
        const rw = isA ? mp.score.A : mp.score.B;
        const rl = isA ? mp.score.B : mp.score.A;
        roundDiff += rw - rl;
      }
    }
  }
  return { w, l, mapW, mapL, roundDiff };
}
