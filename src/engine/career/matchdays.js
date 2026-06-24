/**
 * engine/career/matchdays.js — partition a played calendar slot into ordered
 * "match-days" for day-by-day reveal (the spectator pacing layer).
 *
 * The match/format/season ENGINE is untouched: a slot is still computed in one
 * atomic, deterministic `simEvent` pass. This module is a PURE post-hoc analysis
 * that takes the already-computed `SeasonEventEntry[]` of a single slot (1 entry
 * for an international slot, 4 region-tagged entries for a regional one) and
 * groups every series into an ordered list of match-days such that:
 *
 *   - a later day never contains a series whose competitors are decided by a
 *     series in a later day (rounds are revealed in dependency order), so the
 *     spoiler-gated Standings/Bracket/Leaders views build up correctly;
 *   - independent group/swiss stages that run in parallel (e.g. Kickoff's Group A
 *     and Group B) share the same day, as do the 4 regions of a regional slot;
 *   - the deciding bracket only begins after the group/swiss phase completes.
 *
 * Rounds within a stage are derived per stage kind:
 *   - bracket / gsl stages (a fixed match graph): by dependency DEPTH from the
 *     template, so each wave (e.g. all quarterfinals) is one day;
 *   - round-robin / swiss stages: greedily — a new round opens whenever the next
 *     series would reuse a team already playing this round (the natural matchday).
 * Stages are grouped into PHASES by a dependency-depth analysis of the
 * FormatDescriptor (a stage seeding only from `seed` is phase 0; one seeding from
 * another stage is a later phase). A match-day = (phase, round) unioned across all
 * parallel stages and all regional events.
 *
 * Pure, deterministic, no rng / Date / DOM. Inputs are never mutated.
 *
 * @typedef {Object} MatchDayRef
 * @property {string} eventId            owning EventResult id (e.g. 'kickoff-pacific' or 'm0')
 * @property {string|null} region        region for a regional slot, else null
 * @property {string} stageId
 * @property {string} matchId
 *
 * @typedef {Object} MatchDay
 * @property {number} dayIndex           0-based position in the slot
 * @property {number} phase              dependency phase (group stage = 0, playoff = 1, ...)
 * @property {number} roundIndex         round within the phase
 * @property {string} label              e.g. 'Group Stage · Round 2', 'Playoff · Round 1'
 * @property {MatchDayRef[]} refs        the series played that day across regions/stages
 */

import { buildTemplate } from '../format/bracket.js';
import { KICKOFF_FORMAT } from '../../config/formats/kickoff.js';
import { STAGE_FORMAT } from '../../config/formats/stage.js';
import { MASTERS_FORMAT } from '../../config/formats/masters.js';
import { CHAMPIONS_FORMAT } from '../../config/formats/champions.js';

/** SeasonEventEntry.type -> FormatDescriptor (for phase/dependency analysis). */
const FORMAT_BY_TYPE = Object.freeze({
  kickoff: KICKOFF_FORMAT,
  stage: STAGE_FORMAT,
  masters: MASTERS_FORMAT,
  champions: CHAMPIONS_FORMAT
});

/**
 * matchId -> 0-based round (dependency depth) for a fixed bracket/gsl template, so
 * every match in a wave (all quarterfinals, then all next-wave matches, …) shares
 * a round. Returns null if no template exists for this (type, size).
 *
 * @param {string} bracketType
 * @param {number} [size]
 * @returns {Map<string, number>|null}
 */
function bracketRoundOf(bracketType, size) {
  let template;
  try {
    template = buildTemplate(bracketType, size);
  } catch {
    return null;
  }
  const byId = new Map(template.map((m) => [m.id, m]));
  const memo = new Map();
  const feeder = (ref) => (ref && (ref.winnerOf || ref.loserOf)) || null;
  const depth = (id, seen) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const m = byId.get(id);
    let d = 0;
    if (m) {
      const da = feeder(m.a);
      const db = feeder(m.b);
      d = Math.max(da ? depth(da, seen) + 1 : 0, db ? depth(db, seen) + 1 : 0);
    }
    seen.delete(id);
    memo.set(id, d);
    return d;
  };
  const out = new Map();
  for (const m of template) out.set(m.id, depth(m.id, new Set()));
  return out;
}

/**
 * Swiss matchIds encode their round (`<stageId>-r2-m1`). matchId -> 0-based round.
 * @param {Array<object>} series
 * @returns {Map<string, number>}
 */
function swissRoundOf(series) {
  const out = new Map();
  for (const s of series || []) {
    const m = /-r(\d+)-/.exec((s && s.matchId) || '');
    out.set(s.matchId, m ? Number(m[1]) - 1 : 0);
  }
  return out;
}

/**
 * Circle-method round assignment for a round-robin of n teams: an unordered seed
 * pair `a-b` (a<b) -> its 0-based round in [0, n-2]. Each team plays once a round.
 * @param {number} n
 * @returns {Map<string, number>}
 */
