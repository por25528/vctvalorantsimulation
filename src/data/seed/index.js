/**
 * data/seed/index.js — buildWorld(): merge all four REGION_SEEDs into one World
 * (CONTRACTS-SEASON §1).
 *
 * The four region fixtures (pacific / americas / emea / china) each export
 * `{ league, teams:[12], players:[60] }`. buildWorld normalizes every partial
 * through the domain factories (createLeague / createTeam / createPlayer) and
 * assembles a single immutable World:
 *
 *   World { leagues:Record<region,League>, teamsById:Record<id,Team> (48),
 *           playersById:Record<id,Player> (240) }
 *
 * Team and player ids are globally unique across regions (pacific keeps its bare
 * ids; the other regions prefix-namespace — e.g. na-sen, eu-fnc, cn-edg). A
 * duplicate id across regions is a seed-data error and throws.
 *
 * Pure, deterministic, named export only. No randomness, no I/O, no DOM; runs
 * unchanged in Node and the browser. The returned World and all nested records
 * are frozen — inputs are never mutated.
 */

import { createLeague } from '../../domain/league.js';
import { createTeam } from '../../domain/team.js';
import { createPlayer } from '../../domain/player.js';

import { PACIFIC_SEED } from './pacific.js';
import { AMERICAS_SEED } from './americas.js';
import { EMEA_SEED } from './emea.js';
import { CHINA_SEED } from './china.js';

/**
 * The four region seeds, in fixed region order. The object key is the canonical
 * region name and becomes the key into World.leagues.
 * @type {Array<{ region:string, seed:{ league:object, teams:object[], players:object[] } }>}
 */
const REGION_SEEDS = Object.freeze([
  { region: 'pacific', seed: PACIFIC_SEED },
  { region: 'americas', seed: AMERICAS_SEED },
  { region: 'emea', seed: EMEA_SEED },
  { region: 'china', seed: CHINA_SEED }
]);

/**
 * @typedef {import('../../domain/league.js').League} League
 * @typedef {import('../../domain/team.js').Team} Team
 * @typedef {import('../../domain/player.js').Player} Player
 *
 * @typedef {Object} World
 * @property {Record<string, League>} leagues       keyed by region
 * @property {Record<string, Team>} teamsById       48 teams, globally-unique ids
 * @property {Record<string, Player>} playersById   240 players, globally-unique ids
 */

/**
 * Build the full 2026 World from the four league seed fixtures.
 *
 * @returns {World} frozen World { leagues, teamsById (48), playersById (240) }
 */
export function buildWorld() {
  /** @type {Record<string, League>} */
  const leagues = {};
  /** @type {Record<string, Team>} */
  const teamsById = {};
  /** @type {Record<string, Player>} */
  const playersById = {};

  for (const { region, seed } of REGION_SEEDS) {
    const league = createLeague(seed.league);
    leagues[league.region] = Object.freeze(league);

    for (const teamPartial of seed.teams) {
      // P12: stamp the team's home region from its league (seed teams omit it),
      // unless the fixture already specifies one. Tier defaults to 't1'.
      const team = createTeam({ region: league.region, ...teamPartial });
      if (teamsById[team.id]) {
        throw new Error(`buildWorld: duplicate team id '${team.id}' (region '${region}')`);
      }
      teamsById[team.id] = Object.freeze(team);
    }

    for (const playerPartial of seed.players) {
      const player = createPlayer(playerPartial);
      if (playersById[player.id]) {
        throw new Error(`buildWorld: duplicate player id '${player.id}' (region '${region}')`);
      }
      playersById[player.id] = Object.freeze(player);
    }
  }

  return Object.freeze({
    leagues: Object.freeze(leagues),
    teamsById: Object.freeze(teamsById),
    playersById: Object.freeze(playersById)
  });
}
