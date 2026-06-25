/**
 * ui/screens/Scouting.js — trait discovery & prospect evaluation (id 'scouting').
 *
 * Pure `(state, dispatch, store) => VNode`. Shows players grouped by status
 * (your squad → free agents → contracted elsewhere) with each player's known
 * traits displayed by name and still-hidden traits shown as "???" slots.
 *
 * The manager may spend up to MAX_SCOUT_FOCUSES per season. Each focus
 * accelerates hidden-trait reveal for that player; three cumulative seasons of
 * focus fully reveals all traits (see engine/career/scouting.js).
 *
 * Non-hidden traits (clutch, workhorse, mentor, …) are always visible.
 * Hidden traits (choker, volatile, earlyPeak, hothead, …) surface as:
 *   - Known by name once (naturalExposure + scoutBonus) ≥ revealThreshold
 *   - "???" until then — count visible so the manager knows something lurks
 */

import { h, classNames } from '../render.js';
import { navigate } from '../../state/actions.js';
import { scoutPlayer } from '../../state/commands.js';
import { TRAIT_DEFS } from '../../engine/career/traits.js';
import { MAX_SCOUT_FOCUSES } from '../../engine/career/scouting.js';
import {
  selectFollowedTeam,
  selectSeasonIndex,
  selectScoutFocusesUsedThisSeason,
  selectPlayerFocusCount,
  selectRevealedTraits
} from '../../state/selectors.js';

const ATTR_KEYS = ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl'];

function overall(p) {
  const a = (p && p.attributes) || {};
  let sum = 0;
  let n = 0;
  for (const k of ATTR_KEYS) {
    if (typeof a[k] === 'number') { sum += a[k]; n += 1; }
  }
  return n > 0 ? Math.round(sum / n) : 0;
}

/** 'chem' → 'Chemistry', 'duel' → 'Combat', 'dev' → 'Development' */
const KIND_LABEL = { chem: 'Chemistry', duel: 'Combat', dev: 'Development' };

/** Return kind-coloured CSS class for a trait badge. */
function traitClass(traitId) {
  const def = TRAIT_DEFS[traitId];
  if (!def) return 'scouting__trait';
  return classNames('scouting__trait', `scouting__trait--${def.kind}`);
}

/**
 * @param {object} state
 * @param {(action:object) => void} [dispatch]
 * @param {object} [store]
 * @returns {import('../render.js').VNode}
 */
export function Scouting(state, dispatch, store) {
  const team = selectFollowedTeam(state);
  const seasonIndex = selectSeasonIndex(state);
  const focusesUsed = selectScoutFocusesUsedThisSeason(state);
  const focusesLeft = MAX_SCOUT_FOCUSES - focusesUsed;

  const go = (screen, params) => dispatch && dispatch(navigate(screen, params || {}));
  const doScout = (playerId) => store && scoutPlayer(store, playerId);

  const players = Object.values((state.world && state.world.players) || {});

  // Split into three groups: our squad, free agents, contracted elsewhere.
  const teamId = team ? team.id : null;
  const squadIds = new Set((team && team.roster) || []);

  const squadPlayers = [];
  const freeAgents = [];
  const contracted = [];

  for (const p of players) {
    const c = p && p.contract;
    if (!c) continue;
    if (squadIds.has(p.id)) {
      squadPlayers.push(p);
    } else if (c.status === 'free_agent') {
      freeAgents.push(p);
    } else {
      contracted.push(p);
    }
  }

  // Sort each group by overall desc
  const byOverall = (a, b) => overall(b) - overall(a);
  squadPlayers.sort(byOverall);
  freeAgents.sort(byOverall);
  contracted.sort(byOverall);

  return h(
    'section',
    { class: 'screen screen--scouting', id: 'screen-scouting' },
    h(
      'header',
      { class: 'screen__head' },
      h('h1', { class: 'screen__title' }, 'Scouting'),
      h(
        'div',
        { class: 'scouting__meta' },
        h(
          'span',
          { class: classNames('badge', focusesLeft > 0 ? 'badge--info' : 'badge--muted') },
          `${focusesLeft} / ${MAX_SCOUT_FOCUSES} focuses remaining this season`
        )
      )
    ),
    h(
      'p',
      { class: 'scouting__intro' },
      'Hidden traits are revealed over time as players accumulate experience, or faster when you actively scout them. ',
      h('strong', null, '???'),
      ' slots mean the player has unrevealed hidden traits.'
    ),

    playerGroup('Your Squad', squadPlayers, state, go, doScout, seasonIndex, focusesLeft),
    playerGroup('Free Agents', freeAgents, state, go, doScout, seasonIndex, focusesLeft),
    playerGroup('Contracted Elsewhere', contracted.slice(0, 60), state, go, doScout, seasonIndex, focusesLeft, true)
  );
}