function circleRounds(n) {
  const out = new Map();
  if (n < 2) return out;
  const m = n % 2 === 1 ? n + 1 : n; // pad an odd count with a bye seat (index m-1 >= n)
  const arr = Array.from({ length: m }, (_, k) => k);
  for (let r = 0; r < m - 1; r++) {
    for (let k = 0; k < m / 2; k++) {
      const a = arr[k];
      const b = arr[m - 1 - k];
      if (a < n && b < n) out.set(`${Math.min(a, b)}-${Math.max(a, b)}`, r);
    }
    // Rotate all but the first seat (standard circle method).
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(1, arr.length - 1, ...rest);
  }
  return out;
}

/**
 * Round-robin matchIds are `RR-i-j` (single) / `RR-i-j-r2` (second leg). Assign
 * each to its circle-method round (legs are offset so leg 2 follows leg 1).
 * @param {Array<object>} series
 * @returns {Map<string, number>}
 */
function roundRobinRoundOf(series) {
  const parsed = [];
  let n = 0;
  for (const s of series || []) {
    const mm = /^RR-(\d+)-(\d+)(?:-r(\d+))?$/.exec((s && s.matchId) || '');
    if (!mm) {
      parsed.push({ matchId: s.matchId, plain: true });
      continue;
    }
    const i = Number(mm[1]);
    const j = Number(mm[2]);
    const leg = mm[3] ? Number(mm[3]) - 1 : 0;
    n = Math.max(n, i + 1, j + 1);
    parsed.push({ matchId: s.matchId, i, j, leg });
  }
  const pairRound = circleRounds(n);
  const legLen = Math.max(1, n - 1);
  const out = new Map();
  for (const p of parsed) {
    if (p.plain) {
      out.set(p.matchId, 0);
      continue;
    }
    const base = pairRound.get(`${Math.min(p.i, p.j)}-${Math.max(p.i, p.j)}`) || 0;
    out.set(p.matchId, base + p.leg * legLen);
  }
  return out;
}

/**
 * Greedily group a stage's series (in their stored, topological order) into
 * rounds: a new round opens whenever the next series would reuse a team already
 * playing this round. A last-resort fallback when no round map is available.
 *
 * @param {Array<object>} series
 * @returns {Array<Array<object>>}
 */
function greedyRounds(series) {
  const rounds = [];
  let cur = [];
  let used = new Set();
  for (const s of series || []) {
    if (!s) continue;
    if (cur.length && (used.has(s.teamAId) || used.has(s.teamBId))) {
      rounds.push(cur);
      cur = [];
      used = new Set();
    }
    cur.push(s);
    used.add(s.teamAId);
    used.add(s.teamBId);
  }
  if (cur.length) rounds.push(cur);
  return rounds;
}

/**
 * Partition one stage's series into ordered rounds. With a bracket `roundOf` map,
 * bucket by dependency depth (clean waves); otherwise greedily by matchday.
 *
 * @param {Array<object>} series
 * @param {Map<string, number>|null} roundOf  matchId -> round, or null
 * @returns {Array<Array<object>>}
 */
function stageRounds(series, roundOf) {
  if (!roundOf) return greedyRounds(series);
  /** @type {Map<number, object[]>} */
  const byRound = new Map();
  for (const s of series || []) {
    if (!s) continue;
    const r = roundOf.has(s.matchId) ? roundOf.get(s.matchId) : 0;
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(s);
  }
  return [...byRound.keys()].sort((a, b) => a - b).map((r) => byRound.get(r));
}

/**
 * Assign each stage a dependency phase = the longest chain of stage→stage
 * dependencies ending at it (vocabulary-agnostic: a stage depends on another when
 * any entrant string field names that stage's id). Stages seeding only from
 * `seed` are phase 0.
 *
 * @param {Array<object>} stageDescs
 * @returns {Map<string, number>}
 */
function computePhases(stageDescs) {
  const stageIds = new Set(stageDescs.map((s) => s.id));
  const byId = new Map(stageDescs.map((s) => [s.id, s]));
  const memo = new Map();
  const depsOf = (stage) => {
    const deps = new Set();
    for (const e of stage.entrants || []) {
      for (const v of Object.values(e || {})) {
        if (typeof v === 'string' && stageIds.has(v)) deps.add(v);
      }
    }
    return deps;
  };
  const visit = (id, seen) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const stage = byId.get(id);
    let phase = 0;
    if (stage) for (const dep of depsOf(stage)) phase = Math.max(phase, visit(dep, seen) + 1);
    seen.delete(id);
    memo.set(id, phase);
    return phase;
  };
  for (const s of stageDescs) visit(s.id, new Set());
  return memo;
}

/** Human phase label from the descriptor kinds of the stages it groups. */
function phaseLabel(kinds) {
  const set = new Set(kinds);
  if (set.has('swiss')) return 'Swiss';
  if (set.has('roundRobin') || set.has('gsl')) return 'Group Stage';
  if (set.has('bracket')) return 'Playoff';
  return 'Stage';
}

