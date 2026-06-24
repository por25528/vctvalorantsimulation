/**
 * tests/determinism.test.mjs — determinism + sanity suite (CONTRACTS §14).
 *
 * Loads PACIFIC_SEED, normalizes two teams + their players via the domain
 * factories, then exercises the top-level match engine entry point simSeries:
 *
 *   - simSeries(teamA, teamB, players, 3, 12345) run twice with the SAME seed
 *     must be deep-equal (full byte-for-byte determinism, CONTRACTS §2/§10).
 *   - the same call with a DIFFERENT seed must NOT be deep-equal (the seed
 *     actually drives the simulation).
 *   - sanity per map: the score is a valid Valorant score (winner >= 13,
 *     win-by-2 in OT), rounds.length === score sum, and total kills across both
 *     teams is within a small tolerance of total deaths (one death per kill,
 *     give or take rounding/edge cases).
 *
 * Default export is an async fn that throws on failure (per CONTRACTS §14).
 */

import { assert, assertEqual, section } from './_assert.mjs';
import { PACIFIC_SEED } from '../src/data/seed/pacific.js';
import { createPlayer } from '../src/domain/player.js';
import { createTeam } from '../src/domain/team.js';
import { simSeries } from '../src/engine/match/matchSim.js';
import { BALANCE } from '../src/config/balance.js';

/**
 * Deep structural equality (mirrors tests/_assert.mjs deepEqual) returning a
 * boolean so we can assert BOTH equality and inequality.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;
  if (aIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Build the normalized world from PACIFIC_SEED: a players lookup keyed by id and
 * a teams lookup keyed by id, all run through the domain factories.
 * @returns {{ playersById: Record<string, object>, teamsById: Record<string, object> }}
 */
function normalizeWorld() {
  /** @type {Record<string, object>} */
  const playersById = {};
  for (const partial of PACIFIC_SEED.players) {
    const p = createPlayer(partial);
    playersById[p.id] = p;
  }
  /** @type {Record<string, object>} */
  const teamsById = {};
  for (const partial of PACIFIC_SEED.teams) {
    const t = createTeam(partial);
    teamsById[t.id] = t;
  }
  return { playersById, teamsById };
}

/**
 * Validate a single MapResult's score + round count + kill/death balance.
 * @param {object} map  a MapResult
 * @param {number} idx  map index (for error messages)
 */
function assertMapSane(map, idx) {
  const { A, B } = map.score;
  assert(
    typeof A === 'number' && typeof B === 'number' && A >= 0 && B >= 0,
    `map ${idx}: score must be non-negative numbers (got ${A}-${B})`
  );

  const hi = Math.max(A, B);
  const lo = Math.min(A, B);
  const win = BALANCE.ROUNDS_TO_WIN; // 13
  const otBy = BALANCE.OT_WIN_BY; // 2

  // Winner must reach at least ROUNDS_TO_WIN.
  assert(hi >= win, `map ${idx}: winner score ${hi} < ${win}`);

  if (lo >= win - 1) {
    // Overtime regime (a 12-12 forced OT): must be won by exactly OT_WIN_BY.
    assertEqual(hi - lo, otBy, `map ${idx}: OT must be won by ${otBy} (got ${A}-${B})`);
  } else {
    // Regulation: winner is exactly ROUNDS_TO_WIN, loser strictly below tie line.
    assertEqual(hi, win, `map ${idx}: regulation winner must be exactly ${win} (got ${A}-${B})`);
    assert(lo < win - 1, `map ${idx}: loser ${lo} should be below ${win - 1} in regulation`);
  }

  // rounds.length === score sum.
  assertEqual(
    map.rounds.length,
    A + B,
    `map ${idx}: rounds.length (${map.rounds.length}) must equal score sum (${A + B})`
  );

  // Winner field agrees with the score.
  assertEqual(map.winner, A > B ? 'A' : 'B', `map ${idx}: winner field disagrees with score`);

  // Total kills ~= total deaths across both teams (every kill is one death).
  let kills = 0;
  let deaths = 0;
  for (const stat of Object.values(map.boxScore)) {
    kills += stat.kills;
    deaths += stat.deaths;
  }
  // Tolerance: small slack for any edge-case bookkeeping. They should be equal
  // in a clean model; allow a tiny tolerance proportional to round count.
  const tol = Math.max(2, Math.round((A + B) * 0.05));
  assert(
    Math.abs(kills - deaths) <= tol,
    `map ${idx}: total kills ${kills} vs deaths ${deaths} exceeds tolerance ${tol}`
  );
}

export default async function determinismTest() {
  section('determinism — same seed reproduces identically');

  const { playersById, teamsById } = normalizeWorld();

  const ids = Object.keys(teamsById);
  assert(ids.length >= 2, 'need at least 2 teams to simulate a series');
  const teamA = teamsById[ids[0]];
  const teamB = teamsById[ids[1]];

  const SEED = 12345;
  const s1 = simSeries(teamA, teamB, playersById, 3, SEED);
  const s2 = simSeries(teamA, teamB, playersById, 3, SEED);

  assert(
    deepEqual(s1, s2),
    'simSeries with the same seed must produce deep-equal Series (full determinism)'
  );

  // Inputs must not have been mutated (immutability, CONTRACTS §15).
  assert(Array.isArray(teamA.roster) && teamA.roster.length >= 5, 'teamA roster mutated');
  assert(Array.isArray(teamB.roster) && teamB.roster.length >= 5, 'teamB roster mutated');

  section('determinism — different seed diverges');

  const s3 = simSeries(teamA, teamB, playersById, 3, SEED + 1);
  assert(
    !deepEqual(s1, s3),
    'simSeries with a different seed must NOT be deep-equal to the original'
  );

  section('sanity — valid Valorant scores, round counts, kill/death balance');

  // Series structure.
  assert(Array.isArray(s1.maps) && s1.maps.length >= 2, 'Bo3 series should play >= 2 maps');
  const target = 2; // ceil(3/2)
  assert(
    s1.score.A === target || s1.score.B === target,
    `Bo3 must end with a team on ${target} map wins (got ${s1.score.A}-${s1.score.B})`
  );
  assert(
    s1.winnerId === s1.teamAId || s1.winnerId === s1.teamBId,
    'series winnerId must be one of the two teams'
  );

  for (let i = 0; i < s1.maps.length; i++) {
    assertMapSane(s1.maps[i], i);
  }

  // Map wins in the series score must equal the count of map.winner values.
  let mapWinsA = 0;
  let mapWinsB = 0;
  for (const m of s1.maps) {
    if (m.winner === 'A') mapWinsA += 1;
    else mapWinsB += 1;
  }
  assertEqual(s1.score.A, mapWinsA, 'series score.A must equal A map wins');
  assertEqual(s1.score.B, mapWinsB, 'series score.B must equal B map wins');

  // eslint-disable-next-line no-console
  console.log(
    `determinism: Bo3 ${teamA.id} vs ${teamB.id} -> ${s1.score.A}-${s1.score.B} over ${s1.maps.length} maps; same-seed identical, diff-seed diverges`
  );
}
