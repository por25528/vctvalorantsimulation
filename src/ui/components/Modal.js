/**
 * ui/components/Modal.js — a single modal dialog (CONTRACTS-UI §6).
 *
 * Pure props -> VNode. The shell renders the modal stack via ModalRoot
 * (components/Roots.js); this component renders ONE modal: a dimmed backdrop
 * plus a centered panel (title, body, optional actions). Dismissal is wired by
 * the caller through `onClose`.
 */

import { h } from '../render.js';

/**
 * @param {object} props
 * @param {string} [props.id]      modal id (echoed back to onClose)
 * @param {string} [props.type]    modal type discriminator (for styling)
 * @param {string} [props.title]   heading text
 * @param {*} [props.body]         body content (string or VNode)
 * @param {Array<{label:string,kind?:string,onClick?:Function}>} [props.actions]
 * @param {(id:string)=>void} [props.onClose]  backdrop/close handler
 * @param {*} [props.children]     alternative body (when not using `body`)
 * @returns {import('../render.js').VNode}
 */
export function Modal(props) {
  const {
    id = '',
    type = 'default',
    title = '',
    body = null,
    actions = [],
    onClose = null,
    children = null
  } = props || {};

  const content = body != null ? body : children;

  return h(
    'div',
    {
      class: 'modal-backdrop',
      onClick: onClose ? () => onClose(id) : undefined
    },
    h(
      'div',
      {
        class: `modal modal--${type}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title || type,
        // Don't let clicks inside the panel bubble to the backdrop.
        onClick: (e) => {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        }
      },
      h(
        'div',
        { class: 'modal__head' },
        h('h2', { class: 'modal__title' }, title),
        h(
          'button',
          {
            type: 'button',
            class: 'modal__close',
            'aria-label': 'Close',
            onClick: onClose ? () => onClose(id) : undefined
          },
          '×'
        )
      ),
      h('div', { class: 'modal__body' }, content),
      actions && actions.length
        ? h(
            'div',
            { class: 'modal__actions' },
            actions.map((a, i) =>
              h(
                'button',
                {
                  key: `act-${i}`,
                  type: 'button',
                  class: `btn btn--${a.kind || 'ghost'} modal__action`,
                  onClick: a.onClick ? () => a.onClick(id) : undefined
                },
                a.label
              )
            )
          )
        : null
    )
  );
}
