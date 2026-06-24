/**
 * tests/unit/domain.test.mjs — unit tests for domain factories (CONTRACTS §7, §14).
 *
 * Covers createPlayer (terse construction, attribute clamping, default dynamics/
 * proficiency), createTeam (default filling), createLeague, and the createEvent
 * stub. Default export is an async fn that throws on failure (CONTRACTS §14).
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { createLeague } from '../../src/domain/league.js';
import { createEvent } from '../../src/domain/event.js';

const ATTRIBUTE_KEYS = ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl'];

/** @returns {Promise<void>} */
export default async function run() {
  section('domain.createPlayer — terse construction');
  {
    const p = createPlayer({ name: 'x', role: 'Duelist' });

    assertEqual(p.name, 'x', 'name preserved');
    assertEqual(p.role, 'Duelist', 'role preserved');
    assert(typeof p.id === 'string' && p.id.length > 0, 'id filled');
    assert(typeof p.handle === 'string' && p.handle.length > 0, 'handle filled');
    assert(typeof p.nationality === 'string', 'nationality filled');
    assert(typeof p.age === 'number', 'age filled');

    // Attributes: present, numeric, and clamped within 0..100.
    for (const k of ATTRIBUTE_KEYS) {
      assert(typeof p.attributes[k] === 'number', `attribute ${k} is a number`);
      assert(p.attributes[k] >= 0 && p.attributes[k] <= 100, `attribute ${k} clamped 0..100`);
    }
    assert(Object.keys(p.attributes).length === ATTRIBUTE_KEYS.length, 'exactly the 9 attributes present');

    // Dynamics default { form:0, morale:60, fatigue:0 }.
    assertEqual(p.dynamics, { form: 0, morale: 60, fatigue: 0 }, 'default dynamics');

    // Development / contract defaulted.
    assert(typeof p.development.peakAge === 'number', 'development.peakAge filled');
    assert(typeof p.development.declineAge === 'number', 'development.declineAge filled');
    assertEqual(p.contract.status, 'active', 'default contract status');
    assertEqual(p.contract.teamId, null, 'default contract teamId null');

    // Potential filled and clamped.
    assert(p.potential >= 0 && p.potential <= 100, 'potential clamped 0..100');

    // Proficiency: maps default to empty, except primary role is seeded.
    assert(p.proficiency && typeof p.proficiency === 'object', 'proficiency object present');
    assert('Duelist' in p.proficiency.roles, 'primary role seeded in proficiency.roles');
    assert(p.proficiency.roles.Duelist >= 0 && p.proficiency.roles.Duelist <= 100, 'role proficiency clamped');
    assertEqual(p.proficiency.agents, {}, 'agents proficiency defaults empty');
    assertEqual(p.proficiency.maps, {}, 'maps proficiency defaults empty');
  }

  section('domain.createPlayer — out-of-range attributes clamp');
  {
    const p = createPlayer({
      name: 'clamp',
      role: 'Sentinel',
      attributes: { aim: 9999, movement: -50, reaction: 100, composure: 0 },
      potential: 250,
      dynamics: { form: 9000, morale: -10, fatigue: 9999 }
    });

    assertEqual(p.attributes.aim, 100, 'aim clamped to 100');
    assertEqual(p.attributes.movement, 0, 'movement clamped to 0');
    assertEqual(p.attributes.reaction, 100, 'reaction at bound stays 100');
    assertEqual(p.attributes.composure, 0, 'composure at bound stays 0');
    assertEqual(p.potential, 100, 'potential clamped to 100');

    assertEqual(p.dynamics.form, 100, 'form clamped to 100');
    assertEqual(p.dynamics.morale, 0, 'morale clamped to 0');
    assertEqual(p.dynamics.fatigue, 100, 'fatigue clamped to 100');

    // Unprovided attributes still receive role-appropriate, in-range defaults.
    assert(p.attributes.utility >= 0 && p.attributes.utility <= 100, 'unprovided utility defaulted in range');
  }

  section('domain.createPlayer — unknown role falls back, immutability');
  {
    const p = createPlayer({ name: 'y', role: 'NotARole' });
    assert(p.role !== 'NotARole', 'unknown role replaced with a valid default');
    assert(['Duelist', 'Initiator', 'Controller', 'Sentinel'].includes(p.role), 'fallback role is valid');

    // Each call yields a fresh object (immutability of factory output).
    const a = createPlayer({ name: 'z', role: 'Initiator' });
    const b = createPlayer({ name: 'z', role: 'Initiator' });
    assert(a !== b, 'distinct object instances');
    assert(a.attributes !== b.attributes, 'distinct nested attribute objects');
    assertEqual(a, b, 'equal-value players from equal input');

    // Mutating input attributes afterward must not affect the produced player.
    const input = { name: 'iso', role: 'Duelist', attributes: { aim: 50 } };
    const made = createPlayer(input);
    input.attributes.aim = 1;
    assertEqual(made.attributes.aim, 50, 'factory copied attributes (no shared reference)');
  }

  section('domain.createTeam — defaults filled');
  {
    const t = createTeam({ name: 'Paper Rex' });
    assertEqual(t.name, 'Paper Rex', 'name preserved');
    assert(typeof t.id === 'string' && t.id.length > 0, 'id filled');
    assert(typeof t.tag === 'string' && t.tag.length > 0, 'tag filled');
    assert(t.leagueId === null || typeof t.leagueId === 'string', 'leagueId defaulted');
    assert(Array.isArray(t.roster), 'roster is an array');
    assert(t.reputation >= 0 && t.reputation <= 100, 'reputation clamped 0..100');
    assert(typeof t.budget === 'number' && t.budget >= 0, 'budget filled, non-negative');
    assertEqual(t.championshipPoints, 0, 'championshipPoints default 0');

    // Out-of-range / dirty inputs normalized.
    const t2 = createTeam({ name: 'X', tag: 'XYZ', reputation: 500, budget: -5, championshipPoints: -3, roster: ['p1', '', 7, 'p2'] });
    assertEqual(t2.reputation, 100, 'reputation clamped to 100');
    assertEqual(t2.budget, 0, 'negative budget clamped to 0');
    assertEqual(t2.championshipPoints, 0, 'negative CP clamped to 0');
    assertEqual(t2.roster, ['p1', 'p2'], 'roster filtered to non-empty string ids');
  }

  section('domain.createLeague — defaults filled');
  {
    const l = createLeague({ name: 'Pacific', region: 'pacific', teamIds: ['team_PRX', '', 5] });
    assertEqual(l.name, 'Pacific', 'name preserved');
    assertEqual(l.region, 'pacific', 'region preserved');
    assert(typeof l.id === 'string' && l.id.length > 0, 'id filled');
    assertEqual(l.teamIds, ['team_PRX'], 'teamIds filtered to non-empty string ids');

    const l2 = createLeague();
    assert(typeof l2.region === 'string' && l2.region.length > 0, 'region defaulted with no input');
    assertEqual(l2.teamIds, [], 'teamIds default empty');
  }

  section('domain.createEvent — stub fully-formed');
  {
    const e = createEvent({ name: 'Kickoff', type: 'kickoff', participants: ['team_PRX', 'team_DRX'] });
    assertEqual(e.name, 'Kickoff', 'name preserved');
    assertEqual(e.type, 'kickoff', 'type preserved');
    assert(typeof e.id === 'string' && e.id.length > 0, 'id filled');
    assertEqual(e.status, 'pending', 'default status pending');
    assertEqual(e.participants, ['team_PRX', 'team_DRX'], 'participants preserved');
    assert(Array.isArray(e.standings), 'standings is an array');

    const e2 = createEvent();
    assert(['kickoff', 'stage', 'masters', 'champions'].includes(e2.type), 'default type valid');
  }
}
