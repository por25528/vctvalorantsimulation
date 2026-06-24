/**
 * ui/screens/SaveLoad.js — the Save / Load screen (CONTRACTS-PERSIST §6,
 * id 'saves'). PURE `(state, dispatch, store) => VNode` — renders headlessly via
 * toHtml. No DOM is touched during render; `document`/`Blob`/`FileReader` are only
 * referenced inside event handlers (guarded so they no-op headlessly), so a bare
 * render in Node never crashes.
 *
 * Layout (top → bottom):
 *   - Save Current control: a button that opens a Modal text prompt for the slot
 *     name, then calls saveCurrent(store, name).
 *   - Slot list: one row per save slot (name + lastPlayed) with Load / Duplicate /
 *     Delete buttons. RENDERED FROM `state.ui.saveSlots` (selectSaveSlots) — the
 *     ui-held mirror of saveManager.listSlots(), repopulated out-of-band by the
 *     refreshSlots(store) command (see ASYNC SLOT LISTING below).
 *   - Export: serializes the current career (exportCurrent) and triggers a JSON
 *     file download via a Blob + <a download> click — guarded so it degrades to a
 *     toast when the DOM/Blob APIs are absent (Node), keeping import testable.
 *   - Import: a <textarea> for pasting JSON + an <input type="file"> (FileReader)
 *     → importSave(store, json) → hydrate the store. After import we refreshSlots.
 *
 * ASYNC SLOT LISTING (how it is wired into render):
 *   saveManager.listSlots() is async (IndexedDB-backed), but a screen is a pure
 *   synchronous `state -> VNode`. So the screen NEVER awaits during render: it
 *   reads the already-resolved snapshot from `state.ui.saveSlots`. The async
 *   `refreshSlots(store)` command (state/commands.js) awaits listSlots() and
 *   dispatches `setSaveSlots(slots)`, which lands in the ui slice and triggers a
 *   re-render. refreshSlots is called by bootstrap (warms the list), by every
 *   slot-mutating command (saveCurrent/loadSlot/deleteSlot/duplicateSlot/import),
 *   and by this screen's "Refresh" button. The screen also fires a one-shot
 *   refresh on first paint when it detects the list has never been loaded
 *   (a module-level guard, so it doesn't loop), so opening Saves directly still
 *   populates without a manual refresh.
 */

import { h, classNames } from '../render.js';
import { navigate, openModal, closeModal, pushToast } from '../../state/actions.js';
import { selectSaveSlots } from '../../state/selectors.js';
import {
  saveCurrent,
  loadSlot,
  deleteSlot,
  duplicateSlot,
  exportCurrent,
  importSave,
  refreshSlots,
  AUTOSAVE_ID
} from '../../state/commands.js';

/**
 * One-shot guard so the screen kicks an initial refreshSlots only once per
 * process when it first renders against a never-populated list. Without this the
 * SaveLoad screen would either show an empty list (until some other command
 * refreshes) or, if it refreshed unconditionally on every render, loop forever
 * (refresh dispatches -> re-render -> refresh...). Module-level so it survives
 * re-renders; reset is unnecessary because refresh is idempotent.
 * @type {WeakSet<object>}
 */
const kicked = new WeakSet();

/**
 * Resolve a usable store for command calls. The router forwards the real store
 * (so async dispatches re-render the live tree); if it's absent (headless render
 * tests), fall back to a minimal facade over the snapshot state + dispatch.
 * @param {object} state
 * @param {(a:object)=>void} dispatch
 * @param {object} [store]
 * @returns {{getState:()=>object, dispatch:(a:object)=>void}}
 */
function resolveStore(state, dispatch, store) {
  if (store && typeof store.getState === 'function') return store;
  return { getState: () => state, dispatch: dispatch || (() => {}) };
}

/**
 * Format a lastPlayed epoch-ms into a short, locale-stable label. Pure string
 * work (no Date.now): formatting an already-captured timestamp is allowed in the
 * UI layer. Falls back to '—' when absent.
 * @param {number|undefined} ms
 * @returns {string}
 */
