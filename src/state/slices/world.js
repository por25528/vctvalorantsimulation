/**
 * state/slices/world.js — reducer slice for the mutable game world.
 * Responsibility: hold { leagues, teams, players } keyed by id, with simple
 * set/replace actions. Pure reducer (state, action) -> new state (CONTRACTS §12).
 * Immutable updates only; never mutates input.
 *
 * @typedef {Object} WorldState
 * @property {Record<string, object>} leagues
 * @property {Record<string, object>} teams
 * @property {Record<string, object>} players
 */

import { produce } from '../../core/produce.js';

/** Action type constants. */
export const WORLD_REPLACE = 'world/replace';
export const WORLD_SET_LEAGUE = 'world/setLeague';
export const WORLD_SET_TEAM = 'world/setTeam';
export const WORLD_SET_PLAYER = 'world/setPlayer';

/** @type {WorldState} */
export const initialWorldState = Object.freeze({
  leagues: {},
  teams: {},
  players: {}
});

/** Replace the entire world (e.g. on load/seed). @param {WorldState} world */
export const replaceWorld = (world) => ({ type: WORLD_REPLACE, world });
/** Upsert one league. */
export const setLeague = (league) => ({ type: WORLD_SET_LEAGUE, league });
/** Upsert one team. */
export const setTeam = (team) => ({ type: WORLD_SET_TEAM, team });
/** Upsert one player. */
export const setPlayer = (player) => ({ type: WORLD_SET_PLAYER, player });

/**
 * World reducer.
 * @param {WorldState} [state]
 * @param {{type:string, [k:string]:*}} action
 * @returns {WorldState}
 */
export function worldReducer(state = initialWorldState, action) {
  switch (action.type) {
    case WORLD_REPLACE: {
      const w = action.world || {};
      return {
        leagues: w.leagues || {},
        teams: w.teams || {},
        players: w.players || {}
      };
    }
    case WORLD_SET_LEAGUE:
      return produce(state, (d) => {
        d.leagues = { ...d.leagues, [action.league.id]: action.league };
      });
    case WORLD_SET_TEAM:
      return produce(state, (d) => {
        d.teams = { ...d.teams, [action.team.id]: action.team };
      });
    case WORLD_SET_PLAYER:
      return produce(state, (d) => {
        d.players = { ...d.players, [action.player.id]: action.player };
      });
    default:
      return state;
  }
}
