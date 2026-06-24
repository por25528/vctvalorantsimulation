/**
 * ui/screens/Standings.js — the Standings screen (CONTRACTS-UI §5, id 'standings').
 *
 * Pure `(state, dispatch) => VNode`. Renders the group/swiss standings + final
 * placements for ANY played event (every league + every international event),
 * chosen via the EventPicker (route param `eventId`, defaulting to the followed
 * team's latest event). The group stages come from the event's format
 * (`groupStagesOf`): Group A/B for Kickoff & Stage, the Swiss for Masters &
 * Champions. During a slot's day-by-day reveal the event is spoiler-gated —
 * group records fill in match-day by match-day and final placements appear only
 * once the event completes.
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { StandingsTable } from '../components/StandingsTable.js';
import { EventPicker } from '../components/EventPicker.js';
import {
  selectRoute,
  selectStandings,
  selectPlacements,
  selectEvent,
  selectFollowedTeam,
  selectTeam,
  selectPlayedEvents,
  selectDefaultEventId
} from '../../state/selectors.js';
import { groupStagesOf, eventLabel } from '../eventFormats.js';

/** The screen id (route key) this screen serves. */
export const SCREEN_ID = 'standings';

/**
 * Qualification slot → human badge label + class modifier.
 * @type {Record<string,{label:string, mod:string}>}
 */
const QUAL_BADGE = {
  'masters-playoff': { label: 'Masters Playoff', mod: 'playoff' },
  'masters-swiss': { label: 'Masters Swiss', mod: 'swiss' }
};

/**
 * The Standings screen.
 * @param {object} state  the full store state
 * @param {(action:object)=>void} dispatch
 * @returns {*} VNode
 */
export function StandingsScreen(state, dispatch) {
  const route = selectRoute(state);
  const params = (route && route.params) || {};
  const events = selectPlayedEvents(state);
  const eventId =
    params.eventId && events.some((e) => e.eventId === params.eventId)
      ? params.eventId
      : selectDefaultEventId(state);
  const event = eventId ? selectEvent(state, eventId) : null;
  const entry = events.find((e) => e.eventId === eventId) || null;

  const followed = selectFollowedTeam(state);
  const followedId = followed ? followed.id : null;

  const onPick = (eid) => dispatch(navigate('standings', { eventId: eid }));
  const goTeam = (teamId) => dispatch(navigate('team', { teamId, eventId }));

  if (!event) {
    return h(
      'section',
      { class: 'screen screen--standings' },
      h('h1', { class: 'screen__title' }, 'Standings'),
      EventPicker({ events, activeEventId: eventId, onPick }),
      h('p', { class: 'screen__empty' }, 'No event has been played yet. Hit Continue to play one.')
    );
  }

  const rawGroups = groupStagesOf(event);
  const groups = rawGroups.map((g) => groupSection(state, eventId, g, followedId, goTeam));
  const qualSummary = qualificationSummary(state, eventId, rawGroups, followedId, goTeam);
  const placements = placementsSection(state, eventId, followedId, goTeam);

  return h(
    'section',
    { class: 'screen screen--standings' },
    h(
      'header',
      { class: 'screen__head' },
      h(
        'div',
        null,
        h('h1', { class: 'screen__title' }, 'Standings'),
        h('p', { class: 'screen__subtitle' }, eventLabel(entry))
      )
    ),
    EventPicker({ events, activeEventId: eventId, onPick }),
    qualSummary,
    h('div', { class: 'standings__groups' }, ...groups),
    placements
  );
}

/**
 * An at-a-glance qualification picture above the group tables: per group, the teams
 * currently sitting in the advancing spots (above the cut-line). Only rendered for
 * events whose groups carry an `advancersOut`, and only once some games are played.
 */
function qualificationSummary(state, eventId, rawGroups, followedId, goTeam) {
  const blocks = rawGroups
    .filter((g) => (g.advancersOut || 0) > 0)
    .map((g) => {
      const rows = selectStandings(state, eventId, g.id);
      const played = rows.some((r) => (r.w || 0) + (r.l || 0) > 0);
      const through = played ? rows.filter((r) => r.rank <= g.advancersOut) : [];
      return { group: g, through };
    })
    .filter((b) => b.through.length > 0);

  if (blocks.length === 0) return null;

  return h(
    'section',
    { class: 'panel standings__qual-summary' },
    h(
      'header',
      { class: 'panel__head' },
      h('h2', { class: 'panel__title' }, 'Qualification Picture'),
      h('span', { class: 'panel__sub' }, 'teams currently advancing')
    ),
    h(
      'div',
      { class: 'panel__body standings__qual-grid' },
      blocks.map((b) =>
        h(
          'div',
          { class: 'standings__qual-block', key: b.group.id },
          h('span', { class: 'standings__qual-group' }, `${b.group.label} · top ${b.group.advancersOut}`),
          h(
            'div',
            { class: 'standings__qual-chips' },
            b.through.map((r) =>
              h(
                'button',
                {
                  key: r.teamId,
                  type: 'button',
                  class: classNames('badge', 'badge--qual', 'standings__qual-chip', r.teamId === followedId && 'standings__qual-chip--me'),
                  onClick: goTeam ? () => goTeam(r.teamId) : undefined,
                  title: r.team ? r.team.name : r.teamId
                },
                `${r.rank}. ${r.team ? (r.team.tag || r.team.name) : r.teamId}`
              )
            )
          )
        )
      )
    )
  );
}

