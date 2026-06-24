/**
 * tests/unit/matchdays.test.mjs — the match-day partition (engine/career/matchdays.js).
 *
 * Plays a real Kickoff slot (4 regional events) via the career engine, then
 * asserts buildSlotSchedule partitions it into ordered, dependency-correct,
 * spoiler-safe match-days: every series scheduled exactly once, no team plays
 * twice in one day within an event, group phase before playoff phase, and the
 * reveal helper grows monotonically to full coverage. Deterministic.
 */

import { assert } from '../_assert.mjs';
import { initCareer, advanceCareerSlot } from '../../src/engine/career/career.js';
import {
  buildSlotSchedule,
  revealedSeriesByEvent,
  seriesKey
} from '../../src/engine/career/matchdays.js';

/** Look a SeriesRef up in its event by (stageId, matchId). */
function findSeries(entry, stageId, matchId) {
  return (entry.result.series || []).find((s) => s.stageId === stageId && s.matchId === matchId);
}

export default async function run() {
  const SEED = 90210;
  const state = advanceCareerSlot(initCareer(SEED));
  const entries = state.season.events.filter((e) => e.slotId === 'kickoff');
  assert(entries.length === 4, `kickoff expands to 4 regional entries (got ${entries.length})`);

  const days = buildSlotSchedule(entries);
  assert(days.length > 0, 'schedule produced days');

  // -- coverage: every series across all 4 events is scheduled exactly once -----
  const totalSeries = entries.reduce((n, e) => n + e.result.series.length, 0);
  const refCount = days.reduce((n, d) => n + d.refs.length, 0);
  assert(refCount === totalSeries, `every series scheduled once (refs ${refCount} vs series ${totalSeries})`);
  const seen = new Set();
  for (const d of days) {
    for (const ref of d.refs) {
      const k = `${ref.eventId}|${ref.stageId}|${ref.matchId}`;
      assert(!seen.has(k), `series scheduled twice: ${k}`);
      seen.add(k);
    }
  }

  // -- validity: within a day no team plays twice in the same event ------------
  for (const d of days) {
    const perEvent = new Map();
    for (const ref of d.refs) {
      const entry = entries.find((e) => e.result.eventId === ref.eventId);
      const ser = findSeries(entry, ref.stageId, ref.matchId);
      assert(ser, `ref resolves to a series (${ref.eventId} ${ref.stageId} ${ref.matchId})`);
      let used = perEvent.get(ref.eventId);
      if (!used) {
        used = new Set();
        perEvent.set(ref.eventId, used);
      }
      assert(
        !used.has(ser.teamAId) && !used.has(ser.teamBId),
        `day ${d.dayIndex}: a team plays twice in ${ref.eventId}`
      );
      used.add(ser.teamAId);
      used.add(ser.teamBId);
    }
  }

  // -- ordering: phases are non-decreasing; group (0) first, playoff (>=1) last -
  let prevPhase = -1;
  for (const d of days) {
    assert(d.phase >= prevPhase, 'phases are non-decreasing across days');
    prevPhase = d.phase;
  }
  assert(days[0].phase === 0, 'first day is the group phase');
  assert(days[days.length - 1].phase >= 1, 'last day is the playoff phase');

  // every regional event reaches the playoff phase only after its group phase:
  // for each event, the day-index of its first playoff series > last group series.
  for (const entry of entries) {
    const eid = entry.result.eventId;
    let lastGroupDay = -1;
    let firstPlayoffDay = Infinity;
    for (const d of days) {
      const has = d.refs.some((r) => r.eventId === eid);
      if (!has) continue;
      if (d.phase === 0) lastGroupDay = Math.max(lastGroupDay, d.dayIndex);
      if (d.phase >= 1) firstPlayoffDay = Math.min(firstPlayoffDay, d.dayIndex);
    }
    assert(lastGroupDay < firstPlayoffDay, `${eid}: playoff only after its groups complete`);
  }

  // -- dependency-correctness inside the triple-elim: a Upper Semifinal is never
  //    revealed before BOTH its feeder Upper Quarterfinals. -------------------
  const eid0 = entries[0].result.eventId;
  const dayOf = (matchId) => {
    for (const d of days) {
      if (d.refs.some((r) => r.eventId === eid0 && r.stageId === 'playoff' && r.matchId === matchId)) {
        return d.dayIndex;
      }
    }
    return -1;
  };
  if (dayOf('USF1') >= 0) {
    assert(dayOf('USF1') > dayOf('UQF1') && dayOf('USF1') > dayOf('UQF2'), 'USF1 after its UQF feeders');
    assert(dayOf('UF') > dayOf('USF1') && dayOf('UF') > dayOf('USF2'), 'Upper Final after its semis');
    assert(dayOf('LF') > dayOf('LR4'), 'Lower Final after Lower Round 4');
  }

  // -- reveal helper: grows monotonically to full coverage ---------------------
  const fullByEvent = revealedSeriesByEvent(days, days.length - 1);
  let revealedAll = 0;
  for (const set of fullByEvent.values()) revealedAll += set.size;
  assert(revealedAll === totalSeries, `revealing all days covers every series (${revealedAll}/${totalSeries})`);

  const day0 = revealedSeriesByEvent(days, 0);
  const day0Refs = days[0].refs.filter((r) => r.eventId === eid0);
  assert(
    day0.get(eid0) && day0.get(eid0).size === day0Refs.length,
    'revealing day 0 exposes exactly day 0\'s series'
  );
  // the day-0 set is a subset of the full set
  for (const key of day0.get(eid0)) {
    assert(fullByEvent.get(eid0).has(key), 'day-0 revealed key is within the full set');
  }
  assert(day0.get(eid0).has(seriesKey(day0Refs[0].stageId, day0Refs[0].matchId)), 'seriesKey round-trips');

  // revealing -1 reveals nothing
  assert(revealedSeriesByEvent(days, -1).size === 0, 'dayIndex -1 reveals nothing');

  // -- determinism: same seed ⇒ identical schedule -----------------------------
  const again = buildSlotSchedule(advanceCareerSlot(initCareer(SEED)).season.events.filter((e) => e.slotId === 'kickoff'));
  assert(JSON.stringify(again) === JSON.stringify(days), 'schedule is deterministic for a fixed seed');

  // -- empty input is handled --------------------------------------------------
  assert(buildSlotSchedule([]).length === 0, 'empty slot ⇒ empty schedule');
}
