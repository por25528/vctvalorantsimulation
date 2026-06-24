/**
 * workers/simWorker.js — Web Worker that runs heavy simulation off the main
 * thread (season-advance, event sim) and posts results back.
 * Phase 3+. Browser Worker context.
 */

/**
 * Message handler entry. Wired via `self.onmessage` when running as a Worker.
 * @param {MessageEvent} event
 * @returns {void}
 */
export function handleMessage(event) {
  throw new Error('not implemented: workers/simWorker.js');
}
