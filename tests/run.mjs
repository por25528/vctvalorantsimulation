/**
 * tests/run.mjs — test runner. Imports all unit tests + determinism.test.mjs,
 * runs each default-exported async fn, prints a PASS/FAIL summary, exits
 * non-zero on failure. Runnable via `node tests/run.mjs`. (CONTRACTS §14)
 *
 * Unit test modules are discovered from tests/unit/*.test.mjs. Each exports a
 * default `async () => {}` that throws on failure.
 */

import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Collect all test modules to run. */
async function collectTests() {
  const unitDir = join(here, 'unit');
  /** @type {string[]} */
  let files = [];
  try {
    files = (await readdir(unitDir)).filter((f) => f.endsWith('.test.mjs'));
  } catch {
    files = [];
  }
  const tests = files.map((f) => ({ name: `unit/${f}`, url: pathToFileURL(join(unitDir, f)).href }));
  // UI suites live under tests/ui/*.test.mjs (headless via toHtml).
  const uiDir = join(here, 'ui');
  let uiFiles = [];
  try {
    uiFiles = (await readdir(uiDir)).filter((f) => f.endsWith('.test.mjs'));
  } catch {
    uiFiles = [];
  }
  for (const f of uiFiles) {
    tests.push({ name: `ui/${f}`, url: pathToFileURL(join(uiDir, f)).href });
  }
  // Determinism suite lives at tests/determinism.test.mjs
  tests.push({
    name: 'determinism.test.mjs',
    url: pathToFileURL(join(here, 'determinism.test.mjs')).href
  });
  // Top-level Kickoff invariant suite (CONTRACTS-FORMAT §9, §10).
  tests.push({
    name: 'kickoff.test.mjs',
    url: pathToFileURL(join(here, 'kickoff.test.mjs')).href
  });
  // Top-level full-Season invariant suite (CONTRACTS-SEASON §7, §8).
  tests.push({
    name: 'season.test.mjs',
    url: pathToFileURL(join(here, 'season.test.mjs')).href
  });
  // Top-level multi-season Career invariant suite (CONTRACTS-CAREER §3, §5).
  tests.push({
    name: 'career.test.mjs',
    url: pathToFileURL(join(here, 'career.test.mjs')).href
  });
  return tests;
}

async function main() {
  const tests = await collectTests();
  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      const mod = await import(t.url);
      const fn = mod.default;
      if (typeof fn !== 'function') {
        throw new Error(`${t.name} has no default-exported test function`);
      }
      await fn();
      passed++;
      // eslint-disable-next-line no-console
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`FAIL ${t.name}\n  ${err && err.stack ? err.stack : err}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
}

main();
