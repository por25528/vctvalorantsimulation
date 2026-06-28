/**
 * ui/screens/Player.js — Player screen (CONTRACTS-UI §5 id 'player').
 * Phase 3 (UI shell). PURE (state, dispatch) -> VNode; reads game truth only
 * through selectors and renders headlessly via toHtml (no DOM access here).
 *
 * Resolves a player from `ui.route.params.playerId` via selectPlayer, then
 * shows:
 *   - an AttributeRadar (inline <svg>) of the player's 9 attributes,
 *   - the 9 named attributes as a labelled value list,
 *   - identity meta (role, age, nationality, team),
 *   - the player's per-map box-score lines from the Kickoff event (one row per
 *     map the player appeared in: opponent, map, K/D/A, ACS, ...).
 *
 * The event is taken from `ui.route.params.eventId`, falling back to the
 * Pacific Kickoff (selectKickoff).
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { AttributeRadar, RADAR_AXES } from '../components/AttributeRadar.js';
import { DataTable } from '../components/DataTable.js';
import { RankBadge } from '../components/RankBadge.js';
import { MAPS } from '../../config/maps.js';
import {
  selectRoute,
  selectPlayer,
  selectTeam,
  selectKickoff,
  selectEvent
} from '../../state/selectors.js';
import { mapRating, aggregateRating } from '../../engine/career/rating.js';

/** The screen id (route key) this screen serves. */
export const SCREEN_ID = 'player';

/** Color an HLTV-style rating value by tier. */
function ratingClass(r) {
  const v = Number(r) || 0;
  if (v >= 1.1) return 'rating rating--elite';
  if (v >= 1.0) return 'rating rating--good';
  if (v < 0.95) return 'rating rating--low';
  return 'rating';
}

/** mapId -> display name, derived once from the config pool. */
const MAP_NAME = Object.freeze(
  MAPS.reduce((acc, m) => {
    acc[m.id] = m.name;
    return acc;
  }, {})
);

/** Pretty map name (falls back to the raw id). */
function mapName(id) {
  return (id && MAP_NAME[id]) || id || '?';
}

/** Normalize KAST to a 0-100 percent (engine stores it as a 0-1 fraction). */
function kastPct(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return v <= 1 ? v * 100 : v;
}

/** Round a number to N decimals (deterministic display). */
function round(v, d = 0) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/**
 * The Player screen.
 * @param {object} state  the full store state
 * @param {(action:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
export function PlayerScreen(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const player = params.playerId ? selectPlayer(state, params.playerId) : null;

  if (!player) {
    return h(
      'section',
      { class: 'screen screen--player player player--empty' },
      h('h1', { class: 'screen__title' }, 'Player'),
      h('p', { class: 'screen__empty muted' }, 'No player selected.')
    );
  }

  const kickoff = selectKickoff(state);
  const eventId = params.eventId || (kickoff && kickoff.eventId) || null;
  const event = eventId ? selectEvent(state, eventId) : kickoff;

  const teamId = (player.contract && player.contract.teamId) || params.teamId || null;
  const team = teamId ? selectTeam(state, teamId) : null;

  // The player's per-map box-score lines + the aggregate HLTV Rating 2.0.
  const lines = mapLines(state, player.id, event);
  const agg = aggregateRating(
    lines.map((l) => ({
      stat: { kills: l.kills, deaths: l.deaths, assists: l.assists, kast: l.kast, adr: l.adr },
      rounds: l.rounds
    }))
  );

  return h(
    'section',
    { class: 'screen screen--player player', 'data-player': player.id },
    playerHeader(player, team, dispatch, agg),
    h(
      'div',
      { class: 'player__body' },
      h(
        'div',
        { class: 'player__radar' },
        AttributeRadar({ attributes: player.attributes || {} })
      ),
      attributesList(player.attributes || {})
    ),
    boxScoreSection(lines)
  );
}

/* ----------------------------- header ----------------------------- */

/** Identity header: handle, real name, an event Rating 2.0, role/age/nation, team. */
function playerHeader(player, team, dispatch, agg) {
  const goTeam = team
    ? () => dispatch(navigate('team', { teamId: team.id }))
    : null;
  const goDevelopment = dispatch
    ? () => dispatch(navigate('development', { playerId: player.id }))
    : null;

  return h(
    'header',
    { class: 'player__header' },
    h('h1', { class: 'screen__title player__handle' }, player.handle || player.name || player.id),
    player.name && player.name !== player.handle
      ? h('span', { class: 'player__realname muted' }, player.name)
      : null,
    h(
      'button',
      { type: 'button', class: 'link player__dev-link', onClick: goDevelopment },
      'View development →'
    ),
    h(
      'div',
      { class: 'player__meta' },
      agg && agg.maps > 0
        ? h(
            'span',
            { class: 'player__meta-item player__meta-rating' },
            h('span', { class: 'player__meta-label' }, 'Rating 2.0'),
            h('span', { class: classNames('player__meta-value', ratingClass(agg.rating)) }, agg.rating.toFixed(2))
          )
        : null,
      h(
        'span',
        { class: 'player__meta-item player__meta-rank' },
        h('span', { class: 'player__meta-label' }, 'Rank'),
        RankBadge({ player, showRr: true })
      ),
      metaItem('Role', player.role || '—'),
      metaItem('Age', player.age != null ? String(player.age) : '—'),
      metaItem('Nation', player.nationality || '—'),
      team
        ? h(
            'span',
            { class: 'player__meta-item player__meta-team' },
            h('span', { class: 'player__meta-label' }, 'Team'),
            h(
              'button',
              {
                type: 'button',
                class: 'player__team-link',
                onClick: goTeam
              },
              team.name || team.id
            )
          )
        : null
    )
  );
}

