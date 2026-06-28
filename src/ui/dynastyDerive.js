/**
 * ui/dynastyDerive.js — the EPOCHS: a PURE derive layer over the frozen
 * per-season history ledger (`state.career.history[]`) + living team reputation.
 *
 * This module never touches the match / season engines — it only AGGREGATES the
 * facts the career already froze into history (champions, final CP standings,
 * per-event winners) plus each team's current prestige. So match results stay
 * byte-identical; this is texture, not simulation.
 *
 * What it derives:
 *   - DYNASTIES   — back-to-back / three-peat world-title streaks per team.
 *   - ERAS        — windows where one club captured a dominant share of all glory.
 *   - RIVALRIES   — cross-season head-to-head from where teams finished relative
 *                   to each other at the top of the final standings.
 *   - RECORDS     — all-time team records (most titles, longest dynasty, …).
 *   - PRESTIGE    — per-region texture + each team's per-season prestige arc.
 *
 * DOM-free and deterministic: no `document`/`window`, no `Math.random`, no
 * `Date`. Reads game truth ONLY through selectors. Every derivation is guarded
 * for empty / early-career worlds — a fresh save returns structured empties, not
 * NaN or a crash.
 */

import {
  selectCareerHistory,
  selectSeason,
  selectSeasonIndex,
  selectTeam
} from '../state/selectors.js';
import { BALANCE } from '../config/balance.js';
import { SLOT_LABELS, REGION_LABELS } from './eventFormats.js';

const R = BALANCE.CAREER.REPUTATION;

/* ------------------------------------------------------------------ */
/* tuning — PRESENTATION weights (not engine balance). Title worth is   */
/* borrowed from the engine's own reputation tiers so the cabinet, the   */
/* dynasty index and the world's prestige all agree on what a title is.  */
/* ------------------------------------------------------------------ */

/** Event types that count as a "title", most prestigious first. */
export const TITLE_TYPES = Object.freeze(['champions', 'masters', 'stage', 'kickoff']);

/** Weight of a title by type (engine reputation tiers — single source). */
function titleWeight(type) {
  switch (type) {
    case 'champions':
      return R.TITLE_CHAMPIONS;
    case 'masters':
      return R.TITLE_MASTERS;
    case 'stage':
      return R.TITLE_STAGE;
    case 'kickoff':
      return R.TITLE_KICKOFF;
    default:
      return 0;
  }
}

/** Rolling-window size (seasons) for the era / dominance index. */
const ERA_WINDOW = 3;
/** Min share of all glory in a window to qualify as a one-club "era". */
const ERA_SHARE_MIN = 0.34;
/** How deep into the final standings a "clash" still counts as a rivalry. */
const RIVALRY_TOPK = 8;
/** A pairing must recur at least this often to be a rivalry (not a one-off). */
const RIVALRY_MIN_MEETINGS = 2;
/** Default list length for the Hall-of-Fame tables. */
const TOP_N = 8;

/* ------------------------------------------------------------------ */
/* normalize the ledger into a flat, render-agnostic shape             */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} TitleWin
 * @property {number} seasonIndex
 * @property {string} type      event type ('champions'|'masters'|'stage'|'kickoff')
 * @property {string} slotId
 * @property {string|null} region
 * @property {boolean} current  true if won in the in-progress (not yet completed) season
 */

/**
 * @typedef {Object} SeasonRow
 * @property {number} seasonIndex
 * @property {string|null} champion          world champion teamId
 * @property {string[]} finalStandings        teamIds in final CP order (champion first)
 */

