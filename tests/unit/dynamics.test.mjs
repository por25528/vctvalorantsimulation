/**
 * tests/unit/dynamics.test.mjs — in-season form/morale/fatigue evolution
 * (CONTRACTS-CAREER §1.1, §5). Pure & deterministic (no rng).
 */

import { assert, assertClose, assertEqual, section } from '../_assert.mjs';
import { updateDynamics, recoverBetweenEvents } from '../../src/engine/career/dynamics.js';
import { createPlayer } from '../../src/domain/player.js';
import { BALANCE } from '../../src/config/balance.js';

const D = BALANCE.CAREER.DYNAMICS;

export default async function run() {
  const base = createPlayer({ name: 'Test', role: 'Duelist' }); // dynamics {form:0,morale:60,fatigue:0}

  section('updateDynamics — a strong win lifts form & morale, maps add fatigue');
  const win = updateDynamics(base, { won: true, mapsPlayed: 2, performance: 1.3 });
  assert(win.form > 0, 'a winning, above-average game raises form from 0');
  assert(win.morale > 60, 'a win raises morale above the 60 baseline');
  assertClose(win.fatigue, D.FATIGUE_PER_MAP * 2, 1e-9, 'fatigue accrues per map played');

  section('updateDynamics — a heavy loss drops form & morale');
  const loss = updateDynamics(base, { won: false, mapsPlayed: 3, performance: 0.7 });
  assert(loss.form < 0, 'a losing, below-average game pushes form negative');
  assert(loss.morale < 60, 'a loss drops morale below baseline');
  assertClose(loss.fatigue, D.FATIGUE_PER_MAP * 3, 1e-9, 'fatigue scales with maps');

  section('updateDynamics — deterministic (pure) + clamped to domain ranges');
  assertEqual(
    updateDynamics(base, { won: true, mapsPlayed: 2, performance: 1.3 }),
    win,
    'same inputs reproduce identical dynamics'
  );
  // An absurd result cannot push values out of range.
  const tired = createPlayer({ name: 'T', dynamics: { form: 95, morale: 98, fatigue: 96 } });
  const maxed = updateDynamics(tired, { won: true, mapsPlayed: 5, performance: 2.0 });
  assert(maxed.form <= 100 && maxed.morale <= 100 && maxed.fatigue <= 100, 'values clamp at their maxima');
  const drained = createPlayer({ name: 'D', dynamics: { form: -95, morale: 4, fatigue: 0 } });
  const floored = updateDynamics(drained, { won: false, mapsPlayed: 0, performance: 0.2 });
  assert(floored.form >= -100 && floored.morale >= 0 && floored.fatigue >= 0, 'values clamp at their minima');

  section('recoverBetweenEvents — sheds fatigue, mean-reverts form, reverts morale');
  const spent = createPlayer({ name: 'S', dynamics: { form: 40, morale: 30, fatigue: 50 } });
  const rec = recoverBetweenEvents(spent);
  assert(rec.fatigue < 50, 'fatigue is shed between events');
  assert(Math.abs(rec.form) < 40, 'form mean-reverts toward 0');
  assert(rec.morale > 30 && rec.morale < 60, 'low morale drifts up toward the base');

  const elated = createPlayer({ name: 'E', dynamics: { form: -20, morale: 90, fatigue: 10 } });
  const rec2 = recoverBetweenEvents(elated);
  assert(rec2.morale < 90 && rec2.morale > 60, 'high morale drifts down toward the base');
  assert(rec2.fatigue === 0, 'small fatigue floors at 0 after recovery');
  assert(Math.abs(rec2.form) < 20, 'negative form also mean-reverts toward 0');
}
