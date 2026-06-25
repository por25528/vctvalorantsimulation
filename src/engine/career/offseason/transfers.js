/**
 * engine/career/offseason/transfers.js — the AI transfer market (P6b core,
 * rebuilt in P13 into a full BUY/SELL market with fees, bidding wars, budgets and
 * role-aware, smarter AI).
 *
 * Given a World whose free agents already live in `playersById` (status
 * 'free_agent' — released vets + newgens), it reshapes rosters in three movements:
 *
 *   PHASE 1 (fill): every team below MIN_ROSTER signs free agents until full.
 *     More attractive clubs (prestige + success + money) pick first; among the
 *     pool the better, role-fitting, AFFORDABLE player usually wins, via a
 *     value-weighted draw so it isn't strictly deterministic-best.
 *
 *   PHASE 2 (buy/sell auctions): bounded upgrade passes. Each pass every club
 *     names its single best upgrade target — a free agent (no fee) OR a player
 *     still under contract elsewhere (pay a transferFee from budget). When several
 *     clubs chase the same player it's a BIDDING WAR: the player signs for whoever
 *     they find most desirable (attractiveness + a starting role), so talent flows
 *     UP to winning, rich, prestigious orgs — and a small club can't simply outbid
 *     for a star who'd rather join a contender. Buying drains the buyer's budget
 *     and pays the seller, who then refills from the pool. All bounded & seeded.
 *
 * Invariants preserved end-to-end (the off-season pipeline + safety net rely on
 * them): rosters never exceed MIN_ROSTER here (every buy is paired with a release,
 * every sale leaves a hole the fill pass patches), no player is double-rostered,
 * the input World is never mutated, outputs are frozen, and the same (world, seed,
 * season) reproduces the same moves. Constants from BALANCE.CAREER.{MARKET,CONTRACT,TRANSFER}.
 *
 * @typedef {Object} Move
 * @property {string} playerId
 * @property {string|null} fromTeamId
 * @property {string|null} toTeamId
 * @property {number} fee
 * @property {number} salary
 * @property {'signing'|'transfer'|'release'} kind
 */

import { BALANCE } from '../../../config/balance.js';
import { overall, num, clamp } from '../playerStats.js';
import { salaryFor, contractLengthFor } from './contracts.js';
import { teamAttractiveness, signingDesirability } from '../attractiveness.js';

const M = BALANCE.CAREER.MARKET;
const TR = BALANCE.CAREER.TRANSFER;
const FLOOR = BALANCE.CAREER.ECONOMY.BUDGET_FLOOR;

/**
 * Market value of a player — deliberately NOT a single number (M7). It blends:
 *   - ABILITY: current overall (the base).
 *   - UPSIDE: unrealized headroom (potential − overall), weighted down by AGE — a
 *     teenager will realise their ceiling so it counts fully; a 29-yo never will so
 *     it counts for ~nothing.
 *   - AGE CURVE: the asset depreciates each year past its prime (fewer prime years
 *     left, lower resale), floored so a proven veteran keeps some name value — so a
 *     33-yo 80-overall is valued well below a 24-yo 80-overall (the AI stops
 *     overpaying fees for decliners).
 *   - CONDITION: form & morale nudge perceived value a little either way.
 * Pure (reads only player fields); shared by fee pricing, signing draws, upgrade
 * targeting and the drop/sell choice so the whole market agrees on worth.
 *
 * @param {object} player
 * @returns {number} value (>= 0)
 */
export function playerValue(player) {
  const o = overall(player);
  const pot = num(player && player.potential, o);
  const age = num(player && player.age, 21);
  // Upside, discounted by age (1 at/below FULL age → 0 at/above ZERO age).
  const upside = Math.max(0, pot - o);
  const youth = clamp(
    (M.VALUE_UPSIDE_AGE_ZERO - age) / (M.VALUE_UPSIDE_AGE_ZERO - M.VALUE_UPSIDE_AGE_FULL),
    0, 1
  );
  let value = o + M.VALUE_POT_WEIGHT * upside * youth;
  // Age depreciation past the prime pivot, floored at VALUE_AGE_MULT_MIN.
  const yearsPast = Math.max(0, age - M.VALUE_AGE_DECLINE_PIVOT);
  const ageMult = Math.max(M.VALUE_AGE_MULT_MIN, 1 - M.VALUE_AGE_DECLINE_K * yearsPast);
  // Condition: in-form & settled players read a touch more valuable.
  const form = num(player && player.dynamics && player.dynamics.form, 0);
  const morale = num(player && player.dynamics && player.dynamics.morale, 60);
  const condition = 1 + M.VALUE_FORM_K * (form / 100) + M.VALUE_MORALE_K * ((morale - 60) / 40);
  value = value * ageMult * Math.max(0, condition);
  return Math.max(0, value);
}

