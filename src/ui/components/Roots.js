/**
 * ui/components/Roots.js — modal + toast stack roots (CONTRACTS-UI §4, §6).
 *
 * Unlike the leaf components (Modal / Toast), these are `(state, dispatch)`
 * connectors: they read `ui.modals` / `ui.toasts` off the store state and
 * render the whole stack, wiring dismissal back through `dispatch`. Still pure
 * (no DOM, no side effects) so they serialize via toHtml in tests.
 */

import { h, Fragment } from '../render.js';
import { closeModal, dismissToast } from '../../state/actions.js';
import { Modal } from './Modal.js';
import { Toast } from './Toast.js';

/**
 * Render the open modal stack.
 * @param {{ui:{modals:Array<{id:string,type:string,props:object}>}}} state
 * @param {(action:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
export function ModalRoot(state, dispatch) {
  const modals = (state && state.ui && state.ui.modals) || [];
  if (!modals.length) {
    return h('div', { class: 'modal-root', 'aria-hidden': 'true' });
  }
  return h(
    'div',
    { class: 'modal-root' },
    modals.map((m) =>
      h(Modal, {
        key: m.id,
        id: m.id,
        type: m.type,
        title: (m.props && m.props.title) || '',
        body: (m.props && m.props.body) || null,
        actions: (m.props && m.props.actions) || [],
        onClose: dispatch ? (id) => dispatch(closeModal(id)) : undefined
      })
    )
  );
}

/**
 * Render the toast stack.
 * @param {{ui:{toasts:Array<{id:string,kind:string,text:string}>}}} state
 * @param {(action:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
export function ToastRoot(state, dispatch) {
  const toasts = (state && state.ui && state.ui.toasts) || [];
  return h(
    'div',
    { class: 'toast-root', 'aria-live': 'polite' },
    toasts.length
      ? toasts.map((t) =>
          h(Toast, {
            key: t.id,
            id: t.id,
            kind: t.kind,
            text: t.text,
            onDismiss: dispatch ? (id) => dispatch(dismissToast(id)) : undefined
          })
        )
      : h(Fragment, null)
  );
}
