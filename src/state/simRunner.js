/**
 * state/simRunner.js — off-thread simulation runner (CONTRACTS-POLISH P7f).
 *
 * Heavy BATCH simulations (a whole career, a whole season) can be offloaded to a
 * Web Worker so the browser UI thread stays responsive. This module is the
 * environment-agnostic front door:
 *   - In a browser with module-Worker support, `run(type, payload)` posts the task
 *     to a `seasonWorker` and resolves with its reply.
 *   - In Node (tests, headless) or any environment without Worker support, it runs
 *     the SAME task synchronously on the calling thread and resolves immediately.
 * Either way `run` returns a Promise, so callers are written once.
 *
 * The task table is shared by both paths (the worker imports `runTaskSync` from
 * here too), so the worker and the fallback are provably the same computation. The
 * engine functions remain PURE and deterministic — this layer only chooses WHERE
 * they run, never WHAT they compute.
 *
 * No DOM/Worker access happens at import time (only inside the run/ensure helpers),
 * so importing this module is safe in Node.
 */

import { simCareer } from '../engine/career/career.js';
import { simSeason } from '../engine/career/season.js';
import { buildWorld } from '../data/seed/index.js';

/**
 * The task registry. Each task is a pure function of its payload; both the sync
 * fallback and the worker dispatch through here.
 * @type {Record<string, (payload:object)=>object>}
 */
const TASKS = {
  /** Simulate N full seasons of a fresh career. payload: { seed, nSeasons }. */
  simCareer: ({ seed, nSeasons }) => {
    const { history, finalWorld } = simCareer(seed, nSeasons);
    return { history, finalWorld };
  },
  /** Simulate one full season over a fresh world. payload: { seed }. */
  simSeason: ({ seed }) => ({ result: simSeason(buildWorld(), seed) })
};

/**
 * Run a task synchronously on the calling thread. Used by the Node/no-Worker
 * fallback AND by the worker's own message handler.
 * @param {string} type
 * @param {object} [payload]
 * @returns {object}
 */
export function runTaskSync(type, payload) {
  const fn = TASKS[type];
  if (typeof fn !== 'function') throw new Error(`simRunner: unknown task '${type}'`);
  return fn(payload || {});
}

/** Is a usable module Web Worker available (browser)? Never throws. */
function workerSupported() {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined' && typeof import.meta.url === 'string';
}

/**
 * Create a sim runner. Offloads to a module Worker when one is available,
 * otherwise runs tasks synchronously. `run` always returns a Promise.
 *
 * @param {{ forceSync?: boolean }} [opts]  forceSync:true pins the synchronous path
 * @returns {{ available:boolean, run:(type:string, payload?:object)=>Promise<object>, terminate:()=>void }}
 */
export function createSimRunner(opts = {}) {
  const useWorker = opts.forceSync ? false : workerSupported();
  /** @type {Worker|null} */
  let worker = null;
  let seq = 0;
  /** @type {Map<number, {resolve:Function, reject:Function}>} */
  const pending = new Map();

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('../workers/seasonWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, result, error } = (e && e.data) || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    };
    worker.onerror = (e) => {
      const err = new Error('seasonWorker error: ' + ((e && e.message) || 'unknown'));
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    };
    return worker;
  }

  return {
    available: useWorker,
    run(type, payload) {
      if (!useWorker) {
        try { return Promise.resolve(runTaskSync(type, payload)); }
        catch (err) { return Promise.reject(err); }
      }
      const id = ++seq;
      const w = ensureWorker();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, type, payload });
      });
    },
    terminate() {
      if (worker) { worker.terminate(); worker = null; }
      pending.clear();
    }
  };
}
