/**
 * engine/career/traits.js — player traits & personalities (P12.3).
 *
 * PURE. A trait is a string id on `player.traits`. Traits influence three places,
 * each a small DETERMINISTIC modifier (no new rng draws in-match):
 *   - duels   (traitDuelMod): clutch/bigGame/choker/slowStarter/fastStarter react
 *             to the moment (last-alive, overtime, opening rounds).
 *   - growth  (traitDevMod): workhorse/consistent/volatile/earlyPeak/latePeak shape
 *             the development curve.
 *   - chemistry (teamTraitChem): mentor/leader lift a roster, hothead drags it.
 *
 * Constants from BALANCE.CAREER.TRAITS. The registry doubles as the UI source of
 * truth (label + whether the trait is hidden until scouted).
 */

import { BALANCE } from '../../config/balance.js';

const T = BALANCE.CAREER.TRAITS;

/**
 * Canonical trait registry. `kind` groups the effect; `hidden` traits are not
 * shown on a card until revealed (handled by the UI/scouting layer).
 * @type {Readonly<Record<string,{label:string, kind:'duel'|'dev'|'chem', hidden:boolean, blurb:string}>>}
 */
export const TRAIT_DEFS = Object.freeze({
  clutch: { label: 'Clutch', kind: 'duel', hidden: false, blurb: 'Ice in the veins when last alive.' },
  bigGame: { label: 'Big-Game Player', kind: 'duel', hidden: false, blurb: 'Rises to the occasion in overtime.' },
  choker: { label: 'Choker', kind: 'duel', hidden: true, blurb: 'Tightens up when it matters most.' },
  fastStarter: { label: 'Fast Starter', kind: 'duel', hidden: false, blurb: 'Comes out of the gate firing.' },
  slowStarter: { label: 'Slow Starter', kind: 'duel', hidden: true, blurb: 'Takes a few rounds to warm up.' },
  workhorse: { label: 'Workhorse', kind: 'dev', hidden: false, blurb: 'Outworks everyone in practice.' },
  consistent: { label: 'Consistent', kind: 'dev', hidden: false, blurb: 'Develops steadily, rarely a bad year.' },
  volatile: { label: 'Volatile', kind: 'dev', hidden: true, blurb: 'Boom-or-bust from season to season.' },
  earlyPeak: { label: 'Early Peak', kind: 'dev', hidden: true, blurb: 'Burns bright early, fades sooner.' },
  latePeak: { label: 'Iron Lungs', kind: 'dev', hidden: true, blurb: 'A long, late-blooming prime.' },
  mentor: { label: 'Mentor', kind: 'chem', hidden: false, blurb: 'Brings young teammates along.' },
  leader: { label: 'Leader', kind: 'chem', hidden: false, blurb: 'Binds a roster together.' },
  hothead: { label: 'Hothead', kind: 'chem', hidden: true, blurb: 'Friction in the comms.' }
});

/** All trait ids (assignment pool). */
const ALL_TRAITS = Object.freeze(Object.keys(TRAIT_DEFS));

/** Overtime begins after regulation (2×(ROUNDS_TO_WIN−1) rounds). */
const OT_AFTER = 2 * (BALANCE.ROUNDS_TO_WIN - 1);
/** Opening window for fast/slow starters. */
const OPENING_ROUNDS = 3;

function has(player, id) {
  return player && Array.isArray(player.traits) && player.traits.includes(id);
}

/**
 * In-match duel multiplier from a player's traits + the round context. Default 1.
 * @param {object} player
 * @param {{ isClutch?:boolean, roundNo?:number }} ctx
 * @returns {number}
 */
export function traitDuelMod(player, ctx) {
  if (!player || !Array.isArray(player.traits) || player.traits.length === 0) return 1;
  const c = ctx || {};
  let m = 1;
  if (c.isClutch && has(player, 'clutch')) m *= 1 + T.CLUTCH_BONUS;
  const n = typeof c.roundNo === 'number' ? c.roundNo : 0;
  if (n > 0 && n <= OPENING_ROUNDS) {
    if (has(player, 'fastStarter')) m *= 1 + T.FASTSTARTER_BONUS;
    if (has(player, 'slowStarter')) m *= 1 - T.SLOWSTARTER_PENALTY;
  }
  if (n > OT_AFTER) {
    if (has(player, 'bigGame')) m *= 1 + T.BIGGAME_BONUS;
    if (has(player, 'choker')) m *= 1 - T.CHOKER_PENALTY;
  }
  return m > 0 ? m : 0;
}

/**
 * Development modifiers from a player's traits.
 * @param {object} player
 * @returns {{ growthMult:number, noiseMult:number, peakShift:number }}
 */
export function traitDevMod(player) {
  let growthMult = 1;
  let noiseMult = 1;
  let peakShift = 0;
  if (has(player, 'workhorse')) growthMult *= T.WORKHORSE_DEV_MULT;
  if (has(player, 'consistent')) noiseMult *= T.CONSISTENT_NOISE_MULT;
  if (has(player, 'volatile')) noiseMult *= T.VOLATILE_NOISE_MULT;
  if (has(player, 'earlyPeak')) peakShift += T.EARLY_PEAK_SHIFT;
  if (has(player, 'latePeak')) peakShift += T.LATE_PEAK_SHIFT;
  return { growthMult, noiseMult, peakShift };
}

/**
 * Flat team-chemistry delta (0..100 scale) from the starting five's chem traits.
 * @param {string[]} fivePlayers  player objects of the lineup
 * @returns {number}
 */
export function teamTraitChem(fivePlayers) {
  const five = Array.isArray(fivePlayers) ? fivePlayers : [];
  let delta = 0;
  for (const p of five) {
    if (has(p, 'mentor')) delta += T.MENTOR_CHEM;
    if (has(p, 'leader')) delta += T.LEADER_CHEM;
    if (has(p, 'hothead')) delta += T.HOTHEAD_CHEM;
  }
  return delta;
}

/**
 * Assign 0–2 traits to a newgen. Draws are appended at the END of the newgen's
 * rng sequence (deterministic; variable count is fine for reproducibility).
 * @param {import('../../core/rng.js').Rng} rng
 * @returns {string[]}
 */
export function assignTraitsForNewgen(rng) {
  const out = [];
  if (rng.chance(T.ASSIGN_CHANCE)) {
    out.push(rng.pick(ALL_TRAITS));
    if (rng.chance(T.ASSIGN_SECOND_CHANCE)) {
      const second = rng.pick(ALL_TRAITS);
      if (!out.includes(second)) out.push(second);
    }
  }
  return out;
}
