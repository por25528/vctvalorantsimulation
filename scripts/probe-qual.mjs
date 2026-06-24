/**
 * scripts/probe-qual.mjs — ADVERSARIAL probe of QUALIFICATION + CHAMPIONS COMPOSITION.
 *
 * Runs simSeason over many seeds and INDEPENDENTLY re-derives the invariants the
 * season engine claims, asserting:
 *
 *  MASTERS (m0, m1, m2):
 *    - exactly 12 participants in the seedOrder (masters[slotId].seedOrder)
 *    - exactly 12 placements in the EventResult, all unique
 *    - seedOrder set === placements set (same 12 teams)
 *    - exactly 4 direct + 8 swiss
 *    - the 4 directs (seeds 1..4) are the placement-1 teams of the correct
 *      feeding regional events: m0<-kickoff, m1<-stage1, m2<-stage2
 *    - each of the 4 regions contributes exactly 3 teams to the 12
 *    - the 8 swiss are the placements 2 & 3 of each feeding regional event
 *
 *  CHAMPIONS:
 *    - exactly 16 unique teams in championsField AND in the EventResult placements
 *    - index 0 === the m2 champion (direct slot)
 *    - the other 15 === the top-15 by cumulative CP recomputed INDEPENDENTLY at
 *      that point (all events up to & including stage3, champions CP excluded),
 *      excluding the direct team, ties broken by teamId asc
 *    - no team appears twice
 *
 * Pure verification — no engine internals trusted except the public outputs.
 * Run: node scripts/probe-qual.mjs [numSeeds]
 */

import { buildWorld } from '../src/data/seed/index.js';
import { simSeason } from '../src/engine/career/season.js';
import { awardCP } from '../src/engine/career/championshipPoints.js';
import { CP_TABLE } from '../src/config/cpTable.js';

const NUM_SEEDS = process.argv[2] != null ? Number(process.argv[2]) : 120;
const REGIONS = ['pacific', 'americas', 'emea', 'china'];

const world = buildWorld();
// region of a team, by id, derived independently from the world (not the season).
const regionOf = (id) => {
  const t = world.teamsById[id];
  return t ? t.leagueId : undefined;
};

const violations = [];
function v(seed, where, msg, extra) {
  violations.push({ seed, where, msg, ...(extra || {}) });
}

/** placement-1 teamId of an EventResult. */
function winnerOf(result) {
  const p = result.placements.find((x) => x.rank === 1);
  return p ? p.teamId : undefined;
}
/** teamId at a given placement rank. */
function rankTeam(result, rank) {
  const p = result.placements.find((x) => x.rank === rank);
  return p ? p.teamId : undefined;
}

// Feeding map per Masters slot (independent of the calendar object).
const FEEDS = { m0: 'kickoff', m1: 'stage1', m2: 'stage2' };

let mastersChecked = 0;
let championsChecked = 0;

