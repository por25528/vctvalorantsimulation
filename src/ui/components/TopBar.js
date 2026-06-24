/**
 * ui/components/TopBar.js — the shell's top bar (CONTRACTS-UI §4, §6).
 *
 * Shows the current event + season labels on the left, a Save button (opens the
 * Saves screen) and the big ContinueButton on the right. Pure props -> VNode; the
 * Continue / Save clicks are wired by the caller (App -> continueSeason /
 * navigate('saves')).
 */

import { h, classNames } from '../render.js';
import { ContinueButton } from './ContinueButton.js';
import { Icon } from './Icon.js';

/**
 * @param {object} props
 * @param {string} [props.eventLabel]   active event name (e.g. 'Up next — Kickoff')
 * @param {string} [props.seasonLabel]  season label (e.g. '2026 — VCT World Tour')
 * @param {boolean} [props.kickoffComplete]  true when nothing is left to play
 * @param {() => void} [props.onContinue]  Continue handler (caller wires command)
 * @param {() => void} [props.onOpenSaves]  Save handler -> navigate the Saves screen
 * @returns {import('../render.js').VNode}
 */
export function TopBar(props) {
  const {
    eventLabel = '',
    seasonLabel = '',
    kickoffComplete = false,
    onContinue = null,
    onSimEvent = null,
    revealing = false,
    continueLabel = 'Continue',
    autoplay = false,
    onToggleAutoplay = null,
    autoplaySpeed = 'normal',
    onAutoplaySpeed = null,
    spoilerFree = true,
    onToggleSpoilerFree = null,
    teamGroups = [],
    followedTeamId = null,
    onFollow = null,
    onOpenSaves = null
  } = props || {};

  return h(
    'header',
    { class: 'topbar' },
    teamGroups && teamGroups.length ? followSelect(teamGroups, followedTeamId, onFollow) : null,
    h(
      'div',
      { class: 'topbar__labels' },
      h('span', { class: 'topbar__event' }, eventLabel),
      seasonLabel
        ? h('span', { class: 'topbar__season' }, seasonLabel)
        : null
    ),
    h(
      'div',
      { class: 'topbar__actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost topbar__save',
          disabled: onOpenSaves ? undefined : true,
          title: 'Save / load careers',
          'aria-label': 'Save / load',
          onClick: onOpenSaves ? () => onOpenSaves() : undefined
        },
        'Save'
      ),
      // Spoiler-free viewing: hide results until you watch them.
      onToggleSpoilerFree
        ? h(
            'button',
            {
              type: 'button',
              class: classNames('btn', 'btn--ghost', 'topbar__spoiler', spoilerFree && 'topbar__spoiler--on'),
              'aria-pressed': spoilerFree ? 'true' : 'false',
              title: spoilerFree
                ? 'Spoiler-free is ON — results hide until you watch them. Click to show results instantly.'
                : 'Spoilers shown — results appear immediately. Click for spoiler-free viewing.',
              onClick: () => onToggleSpoilerFree()
            },
            Icon(spoilerFree ? 'eye-off' : 'eye', { size: 16 }),
            h('span', { class: 'topbar__btn-label' }, spoilerFree ? 'Spoiler-free' : 'Spoilers')
          )
        : null,
      // Hands-free autoplay: auto-advance the season match-day by match-day.
      onToggleAutoplay
        ? h(
            'button',
            {
              type: 'button',
              class: classNames('btn', 'topbar__autoplay', autoplay ? 'btn--primary' : 'btn--ghost'),
              'aria-pressed': autoplay ? 'true' : 'false',
              title: autoplay ? 'Pause autoplay' : 'Autoplay — sit back and watch',
              onClick: () => onToggleAutoplay()
            },
            Icon(autoplay ? 'pause' : 'play', { size: 16 }),
            h('span', { class: 'topbar__btn-label' }, 'Auto')
          )
        : null,
      // Autoplay cadence (only meaningful while autoplay runs).
      autoplay && onAutoplaySpeed ? autoplaySpeedControl(autoplaySpeed, onAutoplaySpeed) : null,
      // While a slot is mid-reveal, offer a one-click "Sim event" to reveal the rest.
      revealing && onSimEvent
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn--ghost topbar__sim',
              title: 'Reveal the rest of this event at once',
              onClick: () => onSimEvent()
            },
            Icon('skip', { size: 16 }),
            h('span', { class: 'topbar__btn-label' }, 'Sim event')
          )
        : null,
      ContinueButton({ complete: kickoffComplete, onContinue, label: continueLabel })
    )
  );
}

/**
 * A small segmented control for the hands-free autoplay cadence.
 * @param {'slow'|'normal'|'fast'} active
 * @param {(speed:string)=>void} onPick
 * @returns {import('../render.js').VNode}
 */
function autoplaySpeedControl(active, onPick) {
  const opts = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
  return h(
    'div',
    { class: 'topbar__speed', role: 'group', 'aria-label': 'Autoplay speed' },
    opts.map(([id, label]) =>
      h(
        'button',
        {
          key: id,
          type: 'button',
          class: classNames('btn', 'btn--sm', active === id ? 'btn--primary' : 'btn--ghost'),
          'aria-pressed': active === id ? 'true' : 'false',
          onClick: () => onPick(id)
        },
        label
      )
    )
  );
}

/**
 * The follow-a-team dropdown: pick any team to follow (region-grouped) or
 * "Spectating" to follow no one. Renders inert without an `onFollow` handler.
 * @param {Array<{region:string,label:string,teams:Array<{id:string,name:string,tag?:string}>}>} groups
 * @param {string|null} followedTeamId
 * @param {((teamId:string|null)=>void)|null} onFollow
 * @returns {import('../render.js').VNode}
 */
function followSelect(groups, followedTeamId, onFollow) {
  return h(
    'label',
    { class: 'topbar__follow' },
    h('span', { class: 'topbar__follow-star', 'aria-hidden': 'true' }, followedTeamId ? '★' : '☆'),
    h(
      'select',
      {
        class: 'topbar__follow-select',
        'aria-label': 'Follow a team',
        value: followedTeamId || '',
        disabled: onFollow ? undefined : true,
        onChange: onFollow ? (e) => onFollow(e.target.value || null) : undefined
      },
      h('option', { value: '', selected: !followedTeamId ? true : undefined }, 'Spectating (no team)'),
      groups.map((g) =>
        h(
          'optgroup',
          { key: g.region, label: g.label },
          g.teams.map((t) =>
            h(
              'option',
              { key: t.id, value: t.id, selected: t.id === followedTeamId ? true : undefined },
              `${t.tag ? t.tag + ' · ' : ''}${t.name}`
            )
          )
        )
      )
    )
  );
}
