/**
 * engine/match/abilities.js — deterministic, bounded agent ability effects.
 *
 * Maps each Valorant agent to an ability archetype and translates comp
 * composition into round-level multipliers that shift ATK/DEF econ factors
 * and trade probability. All constants live in BALANCE.ABILITY (config/balance.js).
 *
 * Archetypes:
 *   'info'    — Sova, Fade, Cypher: recon intel raises trade odds for that team.
 *   'smoke'   — Controllers (Brimstone/Omen/Viper/Astra/Harbor/Clove): smokes
 *               help attackers push onto site (ATK econ-factor lift).
 *   'flash'   — Flash Initiators (Breach/Skye/KAY/O/Gekko/Tejo): flashes give
 *               an entry advantage for attackers (ATK econ-factor lift).
 *   'anchor'  — Sentinels (Killjoy/Sage/Chamber/Deadlock/Vyse): trip wires,
 *               walls, and heal improve defender hold / retake (DEF econ-factor lift).
 *   'duelist' — Duelists: pure fragging; no ability multiplier (already captured
 *               by the duel-rating model).
 *
 * Ult economy:
 *   Each team accrues ult points per kill and per round win. When points cross the
 *   threshold the ult is "ready"; the NEXT round it fires (ULT_BOOST to econ factor)
 *   and the meter resets.
 *
 * Pure & immutable: no DOM / Math.random / Date.now / side effects. All tuning
 * values come from BALANCE.ABILITY. Named exports only; runs unchanged in Node
 * and the browser (plain ES modules).
 *
 * @typedef {'info'|'smoke'|'flash'|'anchor'|'duelist'} Archetype
 * @typedef {{ info:number, smoke:number, flash:number, anchor:number, duelist:number }} CompProfile
 * @typedef {{ atkFactor:number, defFactor:number, tradeBonus:number, ultBonus:number, profile:CompProfile }} AbilityEffects
 * @typedef {{ points:number, threshold:number, ready:boolean }} UltState
 */

import { BALANCE } from '../../config/balance.js';

/**
 * Ability archetype keyed by agent id (matches AGENTS array in config/agents.js).
 * Every agent is assigned exactly one archetype.
 * @type {Readonly<Record<string, Archetype>>}
 */
const AGENT_ARCHETYPE = Object.freeze({
  // Duelists — pure fragging entries
  jett: 'duelist',
  raze: 'duelist',
  reyna: 'duelist',
  phoenix: 'duelist',
  yoru: 'duelist',
  neon: 'duelist',
  iso: 'duelist',
  waylay: 'duelist',
  // Initiators — split into info/recon vs flash
  sova: 'info',   // recon drone + owl drone + shock dart
  fade: 'info',   // haunt + prowlers give strong intel
  kayo: 'flash',  // flash/drive + zero/point suppress
  breach: 'flash', // after-shock + flashpoint + rolling thunder
  skye: 'flash',  // trailblazer + guiding light flash
  gekko: 'flash', // dizzy flash + wingman
  tejo: 'flash',  // stealth drone + guided salvo
  // Controllers — all smokes
  brimstone: 'smoke',
  omen: 'smoke',
  viper: 'smoke',
  astra: 'smoke',
  harbor: 'smoke',
  clove: 'smoke',
  // Sentinels — Cypher provides recon; the rest anchor positions
  cypher: 'info',   // camera + trip wire + cage = primary intel sentinel
  killjoy: 'anchor',
  sage: 'anchor',
  chamber: 'anchor',
  deadlock: 'anchor',
  vyse: 'anchor'
});

/**
 * Count each ability archetype in a comp.
 * @param {string[]|undefined} comp array of agentIds (length 0..5)
 * @returns {CompProfile} archetype counts (0 for unknowns)
 */
