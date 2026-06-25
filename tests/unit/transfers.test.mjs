/**
 * tests/unit/transfers.test.mjs — the AI transfer market (P6b + P13 buy/sell).
 *
 * Covers: filling short rosters, input immutability, determinism, player value,
 * transfer fees, buying contracted players (fees + budget flows), bidding wars
 * resolved by attractiveness, and shielding the user's club (protectTeamId).
 * Pure & rng-injected; rosters never exceed MIN_ROSTER.
 */

import { assert, section } from '../_assert.mjs';
import { runTransferMarket, playerValue, lineupValue, transferFee } from '../../src/engine/career/offseason/transfers.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { createRng } from '../../src/core/rng.js';
import { BALANCE } from '../../src/config/balance.js';

const MIN = BALANCE.CAREER.MARKET.MIN_ROSTER;
const FLOOR = BALANCE.CAREER.ECONOMY.BUDGET_FLOOR;

/** A player with a uniform attribute level. */
function mk(id, ovr, { teamId = null, status = 'free_agent', potential, expires = 8 } = {}) {
  const attributes = {};
  for (const k of ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl']) attributes[k] = ovr;
  return createPlayer({
    id, name: id, role: 'Duelist', potential: potential != null ? potential : ovr,
    attributes, contract: { teamId, salary: status === 'active' ? 50000 : 0, expires, status }
  });
}

/** Build a World from team specs + a free-agent list. */
function worldOf(teamSpecs, freeAgents) {
  const teamsById = {};
  const playersById = {};
  for (const fa of freeAgents) playersById[fa.id] = fa;
  for (const spec of teamSpecs) {
    const roster = spec.players.map((p) => p.id);
    for (const p of spec.players) playersById[p.id] = p;
    teamsById[spec.id] = createTeam({ id: spec.id, name: spec.id, reputation: spec.reputation, budget: spec.budget, roster });
  }
  return { leagues: {}, teamsById, playersById };
}

const noDupes = (w) => {
  const seen = new Set();
  for (const t of Object.values(w.teamsById)) for (const id of t.roster) { if (seen.has(id)) return false; seen.add(id); }
  return true;
};
const allAtLeastMin = (w) => Object.values(w.teamsById).every((t) => t.roster.length >= MIN);
const noneAboveMin = (w) => Object.values(w.teamsById).every((t) => t.roster.length <= MIN);

export default async function run() {
  section('runTransferMarket — fills a short roster, never exceeds MIN, no dupes');
  const world = worldOf(
    [
      { id: 'a', reputation: 60, budget: 1500000, players: [mk('a1', 72, { teamId: 'a', status: 'active' }), mk('a2', 70, { teamId: 'a', status: 'active' }), mk('a3', 71, { teamId: 'a', status: 'active' })] },
      { id: 'b', reputation: 50, budget: 1000000, players: [mk('b1', 70, { teamId: 'b', status: 'active' }), mk('b2', 70, { teamId: 'b', status: 'active' }), mk('b3', 70, { teamId: 'b', status: 'active' }), mk('b4', 70, { teamId: 'b', status: 'active' }), mk('b5', 70, { teamId: 'b', status: 'active' })] }
    ],
    [mk('f1', 74), mk('f2', 73), mk('f3', 68), mk('f4', 66)]
  );
  const { world: next, moves } = runTransferMarket(world, createRng(3), { season: 5 });
  assert(next.teamsById.a.roster.length === MIN, 'the short team is filled to MIN_ROSTER');
  assert(allAtLeastMin(next) && noneAboveMin(next), 'every roster is exactly MIN_ROSTER');
  assert(noDupes(next), 'no player is on two rosters');
  assert(moves.some((m) => m.kind === 'signing' && m.toTeamId === 'a'), 'a signing move was recorded for team A');

  section('runTransferMarket — input world is not mutated');
  assert(world.teamsById.a.roster.length === 3, 'the source roster is untouched');
  assert(world.playersById.f1.contract.status === 'free_agent', 'the source free agent is untouched');

  section('runTransferMarket — deterministic for a given seed');
  const r1 = runTransferMarket(world, createRng(9), { season: 5 });
  const r2 = runTransferMarket(world, createRng(9), { season: 5 });
  assert(JSON.stringify(r1.moves) === JSON.stringify(r2.moves), 'same seed reproduces the same moves');

  section('playerValue — upside adds to current overall');
  assert(playerValue(mk('s', 70, { potential: 90 })) > playerValue(mk('j', 70, { potential: 70 })), 'a high-potential player is valued above a capped one');

  section('playerValue — multi-factor: age, upside-by-age, form (M7)');
  // A uniform player at a given overall, with controllable age / form / morale.
  const mkAge = (ovr, { age = 24, potential, form = 0, morale = 60 } = {}) => {
    const attributes = {};
    for (const k of ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl']) attributes[k] = ovr;
    return createPlayer({ id: `p${ovr}_${age}_${form}`, name: 'P', role: 'Duelist', age, potential: potential != null ? potential : ovr, attributes, dynamics: { form, morale } });
  };
  // Age curve: at equal ability/potential, a prime player is worth more than a faded vet.
  assert(playerValue(mkAge(80, { age: 24 })) > playerValue(mkAge(80, { age: 34 })), 'a 24-yo is valued above a 34-yo of identical overall (age depreciation)');
  // Upside is age-discounted: the same headroom is worth more to a teenager than a near-30 player.
  assert(
    playerValue(mkAge(70, { age: 17, potential: 92 })) > playerValue(mkAge(70, { age: 28, potential: 92 })),
    'unrealized upside is worth more to a younger player'
  );
  // Form/morale nudge value: an in-form, happy player is worth a touch more than a slumping one.
  assert(
    playerValue(mkAge(80, { age: 24, form: 80, morale: 90 })) > playerValue(mkAge(80, { age: 24, form: -80, morale: 30 })),
    'an in-form, settled player is valued above a slumping, unhappy one'
  );
  // Never negative, even for a faded, low-overall, slumping veteran.
  assert(playerValue(mkAge(40, { age: 36, form: -100, morale: 0 })) >= 0, 'value is never negative');
  // The age penalty is bounded (a proven vet keeps some name value, never zero).
  assert(playerValue(mkAge(80, { age: 45 })) >= 80 * BALANCE.CAREER.MARKET.VALUE_AGE_MULT_MIN - 1e-6, 'age alone never docks below the floor multiplier');

  section('transferFee — a contracted star costs a real fee; years, prestige & a coach all matter');
  const star = mk('star', 88, { teamId: 'small', status: 'active', expires: 10 });
  const sellerSmall = createTeam({ id: 'small', reputation: 35 });
  const sellerBig = createTeam({ id: 'big', reputation: 90 });
  const feeBase = transferFee(star, sellerSmall, { season: 5 });
  assert(feeBase >= BALANCE.CAREER.TRANSFER.FEE_MIN, 'a contracted player never moves for less than FEE_MIN');
  assert(transferFee(star, sellerBig, { season: 5 }) > feeBase, 'a prestigious seller commands a higher fee');
  const shortDeal = mk('star2', 88, { teamId: 'small', status: 'active', expires: 6 });
  assert(transferFee(star, sellerSmall, { season: 5 }) > transferFee(shortDeal, sellerSmall, { season: 5 }), 'more contract years left = a pricier fee');
  assert(transferFee(star, sellerSmall, { season: 5, coachNego: 95 }) < feeBase, 'a strong negotiating coach talks the fee down');

  section('runTransferMarket — a rich, attractive club BUYS a contracted star (fee + budget flow)');
  // expires:7 with season:5 => 2 years left (a realistic deal the rich club can afford).
  const mkBuyWorld = () => worldOf(
    [
      { id: 'rich', reputation: 92, budget: 8000000, players: [mk('r1', 70, { teamId: 'rich', status: 'active' }), mk('r2', 70, { teamId: 'rich', status: 'active' }), mk('r3', 70, { teamId: 'rich', status: 'active' }), mk('r4', 70, { teamId: 'rich', status: 'active' }), mk('r5', 70, { teamId: 'rich', status: 'active' })] },
      { id: 'poor', reputation: 32, budget: 400000, players: [mk('p_star', 86, { teamId: 'poor', status: 'active', expires: 7 }), mk('p2', 60, { teamId: 'poor', status: 'active' }), mk('p3', 60, { teamId: 'poor', status: 'active' }), mk('p4', 60, { teamId: 'poor', status: 'active' }), mk('p5', 60, { teamId: 'poor', status: 'active' })] }
    ],
    [mk('fa1', 64), mk('fa2', 63), mk('fa3', 62), mk('fa4', 61), mk('fa5', 60), mk('fa6', 59)]
  );
  // The AI bid carries a little variance (a club isn't guaranteed to pull the
  // trigger every window), so scan seeds for a window where the buy fires.
  let buyRes = null;
  for (let s = 0; s < 40 && !buyRes; s += 1) {
    const out = runTransferMarket(mkBuyWorld(), createRng(s), { season: 5 });
    if (out.moves.some((m) => m.kind === 'transfer' && m.playerId === 'p_star')) buyRes = out;
  }
  assert(buyRes, 'across windows the rich club buys the contracted star at least sometimes');
  const bought = buyRes.moves.find((m) => m.kind === 'transfer' && m.playerId === 'p_star');
  assert(bought.fee > 0 && bought.fromTeamId === 'poor' && bought.toTeamId === 'rich', 'the star moved poor -> rich for a fee');
  assert(buyRes.world.teamsById.rich.budget < 8000000, "the buyer's budget fell by the fee");
  assert(buyRes.world.teamsById.poor.budget > 400000, 'the seller banked the fee');
  assert(buyRes.world.teamsById.rich.roster.includes('p_star'), 'the star now plays for the rich club');
  assert(allAtLeastMin(buyRes.world) && noneAboveMin(buyRes.world) && noDupes(buyRes.world), 'rosters stay exactly MIN after the buy');

  section('runTransferMarket — fees CONSERVE money and never breach the budget floor');
  // Total budget is invariant: a fee only MOVES money buyer->seller, never mints it
  // (the bug was a floor-clamped buyer paired with a full-fee-credited seller).
  const startTotal = 8000000 + 400000;
  const endTotal = buyRes.world.teamsById.rich.budget + buyRes.world.teamsById.poor.budget;
  assert(endTotal === startTotal, `total budget conserved across fees (${endTotal} === ${startTotal})`);
  for (const t of Object.values(buyRes.world.teamsById)) {
    assert(t.budget >= FLOOR, `team ${t.id} stays at/above the budget floor (${t.budget} >= ${FLOOR})`);
  }
  // A floor-budget club must NOT be able to buy a contracted player (would breach the floor).
  const brokeWorld = worldOf(
    [
      { id: 'broke', reputation: 88, budget: FLOOR, players: [mk('b1', 70, { teamId: 'broke', status: 'active' }), mk('b2', 70, { teamId: 'broke', status: 'active' }), mk('b3', 70, { teamId: 'broke', status: 'active' }), mk('b4', 70, { teamId: 'broke', status: 'active' }), mk('b5', 70, { teamId: 'broke', status: 'active' })] },
      { id: 'mid', reputation: 40, budget: 1000000, players: [mk('m_star', 86, { teamId: 'mid', status: 'active', expires: 8 }), mk('m2', 60, { teamId: 'mid', status: 'active' }), mk('m3', 60, { teamId: 'mid', status: 'active' }), mk('m4', 60, { teamId: 'mid', status: 'active' }), mk('m5', 60, { teamId: 'mid', status: 'active' })] }
    ], []);
  for (let s = 0; s < 20; s += 1) {
    const out = runTransferMarket(brokeWorld, createRng(s), { season: 5 });
    for (const t of Object.values(out.world.teamsById)) assert(t.budget >= FLOOR, `floor respected for ${t.id} (seed ${s})`);
    const total = out.world.teamsById.broke.budget + out.world.teamsById.mid.budget;
    assert(total === FLOOR + 1000000, `money conserved with a floor-budget buyer (seed ${s})`);
  }

  section('runTransferMarket — talent flows UP: a small club cannot raid a prestige club');
  // poor (rep 32) can never tempt rich's star away — the player prefers prestige.
  const richStarWorld = worldOf(
    [
      { id: 'rich', reputation: 92, budget: 6000000, players: [mk('rs', 90, { teamId: 'rich', status: 'active', expires: 10 }), mk('r2', 80, { teamId: 'rich', status: 'active' }), mk('r3', 80, { teamId: 'rich', status: 'active' }), mk('r4', 80, { teamId: 'rich', status: 'active' }), mk('r5', 80, { teamId: 'rich', status: 'active' })] },
      { id: 'poor', reputation: 30, budget: 9000000, players: [mk('q1', 60, { teamId: 'poor', status: 'active' }), mk('q2', 60, { teamId: 'poor', status: 'active' }), mk('q3', 60, { teamId: 'poor', status: 'active' }), mk('q4', 60, { teamId: 'poor', status: 'active' }), mk('q5', 60, { teamId: 'poor', status: 'active' })] }
    ],
    []
  );
  const raid = runTransferMarket(richStarWorld, createRng(4), { season: 5 });
  assert(!raid.moves.some((m) => m.playerId === 'rs' && m.toTeamId === 'poor'), 'a rich-but-unappealing club (low rep) cannot buy the prestige club\'s star');

  section('runTransferMarket — protectTeamId shields the user\'s club from AI raids');
  // Even across every seed where the star would normally be bought, protecting
  // 'poor' guarantees none of its players are ever sold.
  for (let s = 0; s < 40; s += 1) {
    const prot = runTransferMarket(mkBuyWorld(), createRng(s), { season: 5, protectTeamId: 'poor' });
    assert(!prot.moves.some((m) => m.kind === 'transfer' && m.fromTeamId === 'poor'), `no player sold out of the protected club (seed ${s})`);
  }

  // A player with controllable overall / age / role / potential (the realism fix
  // turns on age & role, which the basic mk() above does not vary).
  const mkR = (id, ovr, { teamId = null, status = 'free_agent', potential, expires = 8, age = 24, role = 'Duelist' } = {}) => {
    const attributes = {};
    for (const k of ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl']) attributes[k] = ovr;
    return createPlayer({
      id, name: id, role, age, potential: potential != null ? potential : ovr,
      attributes, contract: { teamId, salary: status === 'active' ? 80000 : 0, expires, status }
    });
  };

  section('lineupValue — current contribution, not resale: a strong veteran out-ranks a high-potential rookie');
  // The bug: playerValue is asset/resale worth (potential-heavy, age-depreciated), so a
  // 74-overall rookie out-VALUES an 83-overall veteran — and the AI judged squad upgrades
  // on it, leaving strong veteran free agents unsigned. lineupValue judges CURRENT on-field
  // help, so the veteran (who is simply better today) correctly ranks above the rookie.
  const vet83 = mkR('vet83', 83, { age: 31, potential: 83 });
  const rook74 = mkR('rook74', 74, { age: 19, potential: 84 });
  assert(playerValue(rook74) > playerValue(vet83), 'playerValue (resale) ranks the high-ceiling rookie above the veteran (the trap)');
  assert(lineupValue(vet83) > lineupValue(rook74), 'lineupValue (current contribution) ranks the stronger veteran above the rookie');
  assert(lineupValue(vet83) >= 0 && lineupValue(rook74) >= 0, 'lineupValue is never negative');

  section('runTransferMarket — FREE AGENTS FIRST: a club signs a strong free agent over paying a fee for a worse rookie');
  // One real upgrade slot (a weak Duelist). A free 83-overall Duelist and a CONTRACTED
  // 74-overall Duelist (a fee) both fit it. The AI must take the free, better player and
  // must NOT pay a fee for the clearly worse rookie.
  const faVsFeeWorld = () => worldOf(
    [
      {
        id: 'buyer', reputation: 75, budget: 9000000, players: [
          mkR('bd1', 70, { teamId: 'buyer', status: 'active', age: 27, role: 'Duelist' }), // the weak slot
          mkR('bd2', 82, { teamId: 'buyer', status: 'active', age: 25, role: 'Initiator' }),
          mkR('bd3', 82, { teamId: 'buyer', status: 'active', age: 25, role: 'Controller' }),
          mkR('bd4', 82, { teamId: 'buyer', status: 'active', age: 25, role: 'Sentinel' }),
          mkR('bd5', 82, { teamId: 'buyer', status: 'active', age: 25, role: 'Initiator' })
        ]
      },
      {
        id: 'src', reputation: 55, budget: 1000000, players: [
          mkR('rook', 74, { teamId: 'src', status: 'active', age: 19, potential: 84, expires: 7, role: 'Duelist' }),
          mkR('sd2', 76, { teamId: 'src', status: 'active', age: 24, role: 'Initiator' }),
          mkR('sd3', 76, { teamId: 'src', status: 'active', age: 24, role: 'Controller' }),
          mkR('sd4', 76, { teamId: 'src', status: 'active', age: 24, role: 'Sentinel' }),
          mkR('sd5', 76, { teamId: 'src', status: 'active', age: 24, role: 'Initiator' })
        ]
      }
    ],
    [mkR('vetFA', 83, { age: 31, potential: 83, role: 'Duelist' })]
  );
  let faSigned = 0;
  let rookFeeBought = 0;
  for (let s = 0; s < 40; s += 1) {
    const out = runTransferMarket(faVsFeeWorld(), createRng(s), { season: 5 });
    if (out.moves.some((m) => m.playerId === 'vetFA' && m.toTeamId === 'buyer')) faSigned += 1;
    if (out.moves.some((m) => m.kind === 'transfer' && m.playerId === 'rook' && m.toTeamId === 'buyer' && m.fee > 0)) rookFeeBought += 1;
  }
  assert(faSigned >= 36, `the club signs the free 83-overall veteran almost every window (got ${faSigned}/40)`);
  assert(rookFeeBought === 0, `the club never pays a fee for the worse 74-overall rookie when the better free agent fits (got ${rookFeeBought})`);

  section('runTransferMarket — a strong free agent who fills a need is signed PROMPTLY, not stranded');
  // A club whose worst starter is far below an available strong free agent should sign
  // them in the very next window — every time.
  const strandWorld = () => worldOf(
    [
      {
        id: 'needy', reputation: 65, budget: 5000000, players: [
          mkR('n1', 64, { teamId: 'needy', status: 'active', age: 28, role: 'Duelist' }),
          mkR('n2', 72, { teamId: 'needy', status: 'active', age: 25, role: 'Initiator' }),
          mkR('n3', 72, { teamId: 'needy', status: 'active', age: 25, role: 'Controller' }),
          mkR('n4', 72, { teamId: 'needy', status: 'active', age: 25, role: 'Sentinel' }),
          mkR('n5', 72, { teamId: 'needy', status: 'active', age: 25, role: 'Initiator' })
        ]
      }
    ],
    [mkR('star', 84, { age: 27, potential: 86, role: 'Duelist' }), mkR('filler', 60, { age: 22, role: 'Controller' })]
  );
  let strongSigned = 0;
  for (let s = 0; s < 40; s += 1) {
    const out = runTransferMarket(strandWorld(), createRng(s), { season: 5 });
    if (out.moves.some((m) => m.playerId === 'star' && m.toTeamId === 'needy')) strongSigned += 1;
  }
  assert(strongSigned >= 38, `the strong free agent is signed promptly across windows (got ${strongSigned}/40)`);

  section('runTransferMarket — clubs do NOT pay transfer fees for over-the-hill players');
  // Even an affordable, contracted veteran is never BOUGHT for a fee — clubs pay fees for
  // youth/prime assets and let a strong veteran arrive on a FREE transfer instead.
  const oldStarWorld = () => worldOf(
    [
      {
        id: 'rich', reputation: 80, budget: 9000000, players: [
          mkR('g1', 66, { teamId: 'rich', status: 'active', age: 27, role: 'Duelist' }),
          mkR('g2', 70, { teamId: 'rich', status: 'active', age: 25, role: 'Initiator' }),
          mkR('g3', 70, { teamId: 'rich', status: 'active', age: 25, role: 'Controller' }),
          mkR('g4', 70, { teamId: 'rich', status: 'active', age: 25, role: 'Sentinel' }),
          mkR('g5', 70, { teamId: 'rich', status: 'active', age: 25, role: 'Initiator' })
        ]
      },
      {
        id: 'seller', reputation: 45, budget: 1000000, players: [
          mkR('oldstar', 82, { teamId: 'seller', status: 'active', age: 34, expires: 8, role: 'Duelist' }),
          mkR('e2', 74, { teamId: 'seller', status: 'active', age: 24, role: 'Initiator' }),
          mkR('e3', 74, { teamId: 'seller', status: 'active', age: 24, role: 'Controller' }),
          mkR('e4', 74, { teamId: 'seller', status: 'active', age: 24, role: 'Sentinel' }),
          mkR('e5', 74, { teamId: 'seller', status: 'active', age: 24, role: 'Initiator' })
        ]
      }
    ],
    []
  );
  for (let s = 0; s < 40; s += 1) {
    const out = runTransferMarket(oldStarWorld(), createRng(s), { season: 5 });
    assert(!out.moves.some((m) => m.kind === 'transfer' && m.playerId === 'oldstar' && m.fee > 0), `no fee paid for the 34-yo veteran (seed ${s})`);
  }
}
