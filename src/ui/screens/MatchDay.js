/**
 * ui/screens/MatchDay.js — the day-by-day "Match Day" screen (id 'matchday').
 *
 * The landing view after each Continue: it shows the games played on the current
 * revealed match-day, grouped by region (the followed team's region first), each
 * clickable through to the Match screen (with the live round-by-round playback).
 * Continue / Sim-event controls advance the reveal without leaving the screen.
 *
 * Pure `(state, dispatch, store) => VNode`; renders headlessly via toHtml (the
 * command calls only fire from event handlers at interaction time).
 */

import { h, classNames } from '../render.js';
import { openSeries, continueSeason } from '../../state/commands.js';
import {
  selectCurrentMatchDay,
  selectMatchDaySeries,
  selectRevealSlotId,
  selectRevealDay,
  selectRevealTotalDays,
  selectFollowedTeam
} from '../../state/selectors.js';

/** Screen id (route key). */
export const id = 'matchday';

const SLOT_LABELS = {
  kickoff: 'Kickoff',
  m0: 'Masters One',
  stage1: 'Stage 1',
  m1: 'Masters Two',
  stage2: 'Stage 2',
  m2: 'Masters Three',
  stage3: 'Stage 3',
  champions: 'Champions'
};
const REGION_LABELS = { pacific: 'Pacific', americas: 'Americas', emea: 'EMEA', china: 'China' };

/** The region (league key) a team belongs to, or null. */
function regionOfTeam(state, teamId) {
  const leagues = (state.world && state.world.leagues) || {};
  for (const region of Object.keys(leagues)) {
    const ids = (leagues[region] && leagues[region].teamIds) || [];
    if (Array.isArray(ids) && ids.includes(teamId)) return region;
  }
  return null;
}

/**
 * The Match Day screen.
 * @param {object} state
 * @param {(action:object)=>void} dispatch
 * @param {object} [store]
 * @returns {*} VNode
 */
export function MatchDayScreen(state, dispatch, store) {
  const day = selectCurrentMatchDay(state);
  const slotId = selectRevealSlotId(state);

  if (!day || !slotId) {
    return h(
      'section',
      { class: 'screen screen--matchday matchday' },
      h('h1', { class: 'screen__title' }, 'Match Day'),
      h('p', { class: 'screen__empty' }, 'No match day in progress — hit Continue to begin the season.')
    );
  }

  const dayIdx = selectRevealDay(state);
  const total = selectRevealTotalDays(state);
  const followed = selectFollowedTeam(state);
  const followedRegion = followed ? regionOfTeam(state, followed.id) : null;
  const followedId = followed ? followed.id : null;
  const spoilerFree = state.ui ? state.ui.spoilerFree !== false : true;

  // Minimal store facade for the command layer (matches the Bracket screen).
  const realStore = store || { getState: () => state, dispatch };
  const onOpen = (seriesId) => seriesId && openSeries(realStore, seriesId);
  const onContinue = () => continueSeason(realStore);
  const onSim = () => continueSeason(realStore, { simEvent: true });
  const isLastDay = dayIdx >= total - 1;

  // Group the day's games by region (followed region first; international last).
  const games = selectMatchDaySeries(state).filter((g) => g.series);
  const groups = new Map();
  for (const g of games) {
    const key = g.ref.region || '_intl';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  const order = [...groups.keys()].sort((a, b) => {
    if (a === followedRegion) return -1;
    if (b === followedRegion) return 1;
    if (a === '_intl') return 1;
    if (b === '_intl') return -1;
    return a.localeCompare(b);
  });

  return h(
    'section',
    { class: 'screen screen--matchday matchday' },
    h(
      'div',
      { class: 'screen__head matchday__head' },
      h(
        'div',
        null,
        h('h1', { class: 'screen__title' }, `${SLOT_LABELS[slotId] || slotId} — Day ${dayIdx + 1} / ${total}`),
        h('p', { class: 'screen__subtitle' }, day.label)
      ),
      h(
        'div',
        { class: 'matchday__actions row' },
        !isLastDay
          ? h('button', { type: 'button', class: 'btn btn--ghost', onClick: onSim }, '⏭ Sim event')
          : null,
        h('button', { type: 'button', class: 'btn btn--primary', onClick: onContinue }, isLastDay ? 'Continue' : 'Advance day')
      )
    ),
    spoilerFree
      ? h('p', { class: 'matchday__hint muted' }, '🙈 Spoiler-free — scores are hidden. Click a fixture to watch it play out live.')
      : null,
    order.map((key) =>
      regionGroup(key, groups.get(key), slotId, followedId, onOpen, spoilerFree)
    )
  );
}

/** One region's block of the day's games. */
function regionGroup(key, games, slotId, followedId, onOpen, spoilerFree) {
  const label = key === '_intl' ? (SLOT_LABELS[slotId] || 'International') : (REGION_LABELS[key] || key);
  return h(
    'div',
    { class: 'matchday__region', key },
    h('h2', { class: 'matchday__region-title' }, label),
    h(
      'ul',
      { class: 'matchday__games' },
      games.map((g) => gameRow(g, followedId, onOpen, spoilerFree))
    )
  );
}

/** One clickable game row: team A · score · team B (scores hidden when spoiler-free). */
function gameRow(g, followedId, onOpen, spoilerFree) {
  const s = g.series;
  const score = s.score || { A: 0, B: 0 };
  const aWon = s.winnerId === s.teamAId;
  const isMine = s.teamAId === followedId || s.teamBId === followedId;
  const nameOf = (team, tid) => (team && (team.tag || team.name)) || tid;

  // Spoiler-free: never reveal the winner via emphasis, and swap the score for a
  // "watch" prompt. Otherwise show the final scoreline with the winner emphasised.
  const scoreCell = spoilerFree
    ? h('span', { class: 'matchday__game-score matchday__game-score--hidden' }, h('span', { class: 'matchday__watch' }, '▶ Watch'))
    : h(
        'span',
        { class: 'matchday__game-score' },
        h('span', { class: classNames(aWon && 'matchday__score--won') }, String(score.A)),
        h('span', { class: 'matchday__score-sep' }, '–'),
        h('span', { class: classNames(!aWon && 'matchday__score--won') }, String(score.B))
      );

  return h(
    'li',
    { key: s.id, class: 'matchday__game-item' },
    h(
      'button',
      {
        type: 'button',
        class: classNames('matchday__game', isMine && 'matchday__game--mine'),
        onClick: () => onOpen(s.id)
      },
      h('span', { class: classNames('matchday__team', 'matchday__team--a', !spoilerFree && aWon && 'matchday__team--won') }, nameOf(g.teamA, s.teamAId)),
      scoreCell,
      h('span', { class: classNames('matchday__team', 'matchday__team--b', !spoilerFree && !aWon && 'matchday__team--won') }, nameOf(g.teamB, s.teamBId))
    )
  );
}