for (let i = 0; i < NUM_SEEDS; i++) {
  const seed = `probe-${i}`;
  let season;
  try {
    season = simSeason(world, seed);
  } catch (err) {
    v(seed, 'simSeason', `threw: ${err && err.message}`);
    continue;
  }

  // Index regional EventResults by slotId -> region -> result, from season.events.
  const regional = {}; // slotId -> { region: result }
  const internationalBySlot = {}; // slotId -> entry
  for (const ev of season.events) {
    if (ev.region) {
      (regional[ev.slotId] ||= {})[ev.region] = ev.result;
    } else {
      internationalBySlot[ev.slotId] = ev;
    }
  }

  // ---- MASTERS COMPOSITION ----
  for (const slotId of ['m0', 'm1', 'm2']) {
    const entry = internationalBySlot[slotId];
    if (!entry) { v(seed, slotId, 'masters slot missing from events'); continue; }
    const seedRec = season.masters[slotId];
    if (!seedRec || !Array.isArray(seedRec.seedOrder)) {
      v(seed, slotId, 'masters.seedOrder missing'); continue;
    }
    const seedOrder = seedRec.seedOrder;
    const result = entry.result;
    mastersChecked++;

    if (seedOrder.length !== 12) {
      v(seed, slotId, `seedOrder length ${seedOrder.length} != 12`);
    }
    const uniqSeed = new Set(seedOrder);
    if (uniqSeed.size !== 12) {
      v(seed, slotId, `seedOrder has duplicates (unique ${uniqSeed.size})`);
    }
    if (result.placements.length !== 12) {
      v(seed, slotId, `placements length ${result.placements.length} != 12`);
    }
    const placTeams = new Set(result.placements.map((p) => p.teamId));
    if (placTeams.size !== 12) {
      v(seed, slotId, `placements have duplicate teams (unique ${placTeams.size})`);
    }
    // seedOrder set === placements set
    for (const id of uniqSeed) {
      if (!placTeams.has(id)) v(seed, slotId, `seeded team ${id} absent from placements`);
    }
    for (const id of placTeams) {
      if (!uniqSeed.has(id)) v(seed, slotId, `placed team ${id} absent from seedOrder`);
    }
    // ranks 1..12 unique & complete
    const ranks = new Set(result.placements.map((p) => p.rank));
    for (let r = 1; r <= 12; r++) if (!ranks.has(r)) v(seed, slotId, `missing rank ${r}`);

    // Independent expected composition from the feeding regional events.
    const feed = FEEDS[slotId];
    const feedResults = regional[feed];
    if (!feedResults) { v(seed, slotId, `feeding regional slot '${feed}' missing`); continue; }

    const expectDirects = REGIONS.map((rg) => winnerOf(feedResults[rg]));
    const expectSwiss = [];
    for (const placement of [2, 3]) {
      for (const rg of REGIONS) expectSwiss.push(rankTeam(feedResults[rg], placement));
    }

    const directs = seedOrder.slice(0, 4);
    const swiss = seedOrder.slice(4);

    // exactly 4 direct = the four placement-1 teams (region-ordered)
    for (let k = 0; k < 4; k++) {
      if (directs[k] !== expectDirects[k]) {
        v(seed, slotId, `direct seed ${k + 1} = ${directs[k]} but expected placement-1 of ${REGIONS[k]} ${feed} = ${expectDirects[k]}`);
      }
    }
    // exactly 8 swiss = placements 2&3 region-ordered
    if (swiss.length !== 8) v(seed, slotId, `swiss count ${swiss.length} != 8`);
    for (let k = 0; k < 8; k++) {
      if (swiss[k] !== expectSwiss[k]) {
        v(seed, slotId, `swiss seed ${k + 5} = ${swiss[k]} but expected = ${expectSwiss[k]}`);
      }
    }

    // each region contributes exactly 3 (independent region lookup)
    const perRegion = {};
    for (const id of seedOrder) {
      const rg = regionOf(id);
      perRegion[rg] = (perRegion[rg] || 0) + 1;
    }
    for (const rg of REGIONS) {
      if (perRegion[rg] !== 3) {
        v(seed, slotId, `region ${rg} contributes ${perRegion[rg] || 0} (expected 3)`, { perRegion });
      }
    }
    // no foreign region keys
    for (const rg of Object.keys(perRegion)) {
      if (!REGIONS.includes(rg)) v(seed, slotId, `unexpected region ${rg} present`);
    }
  }

  // ---- CHAMPIONS COMPOSITION ----
  const champEntry = internationalBySlot['champions'];
  const field = season.championsField;
  const m2Entry = internationalBySlot['m2'];
  if (!champEntry || !field || !m2Entry) {
    v(seed, 'champions', 'champions/field/m2 missing');
  } else {
    championsChecked++;
    const m2Winner = winnerOf(m2Entry.result);

    if (!Array.isArray(field) || field.length !== 16) {
      v(seed, 'champions', `championsField length ${field && field.length} != 16`);
    }
    const uniqField = new Set(field);
    if (uniqField.size !== 16) {
      v(seed, 'champions', `championsField has duplicates (unique ${uniqField.size})`);
    }
    if (field[0] !== m2Winner) {
      v(seed, 'champions', `field[0] = ${field[0]} but m2 champion = ${m2Winner}`);
    }
    // champions EventResult: 16 unique placements
    if (champEntry.result.placements.length !== 16) {
      v(seed, 'champions', `champions placements length ${champEntry.result.placements.length} != 16`);
    }
    const champPlacTeams = new Set(champEntry.result.placements.map((p) => p.teamId));
    if (champPlacTeams.size !== 16) {
      v(seed, 'champions', `champions placements have duplicate teams (unique ${champPlacTeams.size})`);
    }
    // field set === placements set
    for (const id of uniqField) if (!champPlacTeams.has(id)) v(seed, 'champions', `field team ${id} absent from champions placements`);

    // Independently recompute cumulative CP at the champions-seeding point:
    // sum awardCP over EVERY event BEFORE champions (kickoff, m0, stage1, m1,
    // stage2, m2, stage3 — all of them). The engine seeds the field from the
    // ledger after stage3 / before champions. champions itself awards 0.
    const totals = {};
    for (const ev of season.events) {
      if (ev.slotId === 'champions') continue;
      const awards = awardCP(ev.result, CP_TABLE);
      for (const id of Object.keys(awards)) {
        totals[id] = (totals[id] || 0) + awards[id];
      }
    }

    // Expected top-15 excluding the direct team, ties by teamId asc.
    const expectedTop15 = Object.keys(totals)
      .filter((id) => id !== m2Winner)
      .sort((a, b) => (totals[b] - totals[a]) || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, 15);

    const got15 = field.slice(1);
    for (let k = 0; k < 15; k++) {
      if (got15[k] !== expectedTop15[k]) {
        v(seed, 'champions',
          `field[${k + 1}] = ${got15[k]} (cp ${totals[got15[k]]}) but expected top-15[${k}] = ${expectedTop15[k]} (cp ${totals[expectedTop15[k]]})`,
          { gotCp: totals[got15[k]], expCp: totals[expectedTop15[k]] });
      }
    }
    // ensure direct team not double-listed
    if (got15.includes(m2Winner)) {
      v(seed, 'champions', `m2 champion ${m2Winner} appears again in field[1..15]`);
    }
    // set equality of the 15 (order-independent safety)
    const gotSet = new Set(got15);
    const expSet = new Set(expectedTop15);
    for (const id of expSet) if (!gotSet.has(id)) v(seed, 'champions', `expected top-15 team ${id} (cp ${totals[id]}) missing from field`);
    for (const id of gotSet) if (!expSet.has(id)) v(seed, 'champions', `field team ${id} (cp ${totals[id]}) not in expected top-15`);
  }
}

console.log(`Probed ${NUM_SEEDS} seeds.`);
console.log(`Masters composition checks: ${mastersChecked} (expected ${NUM_SEEDS * 3}).`);
console.log(`Champions composition checks: ${championsChecked} (expected ${NUM_SEEDS}).`);
console.log(`Violations: ${violations.length}`);
if (violations.length) {
  const show = violations.slice(0, 25);
  for (const x of show) {
    console.log(`  [seed ${x.seed}] (${x.where}) ${x.msg}`);
  }
  if (violations.length > show.length) console.log(`  ... and ${violations.length - show.length} more`);
  process.exitCode = 1;
} else {
  console.log('ALL INVARIANTS HELD.');
}
