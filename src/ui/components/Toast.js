/**
 * ui/components/Toast.js — a single transient toast (CONTRACTS-UI §6).
 *
 * Pure props -> VNode. The shell renders the toast stack via ToastRoot
 * (components/Roots.js); this component renders ONE toast: a kind-tinted pill
 * with text and a dismiss control wired by the caller through `onDismiss`.
 */

import { h, classNames } from '../render.js';

/** Glyphs per toast kind. */
const KIND_GLYPH = {
  success: '✓',
  error: '✕',
  warn: '!',
  info: 'i'
};

/**
 * @param {object} props
 * @param {string} [props.id]    toast id (echoed back to onDismiss)
 * @param {string} [props.kind]  'info' | 'success' | 'error' | 'warn'
 * @param {string} [props.text]  message
 * @param {(id:string)=>void} [props.onDismiss]  dismiss handler
 * @returns {import('../render.js').VNode}
 */
export function Toast(props) {
  const { id = '', kind = 'info', text = '', onDismiss = null } = props || {};
  const glyph = KIND_GLYPH[kind] || KIND_GLYPH.info;

  return h(
    'div',
    {
      class: classNames('toast', `toast--${kind}`),
      role: 'status',
      'aria-live': 'polite'
    },
    h('span', { class: 'toast__glyph', 'aria-hidden': 'true' }, glyph),
    h('span', { class: 'toast__text' }, text),
    h(
      'button',
      {
        type: 'button',
        class: 'toast__close',
        'aria-label': 'Dismiss',
        onClick: onDismiss ? () => onDismiss(id) : undefined
      },
      '×'
    )
  );
}