/**
 * Render a group of players as a collapsible section with a trait table.
 */
function playerGroup(title, players, state, go, doScout, seasonIndex, focusesLeft, compact) {
  if (!players.length) return null;

  const rows = players.map((p) =>
    playerRow(p, state, go, doScout, seasonIndex, focusesLeft)
  );

  return h(
    'section',
    { class: 'scouting__group' },
    h('h2', { class: 'scouting__group-title' }, `${title} (${players.length}${compact ? ', top 60' : ''})`),
    h(
      'table',
      { class: 'data-table scouting__table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', null, 'Player'),
          h('th', null, 'Role'),
          h('th', null, 'Age'),
          h('th', null, 'OVR'),
          h('th', null, 'Team'),
          h('th', null, 'Known Traits'),
          h('th', null, 'Scout')
        )
      ),
      h('tbody', null, rows)
    )
  );
}

/** One player row. */
function playerRow(p, state, go, doScout, seasonIndex, focusesLeft) {
  const { known, hiddenCount } = selectRevealedTraits(state, p.id);
  const focusSeasons = selectPlayerFocusCount(state, p.id);
  const focuses = (state.scouting && state.scouting.focuses) || [];
  const scoutedThisSeason = focuses.some((f) => f.playerId === p.id && f.seasonIndex === seasonIndex);

  const c = p.contract || {};
  const tid = c.teamId || null;
  const teamName = tid && state.world && state.world.teams && state.world.teams[tid]
    ? (state.world.teams[tid].tag || state.world.teams[tid].name)
    : (c.status === 'free_agent' ? 'FA' : '—');

  // Build trait chips: known named + hidden ??? slots
  const traitChips = [
    ...known.map((id) => {
      const def = TRAIT_DEFS[id];
      return h(
        'span',
        {
          key: id,
          class: traitClass(id),
          title: def ? `${def.label} — ${def.blurb}` : id
        },
        def ? def.label : id
      );
    }),
    ...Array.from({ length: hiddenCount }, (_, i) =>
      h('span', { key: `hidden-${i}`, class: 'scouting__trait scouting__trait--hidden', title: 'Unknown hidden trait' }, '???')
    )
  ];

  const canScout = !scoutedThisSeason && focusesLeft > 0;

  return h(
    'tr',
    { key: p.id, class: 'scouting__row' },
    h(
      'td',
      null,
      h(
        'button',
        { type: 'button', class: 'link scouting__name', onClick: () => go('player', { playerId: p.id }) },
        p.handle || p.name
      ),
      focusSeasons > 0
        ? h('span', { class: 'scouting__focus-badge', title: `Scouted ${focusSeasons} season${focusSeasons > 1 ? 's' : ''}` }, `×${focusSeasons}`)
        : null
    ),
    h('td', null, p.role || '—'),
    h('td', null, String(p.age || '?')),
    h('td', { class: 'scouting__ovr' }, String(overall(p))),
    h('td', { class: 'scouting__team' }, teamName),
    h('td', { class: 'scouting__traits' }, traitChips.length ? traitChips : h('span', { class: 'card__muted' }, 'None')),
    h(
      'td',
      null,
      h(
        'button',
        {
          type: 'button',
          class: classNames('btn btn--sm', scoutedThisSeason ? 'btn--muted' : 'btn--primary'),
          disabled: !canScout,
          title: scoutedThisSeason
            ? 'Already scouting this season'
            : focusesLeft === 0
              ? 'No scouting focuses remaining this season'
              : `Scout ${p.handle || p.name} this season`,
          onClick: canScout && doScout ? () => doScout(p.id) : undefined
        },
        scoutedThisSeason ? 'Scouting' : 'Scout'
      )
    )
  );
}