/** One group's labeled StandingsTable, with the qualification cut-line marked. */
function groupSection(state, eventId, group, followedId, goTeam) {
  const adv = group.advancersOut || 0;
  const rows = selectStandings(state, eventId, group.id).map((row) => ({
    rank: row.rank,
    teamId: row.teamId,
    teamName: row.team ? row.team.name : row.teamId,
    teamTag: row.team ? row.team.tag : undefined,
    w: row.w,
    l: row.l,
    mapW: row.mapW,
    mapL: row.mapL,
    roundDiff: row.roundDiff,
    me: row.teamId === followedId,
    adv: adv > 0 && row.rank <= adv, // sits above the qualification cut-line
    cut: adv > 0 && row.rank === adv // the last qualifying row (draws the line)
  }));

  return h(
    'div',
    { class: 'standings__group', key: group.id },
    h(
      'div',
      { class: 'standings__group-head' },
      h('h2', { class: 'standings__group-title' }, group.label),
      adv > 0 ? h('span', { class: 'badge badge--qual standings__cut-note' }, `Top ${adv} advance`) : null
    ),
    StandingsTable({ rows, onTeam: goTeam })
  );
}

/** The final placements table: rank · team · losses · CP · qualification badge. */
function placementsSection(state, eventId, followedId, goTeam) {
  const rows = selectPlacements(state, eventId);

  if (!rows.length) {
    return h(
      'div',
      { class: 'standings__placements' },
      h('h2', { class: 'standings__group-title' }, 'Final Placements'),
      h('p', { class: 'screen__empty screen__empty--inline' }, 'Final placements appear once the event is fully played.')
    );
  }

  const body = h(
    'tbody',
    null,
    rows.map((row) => placementRow(state, row, followedId, goTeam))
  );

  const head = h(
    'thead',
    { class: 'table__head' },
    h(
      'tr',
      { class: 'table__row' },
      h('th', { class: 'table__cell', scope: 'col' }, '#'),
      h('th', { class: 'table__cell', scope: 'col' }, 'Team'),
      h('th', { class: 'table__cell table__cell--num', scope: 'col' }, 'Losses'),
      h('th', { class: 'table__cell table__cell--num', scope: 'col' }, 'CP'),
      h('th', { class: 'table__cell', scope: 'col' }, 'Qualification')
    )
  );

  return h(
    'div',
    { class: 'standings__placements' },
    h('h2', { class: 'standings__group-title' }, 'Final Placements'),
    h('table', { class: 'table placements' }, head, body)
  );
}

/** One placement row. */
function placementRow(state, row, followedId, goTeam) {
  const team = selectTeam(state, row.teamId);
  const name = team ? team.name : row.teamId;
  const tag = team ? team.tag : null;
  const me = row.teamId === followedId;

  return h(
    'tr',
    {
      key: String(row.teamId),
      class: classNames('table__row', 'table__row--clickable', me && 'table__row--me'),
      onClick: () => goTeam(row.teamId)
    },
    h('td', { class: 'table__cell placements__rank' }, String(row.rank)),
    h(
      'td',
      { class: 'table__cell placements__team' },
      tag ? h('span', { class: 'badge badge--seed' }, tag) : null,
      ' ',
      name
    ),
    h('td', { class: 'table__cell table__cell--num placements__losses' }, String(row.losses)),
    h('td', { class: 'table__cell table__cell--num placements__cp' }, String(row.cp)),
    h('td', { class: 'table__cell placements__qual' }, qualBadge(row.qual))
  );
}

/** Render the qualification badge for a placement's qual slot (or "Eliminated"). */
function qualBadge(qual) {
  const meta = qual ? QUAL_BADGE[qual] : null;
  if (!meta) {
    return h('span', { class: 'badge badge--qual badge--qual-out' }, 'Eliminated');
  }
  return h('span', { class: classNames('badge', 'badge--qual', `badge--qual-${meta.mod}`) }, meta.label);
}