/**
 * Lineup-contribution value — how much a player improves a STARTING FIVE *right
 * now*, as opposed to playerValue's asset/resale worth. playerValue is
 * potential-heavy and steeply age-depreciated (right for pricing fees and resale);
 * but for "does this player make my five better today" what matters is current
 * on-field ability. So lineupValue is OVERALL-led: potential is only a small nudge
 * (you field ability now, not a ceiling) and the age curve is mild (a player's
 * `overall` already encodes most skill decline). This is what stops a proven 83-OVR
 * veteran free agent reading below a mediocre 74-OVR starter — and so what stops the
 * AI ignoring strong free agents while paying fees for weaker, higher-resale rookies.
 * Pure (reads only player fields); used for upgrade/improve ranking, the makeweight
 * drop, and the fill draw. Fees still price off playerValue (asset worth).
 *
 * @param {object} player
 * @returns {number} value (>= 0)
 */
export function lineupValue(player) {
  const o = overall(player);
  const pot = num(player && player.potential, o);
  const age = num(player && player.age, 21);
  // Potential is a small nudge only (current ability dominates), age-discounted.
  const upside = Math.max(0, pot - o);
  const youth = clamp(
    (M.VALUE_UPSIDE_AGE_ZERO - age) / (M.VALUE_UPSIDE_AGE_ZERO - M.VALUE_UPSIDE_AGE_FULL),
    0, 1
  );
  let value = o + M.VALUE_LINEUP_POT_WEIGHT * upside * youth;
  // Mild age dock (overall already encodes decline), with a high veteran floor.
  const yearsPast = Math.max(0, age - M.VALUE_AGE_DECLINE_PIVOT);
  const ageMult = Math.max(M.VALUE_LINEUP_AGE_MULT_MIN, 1 - M.VALUE_LINEUP_AGE_DECLINE_K * yearsPast);
  const form = num(player && player.dynamics && player.dynamics.form, 0);
  const morale = num(player && player.dynamics && player.dynamics.morale, 60);
  const condition = 1 + M.VALUE_FORM_K * (form / 100) + M.VALUE_MORALE_K * ((morale - 60) / 40);
  value = value * ageMult * Math.max(0, condition);
  return Math.max(0, value);
}

/**
 * The fee to prise a CONTRACTED player away: a progressive premium on their value,
 * inflated by remaining contract years and the seller's prestige, capped by a
 * release clause and reduced by the buyer's coach negotiation. Free agents are
 * always free; this is only for players under contract.
 *
 * @param {object} player
 * @param {object|null} sellerTeam
 * @param {{ season?:number, coachNego?:number }} [opts]
 * @returns {number} rounded fee (>= FEE_MIN)
 */
export function transferFee(player, sellerTeam, opts = {}) {
  const season = num(opts.season, 0);
  const v = playerValue(player);
  const base = TR.FEE_VALUE_K * Math.pow(Math.max(0, v - TR.FEE_VALUE_PIVOT), TR.FEE_VALUE_POW);
  const expires = num(player && player.contract && player.contract.expires, season);
  const yearsLeft = Math.max(1, expires - season);
  const yearsMult = 1 + TR.FEE_YEARS_K * (yearsLeft - 1);
  const sellerRep = num(sellerTeam && sellerTeam.reputation, 50);
  const repMult = 1 + TR.FEE_REP_K * (sellerRep - 50);
  let fee = base * yearsMult * repMult;
  // Coach negotiation (P13 transfer coach): a good GM talks the fee down.
  const nego = num(opts.coachNego, 0);
  if (nego > 50) {
    const disc = Math.min(BALANCE.CAREER.STAFF.NEGO_FEE_MAX, BALANCE.CAREER.STAFF.NEGO_FEE_K * (nego - 50));
    fee *= (1 - disc);
  }
  fee = Math.min(fee, base * TR.RELEASE_CLAUSE_MULT); // release-clause cap
  return Math.max(TR.FEE_MIN, Math.round(fee));
}

