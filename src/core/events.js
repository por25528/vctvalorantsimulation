/**
 * core/events.js — minimal pub/sub emitter (CONTRACTS §5).
 * Responsibility: the only stateful core module; typed on/off/emit with
 * unsubscribe handles. Dependency-free; runs unchanged in Node and the browser.
 *
 * @typedef {Object} Emitter
 * @property {(type:string, fn:Function) => (() => void)} on  subscribe; returns unsub
 * @property {(type:string, fn:Function) => void} off          unsubscribe a handler
 * @property {(type:string, payload?:*) => void} emit          dispatch to handlers
 */

/**
 * Create an event emitter.
 * @returns {Emitter}
 */
export function createEmitter() {
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map();

  /** @type {Emitter['on']} */
  const on = (type, fn) => {
    let set = handlers.get(type);
    if (!set) {
      set = new Set();
      handlers.set(type, set);
    }
    set.add(fn);
    return () => off(type, fn);
  };

  /** @type {Emitter['off']} */
  const off = (type, fn) => {
    const set = handlers.get(type);
    if (set) {
      set.delete(fn);
      if (set.size === 0) handlers.delete(type);
    }
  };

  /** @type {Emitter['emit']} */
  const emit = (type, payload) => {
    const set = handlers.get(type);
    if (!set) return;
    // Snapshot so handlers may safely unsubscribe during emit.
    for (const fn of [...set]) fn(payload);
  };

  return { on, off, emit };
}