/**
 * Build the ordered match-day schedule for one calendar slot.
 *
 * @param {Array<object>} slotEntries  SeasonEventEntry[] for ONE slot (1 or 4)
 * @returns {ReadonlyArray<MatchDay>} frozen, ordered match-days (empty if none)
 */
export function buildSlotSchedule(slotEntries) {
  const entries = (slotEntries || []).filter(Boolean);
  if (!entries.length) return Object.freeze([]);

  const descriptor = FORMAT_BY_TYPE[entries[0].type];
  const stageDescs = (descriptor && descriptor.stages) || [];
  const phaseOf = computePhases(stageDescs);

  // Descriptor-driven per-stage metadata: declared kind + bracket round map.
  const stageInfo = new Map();
  for (const sd of stageDescs) {
    stageInfo.set(sd.id, {
      kind: sd.kind,
      roundOf: sd.bracketType ? bracketRoundOf(sd.bracketType, sd.size) : null
    });
  }

  // Canonical ordered stage list from engine truth (first event's StageResults),
  // tagged with the DESCRIPTOR kind (the runner's reported kind can differ — gsl
  // runs through the bracket engine and reports 'bracket').
  const canonicalStages = ((entries[0].result && entries[0].result.stages) || []).map((s, i) => {
    const info = stageInfo.get(s.stageId);
    return {
      stageId: s.stageId,
      kind: info ? info.kind : s.kind,
      phase: phaseOf.has(s.stageId) ? phaseOf.get(s.stageId) : i
    };
  });

  // Per-event rounds per stage: events[i] -> Map(stageId -> rounds[][]). The round
  // map is chosen per stage kind — bracket/gsl by template depth, swiss by its
  // round-tagged matchIds, round-robin by the circle method.
  const evRounds = entries.map((e) => {
    const m = new Map();
    for (const st of (e.result && e.result.stages) || []) {
      const info = stageInfo.get(st.stageId);
      const kind = info ? info.kind : st.kind;
      let roundMap = info && info.roundOf ? info.roundOf : null;
      if (!roundMap) {
        if (kind === 'swiss') roundMap = swissRoundOf(st.series || []);
        else if (kind === 'roundRobin') roundMap = roundRobinRoundOf(st.series || []);
      }
      m.set(st.stageId, stageRounds(st.series || [], roundMap));
    }
    return m;
  });

  const phases = [...new Set(canonicalStages.map((s) => s.phase))].sort((a, b) => a - b);

  const days = [];
  let dayIndex = 0;
  for (const phase of phases) {
    const phaseStages = canonicalStages.filter((s) => s.phase === phase);
    const phaseStageIds = phaseStages.map((s) => s.stageId);
    const label = phaseLabel(phaseStages.map((s) => s.kind));

    let roundCount = 0;
    for (const rounds of evRounds) {
      for (const sid of phaseStageIds) {
        const r = rounds.get(sid);
        if (r && r.length > roundCount) roundCount = r.length;
      }
    }

    for (let r = 0; r < roundCount; r++) {
      const refs = [];
      for (let ei = 0; ei < entries.length; ei++) {
        const region = entries[ei].region || null;
        const eventId = entries[ei].result.eventId;
        const rounds = evRounds[ei];
        for (const sid of phaseStageIds) {
          const stageRoundsArr = rounds.get(sid);
          const round = stageRoundsArr && stageRoundsArr[r];
          if (round) {
            for (const s of round) {
              refs.push(Object.freeze({ eventId, region, stageId: sid, matchId: s.matchId }));
            }
          }
        }
      }
      if (!refs.length) continue;
      days.push(
        Object.freeze({
          dayIndex: dayIndex++,
          phase,
          roundIndex: r,
          label: roundCount > 1 ? `${label} · Round ${r + 1}` : label,
          refs: Object.freeze(refs)
        })
      );
    }
  }

  return Object.freeze(days);
}

/** Stable key for a series within its event (matchId is NOT unique across stages). */
export function seriesKey(stageId, matchId) {
  return `${stageId}::${matchId}`;
}

/**
 * Map eventId -> Set of revealed `seriesKey(stageId,matchId)` for days 0..dayIndex
 * (inclusive). Used to spoiler-gate the per-event standings/bracket/leaders views
 * to only the series "played" so far. An event absent from the map (e.g. a prior,
 * fully-played slot) is not gated.
 *
 * @param {ReadonlyArray<MatchDay>} schedule
 * @param {number} dayIndex   highest revealed day (inclusive); -1 reveals nothing
 * @returns {Map<string, Set<string>>}
 */
export function revealedSeriesByEvent(schedule, dayIndex) {
  const byEvent = new Map();
  const sched = schedule || [];
  const last = Math.min(typeof dayIndex === 'number' ? dayIndex : sched.length - 1, sched.length - 1);
  for (let i = 0; i <= last; i++) {
    for (const ref of sched[i].refs) {
      let set = byEvent.get(ref.eventId);
      if (!set) {
        set = new Set();
        byEvent.set(ref.eventId, set);
      }
      set.add(seriesKey(ref.stageId, ref.matchId));
    }
  }
  return byEvent;
}