/** A labelled meta item (label + value). */
function metaItem(label, value) {
  return h(
    'span',
    { class: 'player__meta-item' },
    h('span', { class: 'player__meta-label' }, label),
    h('span', { class: 'player__meta-value' }, value)
  );
}

/* --------------------------- attributes --------------------------- */

/** The 9 named attributes as a labelled bar/value list. */
function attributesList(attributes) {
  return h(
    'ul',
    { class: 'player__attrs' },
    RADAR_AXES.map((axis) => {
      const raw = attributes[axis.key];
      const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      const tier = v >= 85 ? 'elite' : v >= 75 ? 'high' : v >= 60 ? 'mid' : 'low';
      return h(
        'li',
        {
          key: axis.key,
          class: classNames('player__attr', `player__attr--${tier}`),
          'data-attr': axis.key
        },
        h('span', { class: 'player__attr-label' }, axis.label),
        h(
          'span',
          { class: 'player__attr-bar' },
          h('span', {
            class: 'player__attr-fill',
            style: { width: `${Math.max(0, Math.min(100, v))}%` }
          })
        ),
        h('span', { class: 'player__attr-value' }, String(round(v)))
      );
    })
  );
}

/* ---------------------------- box score --------------------------- */

/** The player's per-map box-score lines across the event (precomputed). */
function boxScoreSection(lines) {
  if (lines.length === 0) {
    return h(
      'div',
      { class: 'player__boxscore player__boxscore--empty' },
      h('h2', { class: 'player__section-title' }, 'Event Box Scores'),
      h('p', { class: 'screen__empty screen__empty--inline muted' }, 'No maps played in this event.')
    );
  }

  const columns = [
    { key: 'opp', label: 'Opponent' },
    { key: 'map', label: 'Map' },
    { key: 'res', label: 'Result' },
    { key: 'rat', label: 'RAT', numeric: true, render: (r) => h('span', { class: ratingClass(r.rat) }, (Number(r.rat) || 0).toFixed(2)) },
    { key: 'kda', label: 'K / D / A', render: (r) => `${r.kills} / ${r.deaths} / ${r.assists}` },
    { key: 'acs', label: 'ACS', numeric: true, render: (r) => String(round(r.acs)) },
    { key: 'adr', label: 'ADR', numeric: true, render: (r) => String(round(r.adr)) },
    { key: 'kast', label: 'KAST', numeric: true, render: (r) => `${round(kastPct(r.kast))}%` },
    { key: 'fb', label: 'FB', numeric: true, render: (r) => String(r.firstBloods) },
    { key: 'cl', label: 'CL', numeric: true, render: (r) => String(r.clutches) },
    { key: 'kd', label: 'KD', numeric: true, render: (r) => String(round(r.kd, 2)) }
  ];

  return h(
    'div',
    { class: 'player__boxscore' },
    h('h2', { class: 'player__section-title' }, 'Event Box Scores'),
    DataTable({
      columns,
      rows: lines,
      rowKey: (r) => r.key,
      class: 'boxscore-lines'
    })
  );
}

/**
 * Collect the player's per-map box-score lines from an event.
 * @param {object} state
 * @param {string} playerId
 * @param {object|null} event  EventResult
 * @returns {object[]}
 */
function mapLines(state, playerId, event) {
  if (!event) return [];
  const out = [];
  for (const series of event.series || []) {
    const onA = (series.teamAId && playerOnTeam(state, playerId, series.teamAId));
    const side = onA ? 'A' : 'B';
    const oppId = onA ? series.teamBId : series.teamAId;
    const opp = selectTeam(state, oppId);
    const oppName = (opp && (opp.tag || opp.name)) || oppId;

    (series.maps || []).forEach((map, mi) => {
      const stat = map.boxScore && map.boxScore[playerId];
      if (!stat) return;
      const score = map.score || { A: 0, B: 0 };
      const my = side === 'A' ? score.A : score.B;
      const their = side === 'A' ? score.B : score.A;
      const rounds = (score.A || 0) + (score.B || 0);
      const won = map.winner === side;
      out.push({
        key: `${series.id}:${mi}`,
        opp: oppName,
        map: mapName(map.mapId),
        res: `${won ? 'W' : 'L'} ${my}-${their}`,
        rounds,
        rat: mapRating(stat, rounds),
        kills: stat.kills || 0,
        deaths: stat.deaths || 0,
        assists: stat.assists || 0,
        acs: stat.acs || 0,
        adr: stat.adr || 0,
        kast: stat.kast || 0,
        firstBloods: stat.firstBloods || 0,
        clutches: stat.clutches || 0,
        kd: typeof stat.kd === 'number' ? stat.kd : 0
      });
    });
  }
  return out;
}

/** True if the player id appears on the team's roster. */
function playerOnTeam(state, playerId, teamId) {
  const team = selectTeam(state, teamId);
  return !!(team && (team.roster || []).includes(playerId));
}