/**
 * Collect the whole career into a normalized bundle:
 *   - `titlesByTeam`   teamId -> TitleWin[] (completed history + decided current-season titles)
 *   - `seasons`        SeasonRow[] for COMPLETED seasons only (oldest -> newest)
 *   - `seasonsPlayed`  completed-season count
 *
 * Completed seasons drive champion/standings dynasty + rivalry logic (you can't
 * be champion of an unfinished year); current-season titles only enrich the
 * per-team cabinet/timeline (they're already-revealed results).
 *
 * @param {object} state
 * @returns {{ titlesByTeam: Map<string, TitleWin[]>, seasons: SeasonRow[], seasonsPlayed: number, currentSeasonIndex: number }}
 */
function collectLedger(state) {
  const history = selectCareerHistory(state) || [];
  const titlesByTeam = new Map();
  const seasons = [];

  const pushTitle = (teamId, win) => {
    if (!teamId) return;
    const list = titlesByTeam.get(teamId);
    if (list) list.push(win);
    else titlesByTeam.set(teamId, [win]);
  };

  for (const sum of history) {
    if (!sum) continue;
    const seasonIndex = sum.seasonIndex;
    for (const ev of sum.eventWinners || []) {
      if (!ev || !ev.winner) continue;
      pushTitle(ev.winner, {
        seasonIndex,
        type: ev.type,
        slotId: ev.slotId,
        region: ev.region || null,
        current: false
      });
    }
    seasons.push({
      seasonIndex,
      champion: sum.champion || null,
      finalStandings: Array.isArray(sum.finalStandings) ? sum.finalStandings : []
    });
  }

  // The in-progress season's already-decided titles (rank-1 placements), mirroring
  // selectTeamTrophies so the cabinet/timeline stay consistent with the engine.
  const season = selectSeason(state);
  const currentSeasonIndex = selectSeasonIndex(state);
  if (season) {
    for (const e of season.events || []) {
      const placements = (e.result && e.result.placements) || [];
      const top = placements.find((p) => p.rank === 1);
      if (top && top.teamId) {
        pushTitle(top.teamId, {
          seasonIndex: currentSeasonIndex,
          type: e.type,
          slotId: e.slotId,
          region: e.region || null,
          current: true
        });
      }
    }
  }

  seasons.sort((a, b) => a.seasonIndex - b.seasonIndex);
  return { titlesByTeam, seasons, seasonsPlayed: seasons.length, currentSeasonIndex };
}

/* ------------------------------------------------------------------ */
/* small shared maths                                                  */
/* ------------------------------------------------------------------ */

/** Count + weight + by-type breakdown for a team's title list. */
function tallyTitles(titles) {
  const byType = { champions: 0, masters: 0, stage: 0, kickoff: 0 };
  let weighted = 0;
  for (const t of titles) {
    if (byType[t.type] == null) byType[t.type] = 0;
    byType[t.type] += 1;
    weighted += titleWeight(t.type);
  }
  return { total: titles.length, weighted, byType };
}

/**
 * Longest runs of CONSECUTIVE seasons whose champion is `teamId`. Each run is a
 * dynasty span; length 2 = back-to-back, 3+ = three-peat / dynasty.
 * @param {SeasonRow[]} seasons  oldest -> newest
 * @param {string} teamId
 * @returns {Array<{length:number, startSeason:number, endSeason:number}>}
 */
