/**
 * engine/match/veto.js — map veto / pick-ban sequence (CONTRACTS §10).
 *
 * `runVeto(teamA, teamB, players, bestOf, rng)` executes the standard
 * Valorant veto over the active MAP_POOL:
 *   - Bo3: ban, ban, pick, pick, ban, ban, decider
 *   - Bo5: ban, ban, pick, pick, pick, pick, decider
 * Teams alternate, starting with team A. Each step a team acts on the map where
 * its roster's average map proficiency is most favorable to its intent:
 *   - on a BAN it removes the remaining map where its roster is WEAKEST (low avg
 *     proficiency), to deny maps it is bad at,
 *   - on a PICK it selects the remaining map where its roster is STRONGEST (high
 *     avg proficiency), to play to its strengths,
 *   - the final leftover map is the DECIDER.
 * Ties are broken via the injected `rng` (rng.weightedPick), so the choice is
 * deterministic for a fixed seed but not biased by map order.
 *
 * Returns { mapsToPlay, picks } where:
 *   - `picks` lists every PICK and the DECIDER in play order, each tagged by who
 *     selected it ('A' | 'B' | 'decider'),
 *   - `mapsToPlay` is the full set of maps that *could* be played, in play order,
 *     with length === bestOf (picks first in selection order, decider in the
 *     middle slot, mirrored so a Bo3 reads pickA, pickB, decider).
 *
 * Pure & dependency-free apart from the map reference data; runs unchanged in
 * Node and the browser (plain ES modules). Every returned object/array is fresh
 * (immutable engine output). No Math.random / Date.now / DOM — all randomness
 * via the injected Rng.
 *
 * @typedef {import('../../domain/player.js').Player} Player
 * @typedef {import('../../core/rng.js').Rng} Rng
 * @typedef {{ roster?: string[] }} Team
 * @typedef {{ mapId:string, by:('A'|'B'|'decider') }} VetoPick
 * @typedef {{ mapsToPlay:string[], picks:VetoPick[] }} VetoResult
 */

import { MAP_POOL } from '../../config/maps.js';

/** Veto-domain constants (single source of veto-shape defaults). */
const VETO = Object.freeze({
  // Baseline used when a player's map proficiency entry is absent (mirrors the
  // domain layer's PROFICIENCY_BASELINE: a missing key means "average").
  PROFICIENCY_BASELINE: 50,

  // Sharpness applied to the (normalized) per-map affinity before it becomes a
  // weighted-pick weight. >1 makes a clearly stronger/weaker map dominate the
  // tie-break draw while still letting rng decide between near-equal maps.
  WEIGHT_EXPONENT: 6,

  // Floor added to every candidate weight so rng.weightedPick is always
  // well-defined even if every remaining map scores identically.
  WEIGHT_FLOOR: 1
});

/**
 * Standard veto step sequences keyed by series length. Each entry is an action
 * ('ban' | 'pick') performed by the team whose turn it is; teams alternate
 * starting with A. The leftover map after all steps is the decider.
 * @type {Record<number, ReadonlyArray<'ban'|'pick'>>}
 */
const SEQUENCES = Object.freeze({
  1: Object.freeze(['ban', 'ban', 'ban', 'ban', 'ban', 'ban']), // Bo1: ban down to one
  3: Object.freeze(['ban', 'ban', 'pick', 'pick', 'ban', 'ban']), // Bo3 → decider
  5: Object.freeze(['ban', 'ban', 'pick', 'pick', 'pick', 'pick']) // Bo5 → decider
});

/**
 * Resolve a team's active roster into Player objects from the lookup. Only ids
 * present in `players` contribute; an empty/sparse roster simply yields a
 * shorter list (every map then scores the baseline, so picks fall to rng).
 * @param {Team} team
 * @param {Record<string, Player>} players
 * @returns {Player[]}
 */
function rosterOf(team, players) {
  const roster = team && Array.isArray(team.roster) ? team.roster : [];
  /** @type {Player[]} */
  const out = [];
  for (const id of roster) {
    const p = players && players[id];
    if (p && typeof p === 'object') out.push(p);
  }
  return out;
}

/**
 * Average map proficiency of a roster for one map, treating any missing entry as
 * the baseline. Returns the baseline for an empty roster so maps stay neutral.
 * @param {Player[]} roster
 * @param {string} mapId
 * @returns {number} 0..100
 */
function avgMapProficiency(roster, mapId) {
  if (roster.length === 0) return VETO.PROFICIENCY_BASELINE;
  let sum = 0;
  for (const p of roster) {
    const maps = p && p.proficiency && p.proficiency.maps;
    const v = maps && typeof maps[mapId] === 'number' && Number.isFinite(maps[mapId])
      ? maps[mapId]
      : VETO.PROFICIENCY_BASELINE;
    sum += v;
  }
  return sum / roster.length;
}