/** Stable string compare for deterministic id tiebreaks. */
function idCmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * War-chest pressure (0..1): how aggressively a cash-rich club should deploy its
 * reserve. A club sitting near the floor reads 0 (spends conservatively); a club
 * with a fat surplus reads toward 1 (chases smaller upgrades, overpays to win
 * bidding wars, runs extra passes) so prize+sponsor money actually gets spent
 * instead of hoarded. Pure & deterministic (reads only the live budget).
 *
 * @param {{budget?:number}} team
 * @returns {number} 0..1
 */
function spendPressure(team) {
  const budget = num(team && team.budget, 0);
  return clamp((budget - TR.WARCHEST_REF) / TR.WARCHEST_SPAN, 0, 1);
}

/** A flush club's committed wage offer (overpays toward OVERPAY_MAX to win wars). */
function offerWageFor(player, pressure) {
  const market = salaryFor(player);
  return Math.round(market * (1 + pressure * (TR.OVERPAY_MAX - 1)));
}

/** The roles present among a team's starting five (first five roster ids). */
function startingRoleCounts(team, players) {
  const counts = {};
  const roster = (team && team.roster) || [];
  for (let i = 0; i < Math.min(5, roster.length); i += 1) {
    const p = players[roster[i]];
    if (p && p.role) counts[p.role] = (counts[p.role] || 0) + 1;
  }
  return counts;
}

/** Roles a team's starting five is missing entirely (smarter buying targets these). */
function roleNeeds(team, players) {
  const counts = startingRoleCounts(team, players);
  const need = new Set();
  for (const r of ['Duelist', 'Initiator', 'Controller', 'Sentinel']) {
    if (!counts[r]) need.add(r);
  }
  return need;
}

/** Is this player one of the team's starting five? */
function isStarter(team, playerId) {
  const roster = (team && team.roster) || [];
  return roster.indexOf(playerId) >= 0 && roster.indexOf(playerId) < 5;
}

/**
 * The starter a club would drop to bring in a target of `targetRole`: prefer the
 * weakest starter who shares the target's role (a clean positional swap), else the
 * weakest in an over-supplied role, else the weakest starter overall. Keeps the
 * lineup role-balanced rather than blindly stacking one position.
 */
function starterToDrop(team, players, targetRole) {
  const roster = (team && team.roster) || [];
  const five = roster.slice(0, 5).map((id) => players[id]).filter(Boolean);
  if (five.length === 0) return null;
  const counts = startingRoleCounts(team, players);
  // Drop the weakest CONTRIBUTOR (lineup value), not the lowest resale asset.
  const byVal = (a, b) => lineupValue(a) - lineupValue(b) || idCmp(a.id, b.id);
  const sameRole = five.filter((p) => p.role === targetRole).sort(byVal);
  if (sameRole.length) return sameRole[0].id;
  const oversupplied = five.filter((p) => (counts[p.role] || 0) >= 2).sort(byVal);
  if (oversupplied.length) return oversupplied[0].id;
  return five.slice().sort(byVal)[0].id;
}

/**
 * Run one pass of the AI transfer market over a World.
 *
 * @param {{leagues:object, teamsById:object, playersById:object}} world
 * @param {import('../../../core/rng.js').Rng} rng
 * @param {{ season?:number, successOf?:(teamId:string)=>number, coachNegoOf?:(teamId:string)=>number }} [opts]
 * @returns {{ world:object, moves:Move[] }}
 */