function formatPlayed(ms) {
  if (!ms || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const iso = d.toISOString();          // deterministic, locale-independent
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * The Save / Load screen.
 * @param {object} state  root store state
 * @param {(action:object)=>void} dispatch
 * @param {object} [store]  the live store (forwarded by the router)
 * @returns {import('../render.js').VNode}
 */
export function SaveLoadScreen(state, dispatch, store) {
  const s = resolveStore(state, dispatch, store);
  const slots = selectSaveSlots(state);

  // One-shot initial refresh when the list has never been populated and we have a
  // real store to dispatch through. Guarded so it can't loop.
  if (store && typeof store.getState === 'function' && !kicked.has(store) && slots.length === 0) {
    kicked.add(store);
    void refreshSlots(store);
  }

  return h(
    'section',
    { class: 'screen screen--saves saves', id: 'screen-saves' },
    h('h1', { class: 'screen__title' }, 'Saves'),

    saveCurrentControl(s, dispatch),
    slotList(slots, s, dispatch),
    exportControl(s, dispatch),
    importControl(s, dispatch)
  );
}

/* ------------------------------------------------------------------ */
/* Save Current                                                        */
/* ------------------------------------------------------------------ */

/**
 * The "Save Current" control: a primary button that opens a Modal name prompt.
 * The prompt's text is held in a closed-over object the modal's input writes to
 * (no per-keystroke store churn); confirming calls saveCurrent(store, name).
 * @param {{getState:Function,dispatch:Function}} store
 * @param {(a:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
function saveCurrentControl(store, dispatch) {
  const onSave = () => promptForName(
    store,
    dispatch,
    'Save Current Career',
    'My Career',
    (name) => { void saveCurrent(store, name || 'Save'); }
  );

  return h(
    'div',
    { class: 'saves__panel saves__save' },
    h('h2', { class: 'saves__panel-title' }, 'Save Current'),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary saves__save-btn',
        onClick: dispatch ? onSave : undefined
      },
      'Save Current…'
    )
  );
}

/**
 * Open a Modal text prompt. The body is a labelled <input>; its onInput stashes
 * the value into a mutable holder. The "Save" action reads the holder and calls
 * `onConfirm(name)`, then closes the modal. Pure with respect to render — the DOM
 * only matters at interaction time.
 * @param {{dispatch:Function}} store
 * @param {(a:object)=>void} dispatch
 * @param {string} title
 * @param {string} placeholder
 * @param {(name:string)=>void} onConfirm
 */
function promptForName(store, dispatch, title, placeholder, onConfirm) {
  if (!dispatch) return;
  const holder = { value: '' };
  const body = h(
    'div',
    { class: 'saves__prompt' },
    h('label', { class: 'saves__prompt-label', for: 'save-name-input' }, 'Save name'),
    h('input', {
      id: 'save-name-input',
      type: 'text',
      class: 'input saves__prompt-input',
      placeholder,
      onInput: (e) => { holder.value = (e && e.target && e.target.value) || ''; }
    })
  );
  dispatch(openModal('prompt', {
    title,
    body,
    actions: [
      { label: 'Cancel', kind: 'ghost', onClick: (id) => dispatch(closeModal(id)) },
      {
        label: 'Save',
        kind: 'primary',
        onClick: (id) => {
          dispatch(closeModal(id));
          onConfirm((holder.value || '').trim() || placeholder);
        }
      }
    ]
  }));
}

/* ------------------------------------------------------------------ */
/* Slot list                                                           */
/* ------------------------------------------------------------------ */

/**
 * The list of save slots (name + lastPlayed, with Load/Duplicate/Delete). Renders
 * the autosave slot (if present) with a distinguishing badge. Empty state shows a
 * hint + a Refresh button.
 * @param {Array<object>} slots
 * @param {{getState:Function,dispatch:Function}} store
 * @param {(a:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
function slotList(slots, store, dispatch) {
  const onRefresh = dispatch ? () => { void refreshSlots(store); } : undefined;

  return h(
    'div',
    { class: 'saves__panel saves__slots' },
    h(
      'div',
      { class: 'saves__panel-head' },
      h('h2', { class: 'saves__panel-title' }, 'Save Slots'),
      h(
        'button',
        { type: 'button', class: 'btn btn--ghost saves__refresh', onClick: onRefresh },
        'Refresh'
      )
    ),
    slots.length === 0
      ? h('p', { class: 'muted saves__empty' }, 'No saves yet — use “Save Current”.')
      : h(
          'ul',
          { class: 'saves__list' },
          slots.map((meta) => slotRow(meta, store, dispatch))
        )
  );
}

/**
 * One save-slot row.
 * @param {object} meta  SaveMeta { id, name, lastPlayed, ... }
 * @param {{getState:Function,dispatch:Function}} store
 * @param {(a:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
function slotRow(meta, store, dispatch) {
  const id = meta.id;
  const isAuto = id === AUTOSAVE_ID;
  const name = meta.name || id || 'Save';

  const onLoad = dispatch ? () => { void loadSlot(store, id); } : undefined;
  const onDelete = dispatch ? () => { void deleteSlot(store, id); } : undefined;
  const onDup = dispatch
    ? () => promptForName(
        store, dispatch, 'Duplicate Save', `${name} (copy)`,
        (newName) => { void duplicateSlot(store, id, newName); }
      )
    : undefined;

  return h(
    'li',
    { class: classNames('saves__slot', isAuto && 'saves__slot--auto'), key: id },
    h(
      'div',
      { class: 'saves__slot-info' },
      h(
        'span',
        { class: 'saves__slot-name' },
        name,
        isAuto ? h('span', { class: 'badge saves__slot-badge' }, 'Autosave') : null
      ),
      h('span', { class: 'saves__slot-played muted' }, formatPlayed(meta.lastPlayed))
    ),
    h(
      'div',
      { class: 'saves__slot-actions' },
      h('button', { type: 'button', class: 'btn btn--primary saves__action saves__load', onClick: onLoad }, 'Load'),
      h('button', { type: 'button', class: 'btn btn--ghost saves__action saves__dup', onClick: onDup }, 'Duplicate'),
      h('button', { type: 'button', class: 'btn btn--danger saves__action saves__delete', onClick: onDelete }, 'Delete')
    )
  );
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/**
 * The Export control: serializes the current career and triggers a JSON download.
 * Headless-guarded — when Blob / document anchors are unavailable (Node), it still
 * produces the JSON (via exportCurrent) and just toasts, so importSave round-trips
 * in tests without a DOM.
 * @param {{getState:Function,dispatch:Function}} store
 * @param {(a:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
function exportControl(store, dispatch) {
  const onExport = dispatch ? () => triggerExportDownload(store) : undefined;
  return h(
    'div',
    { class: 'saves__panel saves__export' },
    h('h2', { class: 'saves__panel-title' }, 'Export'),
    h('p', { class: 'muted' }, 'Download the current career as a compact JSON file.'),
    h(
      'button',
      { type: 'button', class: 'btn btn--ghost saves__export-btn', onClick: onExport },
      'Export JSON'
    )
  );
}

/**
 * Serialize the current career and, when the browser download APIs exist, push a
 * .json file download via a Blob + a transient <a download> click. Falls back to
 * just the (already toasted) export when headless. Never throws on Node.
 * @param {{getState:Function,dispatch:Function}} store
 */
function triggerExportDownload(store) {
  let json;
  try {
    json = exportCurrent(store);     // toasts "Career exported."
  } catch (err) {
    store.dispatch(pushToast('error', `Export failed: ${err && err.message ? err.message : err}`));
    return;
  }
  // Headless guard: only attempt the file download when the DOM/Blob APIs exist.
  const canDownload =
    typeof document !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function';
  if (!canDownload) return;
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vct-career-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    // The JSON was already exported (toasted); a failed download is non-fatal.
  }
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

/**
 * The Import control: a paste <textarea> + an Import button, plus an
 * <input type="file"> wired through FileReader. Both routes call doImport, which
 * runs importSave(store, json) and refreshes the slot list.
 * @param {{getState:Function,dispatch:Function}} store
 * @param {(a:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
function importControl(store, dispatch) {
  const holder = { text: '' };

  const onPasteImport = dispatch
    ? () => doImport(store, holder.text)
    : undefined;

  const onFile = dispatch
    ? (e) => {
        const file = e && e.target && e.target.files && e.target.files[0];
        if (!file) return;
        if (typeof FileReader === 'undefined') {
          store.dispatch(pushToast('error', 'File import unavailable here.'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => doImport(store, String(reader.result || ''));
        reader.onerror = () => store.dispatch(pushToast('error', 'Could not read file.'));
        reader.readAsText(file);
      }
    : undefined;

  return h(
    'div',
    { class: 'saves__panel saves__import' },
    h('h2', { class: 'saves__panel-title' }, 'Import'),
    h('textarea', {
      class: 'input saves__import-text',
      rows: 4,
      placeholder: 'Paste exported career JSON here…',
      onInput: (e) => { holder.text = (e && e.target && e.target.value) || ''; }
    }),
    h(
      'div',
      { class: 'saves__import-actions' },
      h(
        'button',
        { type: 'button', class: 'btn btn--primary saves__import-btn', onClick: onPasteImport },
        'Import Pasted JSON'
      ),
      h('label', { class: 'btn btn--ghost saves__import-file' },
        'Import File…',
        h('input', {
          type: 'file',
          accept: 'application/json,.json',
          class: 'saves__import-input',
          style: { display: 'none' },
          onChange: onFile
        })
      )
    )
  );
}

/**
 * Parse + hydrate an imported career, then refresh the slot list and route home.
 * Errors (invalid JSON / bad schema) are caught and toasted; the store is left
 * untouched. Per the contract this goes through the importSave command (which
 * dispatches world+season+settings) — the loaded state IS the imported career.
 * @param {{getState:Function,dispatch:Function}} store
 * @param {string} json
 */
function doImport(store, json) {
  const text = (json || '').trim();
  if (!text) {
    store.dispatch(pushToast('error', 'Nothing to import — paste JSON or choose a file.'));
    return;
  }
  try {
    importSave(store, text);          // parse + migrate + hydrate + toast
    void refreshSlots(store);
    store.dispatch(navigate('home'));
  } catch (err) {
    store.dispatch(pushToast('error', `Import failed: ${err && err.message ? err.message : err}`));
  }
}