export function compProfile(comp) {
  const counts = { info: 0, smoke: 0, flash: 0, anchor: 0, duelist: 0 };
  if (!Array.isArray(comp)) return counts;
  for (const id of comp) {
    const arch = AGENT_ARCHETYPE[id];
    if (arch) counts[arch] += 1;
  }
  return counts;
}

/**
 * Compute per-round ability effect multipliers for a team based on their comp.
 *
 * Returns:
 *   atkFactor  — multiply onto the ATK econ factor this round (≥1).
 *   defFactor  — multiply onto the DEF econ factor this round (≥1).
 *   tradeBonus — additive bonus to trade probability when this team's player dies.
 *   ultBonus   — additive bonus to both ATK/DEF econ factor if the ult fires.
 *   profile    — the raw archetype counts (for optional box-score surfacing).
 *
 * @param {string[]|undefined} comp agentIds for this team
 * @param {boolean} ultReady whether this team's ult is ready to fire this round
 * @returns {AbilityEffects}
 */
export function compAbilityEffects(comp, ultReady) {
  const p = compProfile(comp);
  const ab = BALANCE.ABILITY;

  // ATK factor: smokes help push site, flashes help entry.
  const rawAtkBoost = p.smoke * ab.SMOKE_ATK_BOOST + p.flash * ab.FLASH_ATK_BOOST;
  const atkBoost = Math.min(rawAtkBoost, ab.MAX_ATK_BOOST);

  // DEF factor: anchors hold sites and improve retakes/post-plant defence.
  const rawDefBoost = p.anchor * ab.ANCHOR_DEF_BOOST;
  const defBoost = Math.min(rawDefBoost, ab.MAX_DEF_BOOST);

  // Info: recon intel lets the team react faster and trade more reliably.
  const tradeBonus = p.info * ab.INFO_TRADE_BONUS;

  // Ult: one-time econ-factor burst when the meter is charged.
  const ultBonus = ultReady ? ab.ULT_BOOST : 0;

  // Balanced comp bonus: smokes or flashes + an anchor + info coverage = synergy.
  const hasPush = p.smoke > 0 || p.flash > 0;
  const balanced = hasPush && p.anchor > 0 && p.info > 0;
  const balanceBonus = balanced ? ab.BALANCED_COMP_BONUS : 0;

  return {
    atkFactor: 1 + atkBoost + balanceBonus,
    defFactor: 1 + defBoost + balanceBonus,
    tradeBonus,
    ultBonus,
    profile: p
  };
}

/**
 * Create the initial ult state for a team.
 * Duelist-heavy comps charge faster (lower threshold — real Valorant cheap ults).
 * @param {string[]|undefined} comp agentIds for this team
 * @returns {UltState}
 */
export function createUltState(comp) {
  const p = compProfile(comp);
  const threshold = p.duelist >= 2 ? BALANCE.ABILITY.ULT_THRESHOLD_LOW : BALANCE.ABILITY.ULT_THRESHOLD;
  return { points: 0, threshold, ready: false };
}

/**
 * Advance ult state after a round completes.
 * If the ult was ready this round it fired — clear `ready` first, then accrue
 * new points from kills/win. If accumulated points hit the threshold, `ready`
 * becomes true so the NEXT round receives the ult bonus.
 *
 * Deterministic: no rng, just arithmetic.
 * @param {UltState} state state at the START of the just-completed round
 * @param {number} kills kills by this team in the round
 * @param {boolean} won whether this team won the round
 * @returns {UltState} new state (fresh object, input not mutated)
 */
export function advanceUltState(state, kills, won) {
  const ab = BALANCE.ABILITY;
  // Consume ult if it fired (ready → reset points to 0 before accumulating).
  const base = state.ready ? 0 : state.points;
  const earned = kills * ab.ULT_POINTS_PER_KILL + (won ? ab.ULT_POINTS_PER_WIN : 0);
  const next = base + earned;
  if (next >= state.threshold) {
    return { points: 0, threshold: state.threshold, ready: true };
  }
  return { points: next, threshold: state.threshold, ready: false };
}