export function runTransferMarket(world, rng, opts = {}) {
  if (!world || typeof world !== 'object' || !world.teamsById || !world.playersById) {
    throw new Error('runTransferMarket: a World { leagues, teamsById, playersById } is required');
  }
  if (!rng || typeof rng.weightedPick !== 'function') {
    throw new Error('runTransferMarket: an Rng is required');
  }
  const season = num(opts.season, 0);
  const successOf = typeof opts.successOf === 'function' ? opts.successOf : () => 0;
  const coachNegoOf = typeof opts.coachNegoOf === 'function' ? opts.coachNegoOf : () => 0;
  // The user's club is managed by the player, not the AI: it is never auto-bought
  // for, and its players are never sold out from under them (it IS still kept ≥ MIN
  // so the engine can always field a five). Defaults to none (pure-engine callers).
  const protectTeamId = typeof opts.protectTeamId === 'string' ? opts.protectTeamId : null;

  // Working copies: replace only the objects we touch; reuse frozen originals
  // elsewhere. Rosters are sliced so we can mutate them in place; budget is a
  // live number the auctions debit/credit for fees.
  /** @type {Record<string, object>} */
  const players = { ...world.playersById };
  /** @type {Record<string, {id:string, reputation:number, budget:number, roster:string[]}>} */
  const teams = {};
  for (const id of Object.keys(world.teamsById)) {
    const t = world.teamsById[id];
    teams[id] = { ...t, roster: t.roster.slice(), budget: num(t.budget, 0) };
  }

  /** @type {Move[]} */
  const moves = [];

  const freeAgents = () =>
    Object.keys(players).filter((id) => players[id].contract.status === 'free_agent');

  /** Attractiveness context for a team (recent success folded in). */
  const attractCtx = (teamId) => ({ success: successOf(teamId) });
  const attractOf = (teamId) => teamAttractiveness(teams[teamId], attractCtx(teamId));

  /** Sign a free agent to a team (mutates working state, records the move). */
  function sign(teamId, playerId, kind, salaryOverride) {
    const p = players[playerId];
    const length = contractLengthFor(p, rng);
    const salary = salaryOverride > 0 ? salaryOverride : salaryFor(p);
    players[playerId] = { ...p, contract: { teamId, salary, expires: season + length, status: 'active' } };
    teams[teamId].roster.push(playerId);
    moves.push({ playerId, fromTeamId: null, toTeamId: teamId, fee: 0, salary, kind: kind || 'signing' });
  }

  /** Release a player to free agency (mutates working state, records the move). */
  function release(teamId, playerId) {
    const p = players[playerId];
    players[playerId] = { ...p, contract: { teamId: null, salary: 0, expires: 0, status: 'free_agent' } };
    const r = teams[teamId].roster;
    const i = r.indexOf(playerId);
    if (i >= 0) r.splice(i, 1);
    moves.push({ playerId, fromTeamId: teamId, toTeamId: null, fee: 0, salary: 0, kind: 'release' });
  }

  /** Buy a contracted player from `sellerId` for `fee` (moves cash + the player). */
  function buy(buyerId, sellerId, playerId, fee, salaryOverride) {
    const p = players[playerId];
    const length = contractLengthFor(p, rng);
    const salary = salaryOverride > 0 ? salaryOverride : salaryFor(p);
    // remove from seller, add to buyer
    const sr = teams[sellerId].roster;
    const si = sr.indexOf(playerId);
    if (si >= 0) sr.splice(si, 1);
    teams[buyerId].roster.push(playerId);
    players[playerId] = { ...p, contract: { teamId: buyerId, salary, expires: season + length, status: 'active' } };
    // Cash: buyer pays the FULL fee, seller receives it (conservation). The buy is
    // only ever reached when the buyer can pay without breaching the floor (gated
    // in bestUpgradeBid + the execute precondition), so no clamp is needed here —
    // clamping the buyer while crediting the seller in full would mint money.
    teams[buyerId].budget = teams[buyerId].budget - fee;
    teams[sellerId].budget = teams[sellerId].budget + fee;
    moves.push({ playerId, fromTeamId: sellerId, toTeamId: buyerId, fee, salary, kind: 'transfer' });
  }

  // ---- PHASE 1: fill every team to MIN_ROSTER ----------------------------
  // Most attractive needy team picks next; among AFFORDABLE free agents the
  // better, role-fitting player usually wins (value-weighted draw).
  function fillRosters() {
    for (;;) {
      const needy = Object.values(teams)
        .filter((t) => t.roster.length < M.MIN_ROSTER)
        .sort((a, b) => attractOf(b.id) - attractOf(a.id) || idCmp(a.id, b.id));
      if (needy.length === 0) break;
      const team = needy[0];
      const need = roleNeeds(team, players);
      // Afford the wage out of the cash reserve; if a club can afford nobody, the
      // pool/ safety-net will hand it cheap youth (a poor club fields prospects).
      const pool = freeAgents().filter((id) => salaryFor(players[id]) <= team.budget);
      const usable = pool.length ? pool : freeAgents(); // never stall a roster below MIN
      if (usable.length === 0) break; // exhausted — the orchestrator's safety net fills the rest
      // Prefer the better player, but heavily bias the draw toward a free agent who
      // plugs a MISSING core role, so the patched five trends role-complete (a
      // balanced Duelist/Initiator/Controller/Sentinel lineup) rather than stacking.
      // Weight by on-field contribution (lineupValue) so a strong free agent (incl. a
      // proven vet) is favoured, not just a high-ceiling raw prospect.
      const fillScore = (id) => {
        const p = players[id];
        const base = Math.pow(Math.max(1, lineupValue(p)), M.SIGN_WEIGHT_POW);
        return need.has(p.role) ? base * M.ROLE_NEED_FILL_MULT : base;
      };
      // Draw only among the best-fitting candidates: over the whole pool the long tail
      // of raw newgens dilutes the strongest free agent to a few-percent chance, so a
      // club could sign a weak prospect while a strong same-role free agent sat unsigned.
      // The shortlist keeps the choice strong (with a little variety among the top tier).
      const shortlist = usable.slice()
        .sort((a, b) => fillScore(b) - fillScore(a) || idCmp(a, b))
        .slice(0, Math.max(1, M.FILL_SHORTLIST));
      const chosen = rng.weightedPick(shortlist, fillScore);
      sign(team.id, chosen, 'signing');
    }
  }

  fillRosters();

  // ---- PHASE 2: bounded buy/sell upgrade auctions ------------------------
  // A flush league runs extra passes so war-chest clubs can make several moves in
  // one window (still bounded → terminates; the loop also breaks once nobody bids).
  const maxPressure = Math.max(0, ...Object.values(teams).map(spendPressure));
  const buyPasses = TR.MAX_BUY_PASSES + Math.round(maxPressure * TR.WARCHEST_PASSES_BONUS);
  for (let pass = 0; pass < buyPasses; pass += 1) {
    // 1) every full club names its single best, affordable, genuine upgrade.
    const bids = [];
    for (const t of Object.values(teams)) {
      if (t.roster.length < M.MIN_ROSTER) continue;
      if (t.id === protectTeamId) continue; // the user manages their own transfers
      const bid = bestUpgradeBid(t);
      if (bid) bids.push(bid);
    }
    if (bids.length === 0) break;

    // 2) group by target → bidding war → the player picks their keenest suitor.
    /** @type {Map<string, object[]>} */
    const byTarget = new Map();
    for (const b of bids) {
      if (!byTarget.has(b.targetId)) byTarget.set(b.targetId, []);
      byTarget.get(b.targetId).push(b);
    }
    const wins = [];
    for (const [targetId, suitors] of byTarget) {
      const target = players[targetId];
      let best = null;
      let bestScore = -Infinity;
      for (const s of suitors.slice().sort((a, b) => idCmp(a.buyerId, b.buyerId))) {
        const score = signingDesirability(target, teams[s.buyerId], {
          success: successOf(s.buyerId),
          wageOffer: s.wage, marketWage: salaryFor(target), willStart: true
        });
        if (score > bestScore) { bestScore = score; best = s; }
      }
      if (best) wins.push(best);
    }
    // deterministic execution order: keenest, richest buyers first
    wins.sort((a, b) => attractOf(b.buyerId) - attractOf(a.buyerId) || idCmp(a.buyerId, b.buyerId));

    // 3) execute, re-validating preconditions (a club moves at most once / pass).
    const movedTeams = new Set();
    let executed = 0;
    for (const w of wins) {
      if (movedTeams.has(w.buyerId)) continue;
      const buyer = teams[w.buyerId];
      if (!buyer || buyer.roster.length < M.MIN_ROSTER) continue;
      const target = players[w.targetId];
      if (!target) continue;
      const fa = target.contract.status === 'free_agent';
      const sellerId = fa ? null : target.contract.teamId;
      // The committed wage is the (possibly overpaid) offer the bid was won on, so
      // the contract carries the higher cost — a conserved future sink that drains the
      // buyer's surplus over later seasons (the fee itself stays full buyer→seller).
      const wage = w.wage > 0 ? w.wage : salaryFor(target);
      // A flush buyer commits a bigger share of its budget to a single fee.
      const buyFraction = TR.BUY_BUDGET_FRACTION + spendPressure(buyer) * TR.WARCHEST_FRACTION_BONUS;
      if (!fa) {
        if (!sellerId || sellerId === w.buyerId || movedTeams.has(sellerId)) continue;
        if (!teams[sellerId] || teams[sellerId].roster.indexOf(w.targetId) < 0) continue;
        const fee = transferFee(target, teams[sellerId], { season, coachNego: coachNegoOf(w.buyerId) });
        if (fee > buyer.budget * buyFraction) continue;
        // Pay the full fee AND stay above the floor, carrying the committed wage.
        if (buyer.budget - fee < Math.max(wage, FLOOR)) continue;
        // drop the makeweight first (buyer stays at MIN), then complete the buy.
        const drop = starterToDrop(buyer, players, target.role);
        if (drop) release(w.buyerId, drop);
        buy(w.buyerId, sellerId, w.targetId, fee, wage);
        movedTeams.add(w.buyerId);
        movedTeams.add(sellerId);
        executed += 1;
      } else {
        if (wage > buyer.budget) continue; // afford the committed wage
        const drop = starterToDrop(buyer, players, target.role);
        if (drop) release(w.buyerId, drop);
        sign(w.buyerId, w.targetId, 'signing', wage);
        movedTeams.add(w.buyerId);
        executed += 1;
      }
    }
    // sellers (and any club that dropped below MIN) refill from the pool.
    fillRosters();
    if (executed === 0) break;
  }

  /**
   * A club's single best upgrade this pass: scan free agents and contracted
   * players elsewhere for one that (a) genuinely betters the weakest starter, (b)
   * fits a role need where possible, (c) the club can afford (wage, and any fee),
   * and — for a contracted target — (d) would actually PREFER this club to their
   * current one. Returns the highest-improvement such target, or null.
   */
  function bestUpgradeBid(team) {
    const five = team.roster.slice(0, 5).map((id) => players[id]).filter(Boolean);
    if (five.length === 0) return null;
    // Judge improvement on CURRENT contribution (lineupValue), not resale asset —
    // so a proven veteran free agent reads as the upgrade they are, and the AI does
    // not chase a higher-resale but weaker rookie over them.
    const worstVal = Math.min(...five.map(lineupValue));
    const need = roleNeeds(team, players);
    const myAttract = attractOf(team.id);
    // War-chest aggression: a cash-rich club chases smaller upgrades, commits a
    // bigger share to a fee, and overpays the wage to out-pull rivals for a target.
    const pressure = spendPressure(team);
    const effMargin = TR.UPGRADE_MARGIN - pressure * TR.WARCHEST_MARGIN_RELIEF;
    const buyFraction = TR.BUY_BUDGET_FRACTION + pressure * TR.WARCHEST_FRACTION_BONUS;

    let best = null;
    let bestImprove = -Infinity;
    // Track the best FREE-AGENT upgrade separately: a free agent is no fee and no
    // makeweight, so we prefer it unless a contracted target is CLEARLY better.
    let bestFa = null;
    let bestFaImprove = -Infinity;
    for (const id of Object.keys(players)) {
      const p = players[id];
      const st = p.contract.status;
      if (st !== 'free_agent' && st !== 'active') continue;
      const onMyRoster = team.roster.indexOf(id) >= 0;
      if (onMyRoster) continue;
      const v = lineupValue(p);
      const roleBonus = need.has(p.role) ? TR.ROLE_NEED_BONUS : 0;
      const improve = v + roleBonus - worstVal;
      if (improve < effMargin) continue;

      const marketWage = salaryFor(p);
      const offerWage = offerWageFor(p, pressure); // the (possibly overpaid) committed wage
      const fa = st === 'free_agent';
      let fee = 0;
      let sellerId = null;
      if (!fa) {
        // Clubs pay a FEE only for youth/prime assets, never decliners — a strong
        // veteran is still pursued, but for FREE (above), not bought for cash.
        if (num(p.age, 21) >= TR.FEE_MAX_AGE) continue;
        sellerId = p.contract.teamId;
        if (!sellerId || sellerId === team.id || !teams[sellerId]) continue;
        if (sellerId === protectTeamId) continue; // never sell the user's players from under them
        // a club won't strip itself below MIN to sell (the seller refills after,
        // but never start a sale from an already-short squad).
        if (teams[sellerId].roster.length <= M.MIN_ROSTER && teams[sellerId].roster.length < 5) continue;
        fee = transferFee(p, teams[sellerId], { season, coachNego: coachNegoOf(team.id) });
        if (fee > team.budget * buyFraction) continue;
        if (team.budget - fee < Math.max(offerWage, FLOOR)) continue; // pay full fee + carry the wage, never breach the floor
        // talent flows UP: the player must prefer us — but an overpaying war chest can
        // tip a contested star (money becomes a real lever, not idle surplus).
        const wantUs = signingDesirability(p, team, { success: successOf(team.id), wageOffer: offerWage, marketWage, willStart: true });
        const wantThem = signingDesirability(p, teams[sellerId], {
          success: successOf(sellerId), wageOffer: num(p.contract.salary, marketWage), marketWage, willStart: isStarter(teams[sellerId], id)
        });
        if (wantUs <= wantThem + TR.PREFER_MARGIN) continue;
      } else {
        if (offerWage > team.budget) continue; // afford the committed wage
        if (improve > bestFaImprove) {
          bestFaImprove = improve;
          bestFa = { buyerId: team.id, targetId: id, sellerId: null, fee: 0, wage: offerWage };
        }
      }
      // among affordable, genuine upgrades, chase the biggest improvement.
      if (improve > bestImprove) {
        bestImprove = improve;
        best = { buyerId: team.id, targetId: id, sellerId, fee, wage: offerWage };
      }
    }
    // FREE AGENTS FIRST: never pay a fee for a target that isn't clearly better than
    // the best free-agent alternative. If the chosen target is a paid transfer but a
    // free agent comes within FA_PREFER_MARGIN of it, sign the free agent instead —
    // no fee, no makeweight, money kept for moves a free agent can't cover.
    if (best && best.fee > 0 && bestFa && bestFaImprove >= bestImprove - TR.FA_PREFER_MARGIN) {
      best = bestFa;
    }
    // Pull-the-trigger: a strong, cash-rich club is keener; a FREE signing (no fee,
    // pure upside) is keener still, so a valuable free agent is signed promptly.
    if (best) {
      let trigger = clamp(0.5 + (myAttract - 50) / 120 + pressure * TR.WARCHEST_TRIGGER_BONUS, 0.2, 0.98);
      if (best.fee === 0) trigger = clamp(trigger + TR.FREE_SIGN_TRIGGER_BONUS, 0.2, 0.99);
      if (!rng.chance(trigger)) return null;
    }
    return best;
  }

  // ---- freeze the next World ---------------------------------------------
  /** @type {Record<string, object>} */
  const teamsById = {};
  for (const id of Object.keys(teams)) {
    const t = teams[id];
    teamsById[id] = Object.freeze({ ...t, budget: Math.round(t.budget), roster: Object.freeze(t.roster.slice()) });
  }
  /** @type {Record<string, object>} */
  const playersById = {};
  for (const id of Object.keys(players)) {
    playersById[id] = Object.isFrozen(players[id]) ? players[id] : Object.freeze(players[id]);
  }

  const nextWorld = Object.freeze({
    leagues: world.leagues,
    teamsById: Object.freeze(teamsById),
    playersById: Object.freeze(playersById)
  });

  return { world: nextWorld, moves };
}