function championStreaks(seasons, teamId) {
  const runs = [];
  let cur = null;
  for (const s of seasons) {
    if (s.champion && s.champion === teamId) {
      if (cur) {
        cur.length += 1;
        cur.endSeason = s.seasonIndex;
      } else {
        cur = { length: 1, startSeason: s.seasonIndex, endSeason: s.seasonIndex };
      }
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs.sort((a, b) => b.length - a.length || b.endSeason - a.endSeason);
}

/**
 * Per-season "glory score" used for the prestige arc + dominance index: the
 * weighted titles a team won that season, plus a small deep-finish credit for a
 * top placement (mirrors the engine's reputation-earned shape). Robust to a team
 * absent from the standings.
 * @param {SeasonRow} season
 * @param {TitleWin[]} seasonTitles  this team's titles in that season
 * @param {string} teamId
 * @returns {number}
 */
function gloryScore(season, seasonTitles, teamId) {
  let score = 0;
  for (const t of seasonTitles) score += titleWeight(t.type);
  const rank = season.finalStandings.indexOf(teamId);
  if (rank >= 0 && rank < RIVALRY_TOPK) {
    score += R.PLACEMENT_K * Math.pow(R.PLACEMENT_DECAY, rank);
  }
  return score;
}

/** Title labels (reuse the slot vocabulary, fall back to the type). */
const TITLE_LABEL = Object.freeze({
  champions: 'World Champion',
  masters: 'Masters',
  stage: 'Stage',
  kickoff: 'Kickoff'
});

/** Team display fields, guarded for a missing/renamed club. */
function teamFace(state, teamId) {
  const t = teamId ? selectTeam(state, teamId) : null;
  const name = (t && t.name) || teamId || '—';
  const tag = (t && t.tag) || (name ? String(name).slice(0, 3).toUpperCase() : '');
  return { name, tag, region: (t && t.region) || null };
}

/* ------------------------------------------------------------------ */
/* memo plumbing — derivations are pure over frozen, wholesale-replaced */
/* refs (career history, the season state, the teams table), so a tiny  */
/* last-input cache keyed by reference identity is sound.               */
/* ------------------------------------------------------------------ */

/** Single-slot reference-identity memoizer (mirrors selectors.memoOne). */
function memoOne(compute) {
  let lastKey = null;
  let lastValue;
  return (...args) => {
    const { key, value } = compute(...args);
    if (lastKey && lastKey.length === key.length && lastKey.every((k, i) => k === key[i])) {
      return lastValue;
    }
    lastKey = key;
    lastValue = value;
    return value;
  };
}

/** The reference set a dynasty derivation depends on. */
function depKey(state) {
  return [
    (state.career && state.career.history) || null,
    (state.season && state.season.state) || null,
    (state.world && state.world.teams) || null
  ];
}

/* ================================================================== */
/* PUBLIC — per-team dynasty (Team screen)                             */
/* ================================================================== */

/**
 * The dynasty model for one team's page: its trophy tally, a per-season title +
 * prestige TIMELINE, world-title streak spans, plain-language accolades, and the
 * club's current live prestige. Memoized on (history, season, teams, teamId).
 *
 * @param {object} state
 * @param {string} teamId
 * @returns {{
 *   hasHistory: boolean,
 *   total: number, weighted: number, champions: number,
 *   byType: Record<string, number>,
 *   reputation: number|null,
 *   timeline: Array<{ seasonIndex:number, titles:TitleWin[], titleCount:number, isChampion:boolean, current:boolean, score:number, pct:number }>,
 *   streaks: Array<{length:number, startSeason:number, endSeason:number}>,
 *   bestStreak: number,
 *   accolades: string[]
 * }}
 */
export const deriveTeamDynasty = memoOne((state, teamId) => ({
  key: [...depKey(state), teamId],
  value: computeTeamDynasty(state, teamId)
}));

function computeTeamDynasty(state, teamId) {
  const { titlesByTeam, seasons } = collectLedger(state);
  const titles = (teamId && titlesByTeam.get(teamId)) || [];
  const team = teamId ? selectTeam(state, teamId) : null;
  const reputation = team && typeof team.reputation === 'number' ? team.reputation : null;
  const { total, weighted, byType } = tallyTitles(titles);

  // Group a team's titles by season (newest first) into timeline rows.
  const bySeason = new Map();
  for (const t of titles) {
    const row = bySeason.get(t.seasonIndex);
    if (row) row.titles.push(t);
    else bySeason.set(t.seasonIndex, { seasonIndex: t.seasonIndex, titles: [t], current: t.current });
  }

  const championOf = new Map(seasons.map((s) => [s.seasonIndex, s.champion]));
  const seasonRowOf = new Map(seasons.map((s) => [s.seasonIndex, s]));

  const rows = [...bySeason.values()].map((row) => {
    const season = seasonRowOf.get(row.seasonIndex);
    const isChampion = championOf.get(row.seasonIndex) === teamId;
    const score = season ? gloryScore(season, row.titles, teamId) : row.titles.reduce((a, t) => a + titleWeight(t.type), 0);
    // Most prestigious title first within the season.
    row.titles.sort((a, b) => titleWeight(b.type) - titleWeight(a.type));
    return {
      seasonIndex: row.seasonIndex,
      titles: row.titles,
      titleCount: row.titles.length,
      isChampion,
      current: !!row.current,
      score
    };
  });
  rows.sort((a, b) => b.seasonIndex - a.seasonIndex);

  const maxScore = rows.reduce((m, r) => Math.max(m, r.score), 0) || 1;
  const timeline = rows.map((r) => ({ ...r, pct: Math.round((r.score / maxScore) * 100) }));

  const streaks = championStreaks(seasons, teamId);
  const bestStreak = streaks.length ? streaks[0].length : 0;
  const championCount = byType.champions || 0;

  return {
    hasHistory: total > 0,
    total,
    weighted,
    champions: championCount,
    byType,
    reputation,
    timeline,
    streaks,
    bestStreak,
    accolades: teamAccolades({ championCount, total, byType, streaks, timeline })
  };
}

/** Plain-language honours line(s) for a club's dynasty header. */
function teamAccolades({ championCount, total, byType, streaks, timeline }) {
  const out = [];
  if (championCount >= 1) {
    out.push(`${championCount}× World Champion`);
  }
  const big = streaks.find((s) => s.length >= 2);
  if (big) {
    const word = big.length >= 3 ? `${big.length}-peat` : 'Back-to-back';
    out.push(`${word} world titles (S${big.startSeason + 1}–S${big.endSeason + 1})`);
  }
  // The team's most loaded single season.
  let bestRow = null;
  for (const r of timeline) if (!bestRow || r.titleCount > bestRow.titleCount) bestRow = r;
  if (bestRow && bestRow.titleCount >= 3) {
    out.push(`${bestRow.titleCount} titles in S${bestRow.seasonIndex + 1}`);
  }
  if (!out.length && total >= 1) {
    const kind = byType.masters ? 'Masters winner' : byType.stage || byType.kickoff ? 'Regional title-holder' : 'Title-holder';
    out.push(kind);
  }
  return out;
}

/* ================================================================== */
/* PUBLIC — Hall of Fame / all-time records (HoF screen)              */
/* ================================================================== */

/**
 * The all-time model for the Hall of Fame screen.
 * @param {object} state
 * @returns {{
 *   empty: boolean,
 *   seasonsPlayed: number,
 *   decorated: Array<object>,
 *   dynasties: Array<object>,
 *   eras: Array<object>,
 *   rivalries: Array<object>,
 *   records: Array<{key:string, label:string, value:string, teamId:string|null, name:string|null, detail:string|null}>,
 *   regions: Array<object>
 * }}
 */
export const deriveHallOfFame = memoOne((state) => ({
  key: depKey(state),
  value: computeHallOfFame(state)
}));

function computeHallOfFame(state) {
  const { titlesByTeam, seasons, seasonsPlayed } = collectLedger(state);

  const decorated = decoratedTeams(state, titlesByTeam);
  const dynasties = allDynasties(state, seasons);
  const eras = detectEras(state, seasons, titlesByTeam);
  const rivalries = detectRivalries(state, seasons);
  const regions = regionPrestige(state, titlesByTeam);
  const records = allTimeRecords(state, { titlesByTeam, seasons, decorated, dynasties, rivalries, regions });

  const empty = decorated.length === 0;
  return { empty, seasonsPlayed, decorated, dynasties, eras, rivalries, records, regions };
}

/** Most-decorated clubs, ranked by weighted titles (then raw count, champions). */
function decoratedTeams(state, titlesByTeam) {
  const rows = [];
  for (const [teamId, titles] of titlesByTeam) {
    const { total, weighted, byType } = tallyTitles(titles);
    const face = teamFace(state, teamId);
    rows.push({
      teamId,
      name: face.name,
      tag: face.tag,
      region: face.region,
      total,
      weighted,
      byType,
      champions: byType.champions || 0
    });
  }
  rows.sort(
    (a, b) => b.weighted - a.weighted || b.total - a.total || b.champions - a.champions || a.name.localeCompare(b.name)
  );
  return rows;
}

/** Every world-title dynasty (consecutive-champion run ≥ 2), longest first. */
function allDynasties(state, seasons) {
  const champTeams = new Set(seasons.map((s) => s.champion).filter(Boolean));
  const out = [];
  for (const teamId of champTeams) {
    for (const run of championStreaks(seasons, teamId)) {
      if (run.length < 2) continue;
      const face = teamFace(state, teamId);
      out.push({
        teamId,
        name: face.name,
        tag: face.tag,
        region: face.region,
        length: run.length,
        startSeason: run.startSeason,
        endSeason: run.endSeason
      });
    }
  }
  out.sort((a, b) => b.length - a.length || a.startSeason - b.startSeason);
  return out.slice(0, TOP_N);
}

/**
 * Dominance eras: rolling-`ERA_WINDOW` windows where ONE club captured ≥
 * `ERA_SHARE_MIN` of all glory. Overlapping windows for the same club are merged
 * into the single widest span, so an era reads as one epoch, not three.
 */
function detectEras(state, seasons, titlesByTeam) {
  if (seasons.length < ERA_WINDOW) return [];

  // Per (season, team) glory, and a per-season total, for share maths.
  const titlesAt = new Map(); // `${seasonIndex}:${teamId}` -> titles[]
  for (const [teamId, titles] of titlesByTeam) {
    for (const t of titles) {
      const key = `${t.seasonIndex}:${teamId}`;
      const list = titlesAt.get(key);
      if (list) list.push(t);
      else titlesAt.set(key, [t]);
    }
  }
  const teamsBySeason = new Map(); // seasonIndex -> Set(teamIds with glory)
  for (const [teamId, titles] of titlesByTeam) {
    for (const t of titles) {
      let set = teamsBySeason.get(t.seasonIndex);
      if (!set) {
        set = new Set();
        teamsBySeason.set(t.seasonIndex, set);
      }
      set.add(teamId);
    }
  }

  const gloryFor = (season, teamId) => gloryScore(season, titlesAt.get(`${season.seasonIndex}:${teamId}`) || [], teamId);

  const raw = []; // { teamId, startSeason, endSeason, share }
  for (let i = 0; i + ERA_WINDOW <= seasons.length; i += 1) {
    const window = seasons.slice(i, i + ERA_WINDOW);
    const totals = new Map();
    let grand = 0;
    for (const s of window) {
      const contenders = teamsBySeason.get(s.seasonIndex);
      if (!contenders) continue;
      for (const teamId of contenders) {
        const g = gloryFor(s, teamId);
        totals.set(teamId, (totals.get(teamId) || 0) + g);
        grand += g;
      }
    }
    if (grand <= 0) continue;
    let bestTeam = null;
    let bestShare = 0;
    for (const [teamId, g] of totals) {
      const share = g / grand;
      if (share > bestShare) {
        bestShare = share;
        bestTeam = teamId;
      }
    }
    if (bestTeam && bestShare >= ERA_SHARE_MIN) {
      raw.push({
        teamId: bestTeam,
        startSeason: window[0].seasonIndex,
        endSeason: window[window.length - 1].seasonIndex,
        share: bestShare
      });
    }
  }

  // Merge adjacent/overlapping windows for the same club into one span.
  const merged = [];
  for (const era of raw) {
    const last = merged[merged.length - 1];
    if (last && last.teamId === era.teamId && era.startSeason <= last.endSeason + 1) {
      last.endSeason = Math.max(last.endSeason, era.endSeason);
      last.share = Math.max(last.share, era.share);
    } else {
      merged.push({ ...era });
    }
  }

  return merged
    .map((e) => {
      const face = teamFace(state, e.teamId);
      return { ...e, name: face.name, tag: face.tag, region: face.region, share: Math.round(e.share * 100) };
    })
    .sort((a, b) => b.share - a.share || b.endSeason - b.startSeason - (a.endSeason - a.startSeason))
    .slice(0, TOP_N);
}

/**
 * Cross-season rivalries: a head-to-head from how often two clubs finished near
 * the TOP of the same season's final standings and which one came out ahead. A
 * clash high up the table (a true playoff-tier meeting) weighs more than one at
 * the fringe of the top eight. Only recurring pairings (≥ RIVALRY_MIN_MEETINGS)
 * surface — a one-off isn't a rivalry.
 */
function detectRivalries(state, seasons) {
  const pairs = new Map(); // `${a}|${b}` (a<b) -> agg
  for (const s of seasons) {
    const top = s.finalStandings.slice(0, RIVALRY_TOPK);
    for (let i = 0; i < top.length; i += 1) {
      for (let j = i + 1; j < top.length; j += 1) {
        const hi = top[i];
        const lo = top[j];
        if (!hi || !lo || hi === lo) continue;
        const a = hi < lo ? hi : lo;
        const b = hi < lo ? lo : hi;
        const key = `${a}|${b}`;
        let agg = pairs.get(key);
        if (!agg) {
          agg = { a, b, meetings: 0, aWins: 0, bWins: 0, weight: 0, bestSeason: s.seasonIndex, bestRank: RIVALRY_TOPK };
          pairs.set(key, agg);
        }
        agg.meetings += 1;
        // hi finished above lo this season.
        if (hi === a) agg.aWins += 1;
        else agg.bWins += 1;
        const clash = RIVALRY_TOPK - i + (RIVALRY_TOPK - j);
        agg.weight += clash;
        if (i < agg.bestRank) {
          agg.bestRank = i;
          agg.bestSeason = s.seasonIndex;
        }
      }
    }
  }

  const out = [];
  for (const agg of pairs.values()) {
    if (agg.meetings < RIVALRY_MIN_MEETINGS) continue;
    const aFace = teamFace(state, agg.a);
    const bFace = teamFace(state, agg.b);
    out.push({
      aId: agg.a,
      bId: agg.b,
      aName: aFace.name,
      bName: bFace.name,
      aTag: aFace.tag,
      bTag: bFace.tag,
      meetings: agg.meetings,
      aWins: agg.aWins,
      bWins: agg.bWins,
      weight: agg.weight,
      bestSeason: agg.bestSeason
    });
  }
  out.sort((a, b) => b.weight - a.weight || b.meetings - a.meetings);
  return out.slice(0, TOP_N);
}

/** Regional prestige texture: titles, world championships + weighted glory by region. */
function regionPrestige(state, titlesByTeam) {
  const byRegion = new Map();
  for (const [teamId, titles] of titlesByTeam) {
    const face = teamFace(state, teamId);
    const region = face.region;
    if (!region) continue;
    let agg = byRegion.get(region);
    if (!agg) {
      agg = { region, titles: 0, champions: 0, weighted: 0, topTeam: null, _topWeighted: -1 };
      byRegion.set(region, agg);
    }
    const tally = tallyTitles(titles);
    agg.titles += tally.total;
    agg.champions += tally.byType.champions || 0;
    agg.weighted += tally.weighted;
    if (tally.weighted > agg._topWeighted) {
      agg._topWeighted = tally.weighted;
      agg.topTeam = face.name;
    }
  }
  const out = [...byRegion.values()].map((a) => ({
    region: a.region,
    label: REGION_LABELS[a.region] || a.region,
    titles: a.titles,
    champions: a.champions,
    weighted: a.weighted,
    topTeam: a.topTeam
  }));
  out.sort((a, b) => b.weighted - a.weighted || b.titles - a.titles);
  return out;
}

/** A short list of headline all-time records, each guarded for missing data. */
function allTimeRecords(state, { titlesByTeam, seasons, decorated, dynasties, rivalries, regions }) {
  const records = [];
  const add = (key, label, value, teamId, name, detail) =>
    records.push({ key, label, value: String(value), teamId: teamId || null, name: name || null, detail: detail || null });

  // Most world championships.
  let champLeader = null;
  for (const row of decorated) {
    if (!champLeader || row.champions > champLeader.champions) champLeader = row;
  }
  if (champLeader && champLeader.champions > 0) {
    add('most-champions', 'Most World Championships', champLeader.champions, champLeader.teamId, champLeader.name, slotName('champions'));
  }

  // Most total titles.
  if (decorated.length) {
    const top = decorated[0];
    add('most-titles', 'Most Titles (all-time)', top.total, top.teamId, top.name, `${top.weighted} prestige pts`);
  }

  // Most titles in a single season.
  let bestSeasonRow = null;
  const perSeason = new Map(); // `${seasonIndex}:${teamId}` -> count
  for (const [teamId, titles] of titlesByTeam) {
    for (const t of titles) {
      const key = `${t.seasonIndex}:${teamId}`;
      const n = (perSeason.get(key) || 0) + 1;
      perSeason.set(key, n);
      if (!bestSeasonRow || n > bestSeasonRow.count) bestSeasonRow = { teamId, seasonIndex: t.seasonIndex, count: n };
    }
  }
  if (bestSeasonRow && bestSeasonRow.count >= 2) {
    const face = teamFace(state, bestSeasonRow.teamId);
    add('season-sweep', 'Most Titles in One Season', bestSeasonRow.count, bestSeasonRow.teamId, face.name, `Season ${bestSeasonRow.seasonIndex + 1}`);
  }

  // Longest world-title dynasty.
  if (dynasties.length) {
    const d = dynasties[0];
    add('longest-dynasty', 'Longest Dynasty', `${d.length} in a row`, d.teamId, d.name, `S${d.startSeason + 1}–S${d.endSeason + 1}`);
  }

  // Fiercest rivalry.
  if (rivalries.length) {
    const r = rivalries[0];
    add('top-rivalry', 'Fiercest Rivalry', `${r.meetings} meetings`, null, `${r.aName} vs ${r.bName}`, `${r.aWins}–${r.bWins} head-to-head`);
  }

  // Highest current prestige (live reputation).
  let prestigeLeader = null;
  for (const t of Object.values(state.world.teams || {})) {
    if (!t || typeof t.reputation !== 'number') continue;
    if (!prestigeLeader || t.reputation > prestigeLeader.reputation) prestigeLeader = t;
  }
  if (prestigeLeader) {
    add('top-prestige', 'Highest Prestige Today', Math.round(prestigeLeader.reputation), prestigeLeader.id, prestigeLeader.name || prestigeLeader.id, 'live reputation');
  }

  // Most decorated region.
  if (regions.length) {
    const reg = regions[0];
    add('top-region', 'Most Decorated Region', reg.titles, null, reg.label, `${reg.champions} world title${reg.champions === 1 ? '' : 's'}`);
  }

  return records;
}

/** Human label for a title type. */
export function titleLabel(type) {
  return TITLE_LABEL[type] || type;
}

/** Human label for a slot id (re-exported convenience for the screens). */
export function slotName(slotId) {
  return SLOT_LABELS[slotId] || slotId;
}
