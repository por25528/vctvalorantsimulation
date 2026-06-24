/**
 * workers/seasonWorker.js — the off-thread season/career simulation worker
 * (CONTRACTS-POLISH P7f). BROWSER ONLY (module Web Worker).
 *
 * Receives `{ id, type, payload }` messages, runs the task through the SHARED
 * `runTaskSync` registry (so the worker and the main-thread fallback are provably
 * the same pure computation), and posts back `{ id, result }` or `{ id, error }`.
 *
 * This file touches the worker global `self`, so it is never imported in Node —
 * the runner only constructs it via `new Worker(new URL(...))` in a browser that
 * supports module workers. The engine it pulls in stays pure/deterministic.
 */

import { runTaskSync } from '../state/simRunner.js';

// eslint-disable-next-line no-restricted-globals
self.onmessage = (e) => {
  const { id, type, payload } = (e && e.data) || {};
  try {
    const result = runTaskSync(type, payload);
    // eslint-disable-next-line no-restricted-globals
    self.postMessage({ id, result });
  } catch (err) {
    // eslint-disable-next-line no-restricted-globals
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
};
