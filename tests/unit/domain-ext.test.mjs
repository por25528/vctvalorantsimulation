/**
 * tests/unit/domain-ext.test.mjs — P12.0 domain extensions.
 *
 * Verifies the new Player fields (languages/traits/tier/scouting/development.
 * archetype) and Team fields (region/tier/chemistry/coachId) default correctly,
 * sanitize dirty input, survive a createPlayer/createTeam round-trip, and that
 * buildWorld stamps regions + languages onto the real seed world.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { languagesFor, NATIONALITY_LANGUAGE } from '../../src/data/languages.js';
import { buildWorld } from '../../src/data/seed/index.js';

export default async function run() {
  section('player — new field defaults');
  {
    const p = createPlayer({ name: 'x', role: 'Duelist', nationality: 'KR', potential: 88 });
    assertEqual(p.languages, ['ko'], 'KR derives [ko], no English (barrier region)');
    assertEqual(p.traits, [], 'traits default empty');
    assertEqual(p.tier, 't1', 'tier defaults t1');
    assertEqual(p.development.archetype, 'normal', 'archetype defaults normal');
    assertEqual(p.scouting, { potentialLow: 88, potentialHigh: 88, knowledge: 100 }, 'scouting fully known by default');
  }

  section('player — languages derivation & sanitization');
  {
    assertEqual(createPlayer({ nationality: 'US' }).languages, ['en'], 'US → [en]');
    assertEqual(createPlayer({ nationality: 'BR' }).languages, ['pt', 'en'], 'BR → [pt, en]');
    assertEqual(createPlayer({ nationality: 'MY' }).languages, ['ms', 'en'], 'MY → [ms, en]');
    assertEqual(createPlayer({ nationality: 'ZZ' }).languages, ['en'], 'unknown nationality → [en]');
    // Explicit override sanitizes: lowercased + de-duplicated, order preserved.
    const p = createPlayer({ nationality: 'KR', languages: ['KO', 'en', 'ko', '', 5] });
    assertEqual(p.languages, ['ko', 'en'], 'override lowercased + deduped');
  }

  section('player — traits / tier / archetype validation');
  {
    const p = createPlayer({ traits: ['clutch', 'clutch', 'hothead', 'mentor', 'leader', 'extra'] });
    assertEqual(p.traits, ['clutch', 'hothead', 'mentor', 'leader'], 'traits deduped + capped at 4');
    assertEqual(createPlayer({ tier: 'bogus' }).tier, 't1', 'invalid tier → t1');
    assertEqual(createPlayer({ tier: 'prospect' }).tier, 'prospect', 'valid tier honored');
    assertEqual(createPlayer({ development: { archetype: 'nope' } }).development.archetype, 'normal', 'invalid archetype → normal');
    assertEqual(createPlayer({ development: { archetype: 'wonderkid' } }).development.archetype, 'wonderkid', 'valid archetype honored');
  }

  section('player — scouting band normalization');
  {
    const hidden = createPlayer({ potential: 80, scouting: { potentialLow: 70, potentialHigh: 95, knowledge: 30 } });
    assertEqual(hidden.scouting, { potentialLow: 70, potentialHigh: 95, knowledge: 30 }, 'explicit band honored');
    // low/high swapped → normalized; knowledge clamps 0..100.
    const swapped = createPlayer({ potential: 60, scouting: { potentialLow: 90, potentialHigh: 50, knowledge: 250 } });
    assertEqual(swapped.scouting, { potentialLow: 50, potentialHigh: 90, knowledge: 100 }, 'low<=high enforced + knowledge clamped');
  }

  section('team — new field defaults & clamps');
  {
    const t = createTeam({ name: 'PRX' });
    assertEqual(t.region, null, 'region defaults null');
    assertEqual(t.tier, 't1', 'tier defaults t1');
    assertEqual(t.chemistry, 50, 'chemistry defaults 50');
    assertEqual(t.coachId, null, 'coachId defaults null');
    const t2 = createTeam({ region: 'pacific', tier: 't2', chemistry: 250, coachId: 'coach_1' });
    assertEqual(t2.region, 'pacific', 'region honored');
    assertEqual(t2.tier, 't2', 'tier honored');
    assertEqual(t2.chemistry, 100, 'chemistry clamped to 100');
    assertEqual(t2.coachId, 'coach_1', 'coachId honored');
    assertEqual(createTeam({ chemistry: -5 }).chemistry, 0, 'negative chemistry clamped to 0');
    assertEqual(createTeam({ tier: 'prospect' }).tier, 't1', 'invalid team tier → t1');
  }

  section('languagesFor helper');
  {
    assertEqual(languagesFor('cn'), ['zh'], 'case-insensitive lookup');
    assert(languagesFor('CN') !== NATIONALITY_LANGUAGE.CN, 'returns a fresh array, not the frozen source');
  }

  section('buildWorld — regions + languages stamped on the real seed');
  {
    const world = buildWorld();
    const teams = Object.values(world.teamsById);
    const players = Object.values(world.playersById);
    for (const t of teams) {
      assert(['pacific', 'americas', 'emea', 'china'].includes(t.region), `team ${t.id} has a region`);
      assertEqual(t.tier, 't1', `team ${t.id} is t1`);
      assert(t.chemistry >= 0 && t.chemistry <= 100, `team ${t.id} chemistry in range`);
    }
    for (const p of players) {
      assert(Array.isArray(p.languages) && p.languages.length > 0, `player ${p.id} has languages`);
      assertEqual(p.tier, 't1', `seed player ${p.id} is t1`);
      assertEqual(p.scouting.knowledge, 100, `seed player ${p.id} fully scouted`);
    }
    // Every CN player communicates in Chinese (a same-language scene).
    const cnTeam = teams.find((t) => t.region === 'china');
    const cnPlayers = cnTeam.roster.map((id) => world.playersById[id]);
    assert(cnPlayers.every((p) => p.languages.includes('zh')), 'China roster all speak zh');
  }
}
