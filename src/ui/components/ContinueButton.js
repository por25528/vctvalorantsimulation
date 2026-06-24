/**
 * ui/components/ContinueButton.js — the big primary "Continue" button that
 * drives the FM-style season loop (CONTRACTS-UI §6).
 *
 * Pure props -> VNode. Label is 'Continue' while there's something left to
 * play, 'Season complete' once the demo is done (and the button is disabled).
 * The click is wired by the caller (TopBar / HomeInbox -> continueSeason).
 */

import { h, classNames } from '../render.js';

/**
 * @param {object} props
 * @param {boolean} [props.complete]  true when the season has no pending event
 * @param {() => void} [props.onContinue]  click handler (caller wires command)
 * @returns {import('../render.js').VNode}
 */
export function ContinueButton(props) {
  const { complete = false, onContinue = null, label = 'Continue' } = props || {};
  const text = complete ? 'Season complete' : label;

  return h(
    'button',
    {
      type: 'button',
      class: classNames(
        'btn',
        'btn--primary',
        'continue-btn',
        complete && 'continue-btn--done'
      ),
      disabled: complete || undefined,
      'aria-label': text,
      onClick: !complete && onContinue ? () => onContinue() : undefined
    },
    h('span', { class: 'continue-btn__label' }, text)
  );
}
