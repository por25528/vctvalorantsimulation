/**
 * tests/unit/simRunner.test.mjs — P7f off-thread sim runner (CONTRACTS-POLISH P7f).
 *
 * In Node there is no Web Worker, so the runner falls back to the synchronous
 * path — which must produce byte-identical results to calling the engine directly
 * (and the same task table the browser worker would use). The browser-Worker path
 * itself is browser-only and not exercised here.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { createSimRunner, runTaskSync } from '../../src/state/simRunner.js';
import { simCareer } from '../../src/engine/career/career.js';
import { simSeason } from '../../src/engine/career/season.js';
import { buildWorld } from '../../src/data/seed/index.js';

export default async function run() {
  section('runner falls back to synchronous in Node');
  const runner = createSimRunner();
  assertEqual(runner.available, false, 'no Worker in Node -> sync fallback');

  section('simCareer task matches a direct engine call');
  const out = await runner.run('simCareer', { seed: 'wr-1', nSeasons: 1 });
  const direct = simCareer('wr-1', 1);
  assertEqual(
    out.history.map((h) => h.champion),
    direct.history.map((h) => h.champion),
    'runner reproduces the direct simCareer champions'
  );
  assert(out.finalWorld && out.finalWorld.teamsById, 'a finalWorld is returned');

  section('simSeason task matches a direct engine call');
  const s = await runner.run('simSeason', { seed: 9 });
  const directSeason = simSeason(buildWorld(), 9);
  assertEqual(s.result.champion, directSeason.champion, 'runner reproduces the direct simSeason champion');

  section('runTaskSync — shared task table; unknown task throws');
  assert(runTaskSync('simSeason', { seed: 3 }).result.champion, 'runTaskSync runs a task');
  let threw = false;
  try { runTaskSync('does-not-exist', {}); } catch { threw = true; }
  assert(threw, 'an unknown task throws');

  section('forceSync + determinism + terminate');
  const forced = createSimRunner({ forceSync: true });
  assertEqual(forced.available, false, 'forceSync pins the synchronous path');
  const a = await runner.run('simCareer', { seed: 'det', nSeasons: 1 });
  const b = await runner.run('simCareer', { seed: 'det', nSeasons: 1 });
  assertEqual(a.history.map((h) => h.champion), b.history.map((h) => h.champion), 'the runner is deterministic');
  runner.terminate(); // no-op without a worker, must not throw
  forced.terminate();
}