/**
 * Turn a roster's per-map average proficiency into a positive selection weight.
 * `favorHigh` true ⇒ prefer high-proficiency maps (picks); false ⇒ prefer
 * low-proficiency maps (bans). The score is normalized to [0,1], inverted for
 * bans, sharpened by WEIGHT_EXPONENT, and floored so it is always > 0.
 * @param {number} avg       roster average proficiency for the map (0..100)
 * @param {boolean} favorHigh
 * @returns {number} weight > 0
 */
function mapWeight(avg, favorHigh) {
  const norm = Math.max(0, Math.min(1, avg / 100));
  const oriented = favorHigh ? norm : 1 - norm;
  return Math.pow(oriented, VETO.WEIGHT_EXPONENT) * 100 + VETO.WEIGHT_FLOOR;
}

/**
 * Choose one map from `remaining` for an acting team. On a 'pick' the team
 * favors its strongest map; on a 'ban' it favors removing its weakest. The pick
 * is weighted by roster average map proficiency with rng tie-breaking.
 * @param {string[]} remaining   map ids still available
 * @param {Player[]} roster      acting team's roster
 * @param {'ban'|'pick'} action
 * @param {Rng} rng
 * @returns {string} chosen map id (always a member of `remaining`)
 */
function chooseMap(remaining, roster, action, rng) {
  const favorHigh = action === 'pick';
  return rng.weightedPick(remaining, (mapId) =>
    mapWeight(avgMapProficiency(roster, mapId), favorHigh)
  );
}

/**
 * Execute the standard veto for a series.
 *
 * @param {Team} teamA   first-acting team (its first roster ids form the lineup).
 * @param {Team} teamB   second-acting team.
 * @param {Record<string, Player>} players  playerId -> Player lookup.
 * @param {number} bestOf  series length (1, 3 or 5); others fall back to Bo3.
 * @param {Rng} rng        injected deterministic PRNG.
 * @returns {VetoResult} { mapsToPlay (length === bestOf, play order), picks }.
 */
export function runVeto(teamA, teamB, players, bestOf, rng) {
  const rosterA = rosterOf(teamA, players);
  const rosterB = rosterOf(teamB, players);
  const sequence = SEQUENCES[bestOf] || SEQUENCES[3];

  // Working copy of the pool we whittle down; never mutate MAP_POOL.
  let remaining = MAP_POOL.slice();

  /** @type {{ mapId:string, by:'A'|'B' }[]} */
  const pickedInOrder = [];

  for (let step = 0; step < sequence.length && remaining.length > 1; step++) {
    const action = sequence[step];
    const isA = step % 2 === 0;
    const roster = isA ? rosterA : rosterB;
    const by = isA ? 'A' : 'B';

    const chosen = chooseMap(remaining, roster, action, rng);
    remaining = remaining.filter((m) => m !== chosen);

    if (action === 'pick') pickedInOrder.push({ mapId: chosen, by });
  }

  // Whatever survives the sequence is the decider (the standard veto always
  // leaves exactly one; for Bo1 the loop bans down to one and there are no picks).
  const decider = remaining.length > 0 ? remaining[0] : null;

  /** @type {VetoPick[]} */
  const picks = pickedInOrder.map((p) => ({ mapId: p.mapId, by: p.by }));

  // Build play order: picks in selection order, the decider slotted in the middle
  // (after both teams' picks for a Bo3 → [pickA, pickB, decider]; for Bo5 the
  // decider is the last/5th map). Then truncate/define to exactly `bestOf`.
  /** @type {string[]} */
  const mapsToPlay = pickedInOrder.map((p) => p.mapId);
  if (decider != null) {
    picks.push({ mapId: decider, by: 'decider' });
    mapsToPlay.push(decider);
  }

  // Guarantee length === bestOf. The standard sequences already yield exactly
  // bestOf maps (Bo1:1, Bo3:3, Bo5:5); this is a defensive normalization so an
  // unusual pool size never violates the contract.
  return { mapsToPlay: normalizeLength(mapsToPlay, bestOf), picks };
}

/**
 * Ensure the play list has exactly `n` entries: truncate extras, or pad from the
 * already-chosen maps (cycling) if somehow short. Returns a fresh array.
 * @param {string[]} maps
 * @param {number} n
 * @returns {string[]}
 */
function normalizeLength(maps, n) {
  const target = Number.isInteger(n) && n > 0 ? n : maps.length;
  if (maps.length === target) return maps.slice();
  if (maps.length > target) return maps.slice(0, target);
  const out = maps.slice();
  let i = 0;
  while (out.length < target && maps.length > 0) {
    out.push(maps[i % maps.length]);
    i++;
  }
  return out;
}
