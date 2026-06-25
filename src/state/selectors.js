/**
 * state/selectors.js — pure derivations over the Phase-3 state tree
 * (CONTRACTS-UI §3). The UI reads game truth ONLY through these.
 *
 * All selectors are pure functions of `state` (+ ids). The expensive joins
 * (placements ⨝ awardCP/qualifiers, standings rows, leaders across every
 * series) are memoized by a tiny last-input cache keyed on the underlying
 * EventResult reference — EventResults are frozen and only ever replaced
 * wholesale, so reference identity is a sound cache key.
 *
 * No DOM, no randomness. Engine glue (awardCP, kickoffQualifiers, CP_TABLE)
 * is imported from the career layer.
 */

import { awardCP, cpStandings } from '../engine/career/championshipPoints.js';
import { kickoffQualifiers } from '../engine/career/qualification.js';
import { computeSeasonAwards } from '../engine/career/awards.js';
import { seasonPrizeMoney, wageBill, sponsorIncome } from '../engine/career/economy.js';
import { transferFee, playerValue } from '../engine/career/offseason/transfers.js';
import { salaryFor } from '../engine/career/offseason/contracts.js';
import { teamAttractiveness, seasonSuccessScore } from '../engine/career/attractiveness.js';
import { revealedSeriesByEvent, seriesKey } from '../engine/career/matchdays.js';
import { ratePlayersOverSeries } from '../engine/career/rating.js';
import { computeRankings } from '../engine/career/ranking.js';
import { getRevealedTraits } from '../engine/career/scouting.js';
import { CP_TABLE } from '../config/cpTable.js';
import { TIER2_TEAMS_BY_REGION, TIER2_REGION_ORDER } from '../data/seed/tier2.js';

/* ----------------------------- world ----------------------------- */

/** @param {object} state */
export const selectWorld = (state) => state.world;

/** @param {object} state */
export const selectRoute = (state) => state.ui.route;

/**
 * The ui-held save-slot list (CONTRACTS-PERSIST §6). Because slot listing is
 * async, the SaveLoad screen never calls listSlots() itself — it renders from
 * this snapshot, which refreshSlots(store) (bootstrap / Save / Delete / etc.)
 * repopulates by awaiting saveManager.listSlots() then dispatching setSaveSlots.
 * @param {object} state
 * @returns {Array<object>} slot metas, most-recently-played first
 */
export const selectSaveSlots = (state) =>
  (state.ui && state.ui.saveSlots) || [];

/** @param {object} state */
export const selectFollowedTeam = (state) => {
  const id = state.ui.followedTeamId;
  return id ? state.world.teams[id] || null : null;
};

/**
 * All teams as an array (stable order = world.teams key order).
 * @param {object} state
 * @returns {object[]}
 */
export const selectTeams = (state) => Object.values(state.world.teams);

/** @param {object} state @param {string} id */
export const selectTeam = (state, id) => state.world.teams[id] || null;

/** @param {object} state @param {string} id */
export const selectPlayer = (state, id) => state.world.players[id] || null;

/**
 * A team's roster as full Player objects (in roster order), skipping any missing.
 * @param {object} state @param {string} teamId
 * @returns {object[]}
 */
export const selectRoster = (state, teamId) => {
  const team = state.world.teams[teamId];
  if (!team || !Array.isArray(team.roster)) return [];
  return team.roster.map((id) => state.world.players[id]).filter(Boolean);
};

/**
 * All current free agents (unsigned, not retired), strongest first by overall.
 * @param {object} state
 * @returns {object[]}
 */
export const selectFreeAgents = (state) => {
  const players = Object.values(state.world.players || {});
  return players
    .filter((p) => p && p.contract && p.contract.status === 'free_agent')
    .sort((a, b) => meanOverall(b) - meanOverall(a));
};

/** Mean of a player's nine attributes (UI "overall"). */
function meanOverall(p) {
  const a = (p && p.attributes) || {};
  const keys = ['aim', 'movement', 'reaction', 'composure', 'consistency', 'gameSense', 'utility', 'trading', 'igl'];
  let sum = 0;
  let n = 0;
  for (const k of keys) {
    if (typeof a[k] === 'number') {
      sum += a[k];
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
};

/* ----------------------------- career ---------------------------- */

/** The career-meta slice (seasonIndex, history, offseason, phase, seed). */
export const selectCareer = (state) => state.career || null;

/** The current season ordinal (0-based). */
export const selectSeasonIndex = (state) => (state.career && state.career.seasonIndex) || 0;

/** The career phase: 'inSeason' | 'offseason'. */
export const selectCareerPhase = (state) => (state.career && state.career.phase) || 'inSeason';

/** Completed-season summaries (champions of past years), oldest first. */
export const selectCareerHistory = (state) => (state.career && state.career.history) || [];

/** The most recent OffseasonReport, or null. */
export const selectOffseasonReport = (state) => (state.career && state.career.offseason) || null;

/**
 * Aggregate the most-recent off-season's transfer activity into a league-wide
 * Transfer Window board (the spectator view): headline buys (by fee) and free-agent
 * signings (by wage), a per-club spend/receive/net board, league money leaders, and
 * window totals. Names/budgets resolve against the post-window world. Returns null
 * if no off-season has run yet.
 *
 * @param {object} state
 * @returns {null | { season:number, deals:object[], signings:object[], byClub:object[],
 *   moneyLeaders:object[], totalFees:number, count:number, signingCount:number, biggest:object|null }}
 */
export const selectTransferWindow = (state) => {
  const report = selectOffseasonReport(state);
  if (!report) return null;
  const players = (state.world && state.world.players) || {};
  const teams = (state.world && state.world.teams) || {};
  const pname = (id) => { const p = players[id]; return p ? (p.handle || p.name || id) : id; };
  const prole = (id) => { const p = players[id]; return (p && p.role) || ''; };
  const tname = (id) => { const t = teams[id]; return (t && t.name) || id; };
  const ttag = (id) => { const t = teams[id]; return (t && t.tag) || id; };

  const moves = report.transfers || [];
  const transfers = moves.filter((m) => m.kind === 'transfer'); // fee-paying buys
  const signings = moves.filter((m) => m.kind === 'signing' && m.toTeamId); // free-agent signings

  // Per-club spend board: fees out (bought) vs fees in (sold), with post-window budget.
  const byClubMap = new Map();
  const club = (id) => {
    if (!byClubMap.has(id)) {
      byClubMap.set(id, { teamId: id, name: tname(id), tag: ttag(id), spent: 0, received: 0, buys: 0, sales: 0, budget: (teams[id] && teams[id].budget) || 0 });
    }
    return byClubMap.get(id);
  };
  for (const m of transfers) {
    if (m.toTeamId) { const c = club(m.toTeamId); c.spent += m.fee || 0; c.buys += 1; }
    if (m.fromTeamId) { const c = club(m.fromTeamId); c.received += m.fee || 0; c.sales += 1; }
  }
  const byClub = [...byClubMap.values()]
    .map((c) => ({ ...c, net: c.received - c.spent }))
    .sort((a, b) => (b.spent - a.spent) || (a.teamId < b.teamId ? -1 : 1));

  const deals = transfers
    .slice()
    .sort((a, b) => (b.fee || 0) - (a.fee || 0))
    .map((m) => ({ player: pname(m.playerId), role: prole(m.playerId), ovr: meanOverall(players[m.playerId]), age: (players[m.playerId] && players[m.playerId].age) || null, fromId: m.fromTeamId, fromTag: ttag(m.fromTeamId), from: tname(m.fromTeamId), toId: m.toTeamId, to: tname(m.toTeamId), toTag: ttag(m.toTeamId), fee: m.fee || 0, salary: m.salary || 0 }));

  const topSignings = signings
    .slice()
    .sort((a, b) => (b.salary || 0) - (a.salary || 0))
    .map((m) => ({ player: pname(m.playerId), role: prole(m.playerId), ovr: meanOverall(players[m.playerId]), age: (players[m.playerId] && players[m.playerId].age) || null, toId: m.toTeamId, to: tname(m.toTeamId), toTag: ttag(m.toTeamId), salary: m.salary || 0 }));

  const totalFees = transfers.reduce((s, m) => s + (m.fee || 0), 0);
  const moneyLeaders = Object.values(teams)
    .map((t) => ({ teamId: t.id, name: t.name, tag: t.tag, budget: t.budget || 0 }))
    .sort((a, b) => (b.budget - a.budget) || (a.teamId < b.teamId ? -1 : 1));

  return {
    season: report.season,
    deals,
    signings: topSignings,
    byClub,
    moneyLeaders,
    totalFees,
    count: transfers.length,
    signingCount: signings.length,
    biggest: deals.length ? deals[0] : null
  };
};

/**
 * A team's trophy cabinet across the whole career — every event it has WON (rank
 * 1), from completed seasons (`history[].eventWinners`) plus the in-progress
 * season's events. Grouped by event type with a flat list (newest first).
 * @param {object} state @param {string} teamId
 * @returns {{ byType:Record<string,number>, total:number, list:Array<{seasonIndex:number, slotId:string, region:string|null, type:string}> }}
 */
export const selectTeamTrophies = (state, teamId) => {
  const list = [];
  if (teamId) {
    const history = (state.career && state.career.history) || [];
    for (const sum of history) {
      for (const ev of sum.eventWinners || []) {
        if (ev.winner === teamId) {
          list.push({ seasonIndex: sum.seasonIndex, slotId: ev.slotId, region: ev.region || null, type: ev.type });
        }
      }
    }
    const season = selectSeason(state);
    const curIdx = (state.career && state.career.seasonIndex) || 0;
    if (season) {
      for (const e of season.events || []) {
        const top = (e.result && e.result.placements ? e.result.placements : []).find((p) => p.rank === 1);
        if (top && top.teamId === teamId) {
          list.push({ seasonIndex: curIdx, slotId: e.slotId, region: e.region || null, type: e.type });
        }
      }
    }
  }
  list.sort((a, b) => b.seasonIndex - a.seasonIndex);
  const byType = {};
  for (const t of list) byType[t.type] = (byType[t.type] || 0) + 1;
  return { byType, total: list.length, list };
};

/* ---------------------------- transfers -------------------------- */

/** The user's brokered-move log for the open transfer window (oldest first). */
export const selectTransferMoves = (state) => (state.transfers && state.transfers.moves) || [];

/**
 * A team's pull on talent (0..100, rounded) — prestige + recent success + money.
 * @param {object} state @param {string} teamId
 * @returns {number}
 */
export const selectTeamAttractiveness = (state, teamId) => {
  const team = state.world.teams[teamId];
  if (!team) return 0;
  const season = selectSeason(state);
  const success = season ? seasonSuccessScore(season, teamId) : 0;
  return Math.round(teamAttractiveness(team, { success }));
};

/**
 * Buy targets for a team (P13): contracted players at OTHER clubs the manager
 * could bid for, value-sorted, each with its transfer fee (trimmed by this club's
 * coach negotiation) and wage. Capped for display.
 * @param {object} state @param {string} teamId @param {number} [limit]
 * @returns {Array<{player:object, seller:object, fee:number, wage:number}>}
 */
export const selectBuyTargets = (state, teamId, limit = 30) => {
  const team = state.world.teams[teamId];
  if (!team) return [];
  const nego = team.coach ? team.coach.negotiation : 0;
  const season = selectSeasonIndex(state);
  const players = state.world.players || {};
  const out = [];
  for (const id of Object.keys(players)) {
    const p = players[id];
    const c = p && p.contract;
    if (!c || c.status !== 'active' || !c.teamId || c.teamId === teamId) continue;
    const seller = state.world.teams[c.teamId];
    if (!seller) continue;
    out.push({ player: p, seller, fee: transferFee(p, seller, { season, coachNego: nego }), wage: salaryFor(p) });
  }
  out.sort((a, b) => playerValue(b.player) - playerValue(a.player) || (a.player.id < b.player.id ? -1 : 1));
  return out.slice(0, limit);
};

/* ----------------------------- economy --------------------------- */

/**
 * A team's finances (CONTRACTS-POLISH P7e): current budget, prize money earned so
 * far this season, recurring sponsor income, the seasonal wage bill, and the
 * projected net (prize + sponsor − wages). Null if the team is unknown.
 * @param {object} state @param {string} teamId
 * @returns {{budget:number, seasonPrize:number, sponsor:number, wageBill:number, net:number}|null}
 */
export const selectTeamFinances = (state, teamId) => {
  const team = state.world.teams[teamId];
  if (!team) return null;
  const season = selectSeason(state);
  const seasonPrize = season ? (seasonPrizeMoney(season).get(teamId) || 0) : 0;
  const sponsor = sponsorIncome(team);
  const wages = wageBill(team, state.world.players);
  return { budget: Number(team.budget) || 0, seasonPrize, sponsor, wageBill: wages, net: seasonPrize + sponsor - wages };
};

/**
 * Per-player salary breakdown for a team's roster, sorted by salary descending.
 * @param {object} state @param {string} teamId
 * @returns {Array<{player:object, salary:number, expires:number}>}
 */
export const selectPayrollBreakdown = (state, teamId) => {
  const team = state.world.teams[teamId];
  if (!team || !Array.isArray(team.roster)) return [];
  return team.roster
    .map((id) => {
      const p = state.world.players[id];
      if (!p) return null;
      const salary = (p.contract && typeof p.contract.salary === 'number') ? p.contract.salary : 0;
      const expires = (p.contract && typeof p.contract.expires === 'number') ? p.contract.expires : 0;
      return { player: p, salary, expires };
    })
    .filter(Boolean)
    .sort((a, b) => b.salary - a.salary || (a.player.id < b.player.id ? -1 : 1));
};

/**
 * Transfer-window balance for the followed team: fees received from sales,
 * fees spent on purchases, and net. Reads from the open-window transfer log.
 * @param {object} state @param {string} teamId
 * @returns {{received:number, spent:number, net:number}}
 */
export const selectTransferBalance = (state, teamId) => {
  const moves = (state.transfers && state.transfers.moves) || [];
  let received = 0;
  let spent = 0;
  for (const m of moves) {
    if (!m || m.kind !== 'transfer' || typeof m.fee !== 'number') continue;
    if (m.fromTeamId === teamId) received += m.fee;
    if (m.toTeamId === teamId) spent += m.fee;
  }
  return { received, spent, net: received - spent };
};

/* ----------------------------- awards ---------------------------- */

/**
 * The CURRENT (in-progress / just-finished) season's awards, computed from its
 * box scores (CONTRACTS-POLISH §1). Null before a season is inited; an all-null
 * awards object before any maps are played. Past seasons carry their awards in
 * `history[i].awards` (see selectCareerHistory). Memoized on the season events +
 * player table so it recomputes only when a slot is played.
 * @param {object} state
 * @returns {import('../engine/career/awards.js').SeasonAwards|null}
 */
export const selectSeasonAwards = (state) => {
  const season = selectSeason(state);
  if (!season) return null;
  return computeAwards(season, state.world.players, state.world.teams, state.world.leagues);
};

/* ----------------------------- inbox ----------------------------- */

/** All inbox items, NEWEST FIRST (the slice stores them oldest-first). */
export const selectInbox = (state) => {
  const items = (state.inbox && state.inbox.items) || [];
  return items.slice().reverse();
};

/** The N most-recent inbox items, newest first. */
export const selectRecentNews = (state, n = 6) => selectInbox(state).slice(0, n);

/** Count of unread inbox items. */
export const selectUnreadNews = (state) => {
  const items = (state.inbox && state.inbox.items) || [];
  let n = 0;
  for (const it of items) if (!it.read) n += 1;
  return n;
};

/* ----------------------------- season ---------------------------- */

/**
 * The live SeasonState (source of truth), or null before bootstrap/init.
 * @param {object} state
 * @returns {import('../engine/career/season.js').SeasonState|null}
 */
export const selectSeason = (state) => (state.season && state.season.state) || null;

/**
 * The season calendar (the CALENDAR slot array), or [] before init.
 * @param {object} state
 * @returns {ReadonlyArray<object>}
 */
export const selectCalendar = (state) => {
  const s = selectSeason(state);
  return (s && s.calendar) || [];
};

/**
 * How many calendar slots have been played so far (== season.slotIndex).
 * @param {object} state
 * @returns {number}
 */
export const selectSlotsPlayed = (state) => {
  const s = selectSeason(state);
  return s ? s.slotIndex : 0;
};

/**
 * A calendar slot by its index, with its completed event entries attached.
 * Returns `{ slot, index, played, entries }` where `entries` are the season
 * event entries that belong to this slot (4 region-tagged for a regional slot,
 * 1 for an international slot), or null if `index` is out of range.
 *
 * @param {object} state
 * @param {number} slotIndex
 * @returns {{slot:object, index:number, played:boolean, entries:object[]}|null}
 */
export const selectSlot = (state, slotIndex) => {
  const s = selectSeason(state);
  if (!s) return null;
  const slot = s.calendar[slotIndex];
  if (!slot) return null;
  const entries = s.events.filter((e) => e.slotId === slot.id);
  return {
    slot,
    index: slotIndex,
    played: slotIndex < s.slotIndex,
    entries
  };
};

/**
 * The cumulative Championship-Points standings: [{teamId, cp}] sorted desc
 * (teamId tiebreak). Empty before any CP is awarded.
 * @param {object} state
 * @returns {Array<{teamId:string, cp:number}>}
 */
export const selectCPStandings = (state) => {
  const s = selectSeason(state);
  if (!s || !s.ledger) return [];
  return cpStandings(s.ledger);
};

/**
 * The 16-team Champions field seed order (index 0 = m2 direct slot), or null
 * until the Champions slot has been reached.
 * @param {object} state
 * @returns {string[]|null}
 */
export const selectChampionsField = (state) => {
  const s = selectSeason(state);
  return (s && s.championsField) || null;
};

/**
 * The crowned World Champion teamId, or null until the season is complete.
 * @param {object} state
 * @returns {string|null}
 */
export const selectChampion = (state) => {
  const s = selectSeason(state);
  return (s && s.champion) || null;
};

/* ----------------------------- reveal ---------------------------- */

/** The match-day reveal slice (slotId, schedule, dayIndex, totalDays) or null. */
export const selectReveal = (state) => state.reveal || null;

/** Highest revealed day index for the active slot (-1 = nothing yet). */
export const selectRevealDay = (state) => (state.reveal ? state.reveal.dayIndex : -1);

/** Total match-days in the active slot's schedule. */
export const selectRevealTotalDays = (state) => (state.reveal ? state.reveal.totalDays : 0);

/** The calendar slot id currently being revealed day-by-day, or null. */
export const selectRevealSlotId = (state) => (state.reveal ? state.reveal.slotId : null);

/** True while the active slot still has unrevealed days to play through. */
export const selectRevealInProgress = (state) => {
  const r = state.reveal;
  return !!(r && r.slotId && r.dayIndex < r.totalDays - 1);
};

/** The MatchDay object at the reveal cursor, or null. */
export const selectCurrentMatchDay = (state) => {
  const r = state.reveal;
  if (!r || !r.schedule || r.dayIndex < 0) return null;
  return r.schedule[r.dayIndex] || null;
};

/**
 * The current match-day's games, each joined to its resolved SeriesRef + teams:
 * [{ ref, series, teamA, teamB }]. Reads the (ungated) events mirror — every ref
 * is by definition already revealed.
 * @param {object} state
 * @returns {Array<{ref:object, series:object|null, teamA:object|null, teamB:object|null}>}
 */
export const selectMatchDaySeries = (state) => {
  const day = selectCurrentMatchDay(state);
  if (!day) return [];
  const byId = state.events.byId;
  return day.refs.map((ref) => {
    const ev = byId[ref.eventId];
    const series =
      ev && Array.isArray(ev.series)
        ? ev.series.find((s) => s.stageId === ref.stageId && s.matchId === ref.matchId) || null
        : null;
    return {
      ref,
      series,
      teamA: series ? state.world.teams[series.teamAId] || null : null,
      teamB: series ? state.world.teams[series.teamBId] || null : null
    };
  });
};

/* ----------------------- spoiler gating -------------------------- */

/**
 * During a slot's day-by-day reveal, the Standings/Bracket/Leaders views must
 * show only the series played so far. `gated(state, event)` returns the event
 * clipped to the revealed series for that event (or the event unchanged when no
 * reveal is active, the event isn't part of the active reveal, or it's already
 * fully revealed). Centralizing this at event-resolution gates every downstream
 * selector (standings/stage/placements/leaders) and the Bracket view at once.
 */
const computeRevealedMap = memoOne((schedule, dayIndex) => ({
  key: [schedule, dayIndex],
  value: revealedSeriesByEvent(schedule, dayIndex)
}));

/** Map eventId -> revealed series-key Set for the active reveal, or null. */
function revealMap(state) {
  const r = state.reveal;
  if (!r || !r.schedule || r.schedule.length === 0) return null;
  return computeRevealedMap(r.schedule, r.dayIndex);
}

/** event -> Map(revealedSet -> gated clone), so gated events keep a stable ref. */
const GATE_CACHE = new WeakMap();

/** Per-team series record from a subset of series (generic, any stage kind). */
function recordInto(rec, s, side) {
  if (!rec) return;
  const score = s.score || { A: 0, B: 0 };
  const my = side === 'A' ? score.A : score.B;
  const opp = side === 'A' ? score.B : score.A;
  if (s.winnerId === rec.teamId) rec.w += 1;
  else rec.l += 1;
  rec.mapW += my || 0;
  rec.mapL += opp || 0;
  for (const m of s.maps || []) {
    if (m && m.score) {
      const rw = side === 'A' ? m.score.A : m.score.B;
      const rl = side === 'A' ? m.score.B : m.score.A;
      rec.roundDiff += (rw || 0) - (rl || 0);
    }
  }
}

/** Standings rows derived from a (partial) series list over a fixed team set. */
function standingsFromSeries(teamIds, series) {
  const rec = new Map();
  for (const t of teamIds) rec.set(t, { teamId: t, rank: 0, w: 0, l: 0, mapW: 0, mapL: 0, roundDiff: 0 });
  for (const s of series) {
    recordInto(rec.get(s.teamAId), s, 'A');
    recordInto(rec.get(s.teamBId), s, 'B');
  }
  const rows = [...rec.values()].sort(
    (a, b) =>
      b.w - a.w ||
      b.mapW - b.mapL - (a.mapW - a.mapL) ||
      b.roundDiff - a.roundDiff ||
      String(a.teamId).localeCompare(String(b.teamId))
  );
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

/** Distinct teamIds (in first-seen order) appearing in a series list. */
function teamIdsOf(series) {
  const ids = [];
  const seen = new Set();
  for (const s of series) {
    for (const id of [s.teamAId, s.teamBId]) {
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/** Build the spoiler-clipped clone of an event for a revealed-series set. */
function buildGatedEvent(event, revealedSet) {
  const shown = (stageId, matchId) => revealedSet.has(seriesKey(stageId, matchId));
  const stages = (event.stages || []).map((st) => {
    const full = st.series || [];
    const visible = full.filter((s) => shown(st.stageId, s.matchId));
    return { ...st, series: visible, standings: standingsFromSeries(teamIdsOf(full), visible) };
  });
  const series = (event.series || []).filter((s) => shown(s.stageId, s.matchId));
  // Final placements are only meaningful once the event is fully played.
  return { ...event, stages, series, placements: [] };
}

/** Clip an event to the active reveal (memoized per event+set for stable refs). */
function gated(state, event) {
  if (!event) return event;
  const map = revealMap(state);
  if (!map) return event;
  const set = map.get(event.eventId);
  if (!set) return event; // event not part of the active reveal (e.g. a prior slot)
  if (set.size >= (event.series || []).length) return event; // fully revealed → canonical
  let perEvent = GATE_CACHE.get(event);
  if (!perEvent) {
    perEvent = new Map();
    GATE_CACHE.set(event, perEvent);
  }
  let g = perEvent.get(set);
  if (!g) {
    g = buildGatedEvent(event, set);
    perEvent.set(set, g);
  }
  return g;
}

/* ----------------------------- events ---------------------------- */

/**
 * Resolve a played EventResult.
 *
 * Two call shapes (the latter from the season UI, CONTRACTS-PERSIST §5):
 *   selectEvent(state, eventId)        — direct lookup by EventResult id
 *   selectEvent(state, slotId, region) — composite: regional events are keyed
 *                                        `${slotId}-${region}`; international
 *                                        events are keyed by `slotId`.
 *
 * The composite form tries `${slotId}-${region}` first (when a region is given),
 * then a bare `slotId`. When nothing resolves, it DEFAULTS to the latest played
 * event so param-less / stale routes still render something sensible.
 *
 * @param {object} state
 * @param {string} eventIdOrSlotId
 * @param {string} [region]
 * @returns {object|null}
 */
export const selectEvent = (state, eventIdOrSlotId, region) => {
  const byId = state.events.byId;
  let raw = null;
  if (region) {
    const composite = `${eventIdOrSlotId}-${region}`;
    if (byId[composite]) raw = byId[composite];
  }
  if (!raw && byId[eventIdOrSlotId]) raw = byId[eventIdOrSlotId];
  if (!raw) {
    // Fall back to the latest played event (last in insertion order).
    const order = state.events.order;
    if (order.length > 0) raw = byId[order[order.length - 1]] || null;
  }
  return gated(state, raw);
};

/**
 * The Pacific Kickoff EventResult (or, more generally, the first 'kickoff'
 * event mirrored into the events slice), or null. Matched by formatId
 * 'kickoff'. With the full season this resolves the first regional Kickoff in
 * REGION_ORDER (kickoff-pacific) — the event the Phase-3 Bracket/Standings
 * screens browse by default.
 * @param {object} state
 * @returns {object|null}
 */
export const selectKickoff = (state) => {
  for (const id of state.events.order) {
    const ev = state.events.byId[id];
    if (ev && ev.formatId === 'kickoff') return gated(state, ev);
  }
  return null;
};

/**
 * Every played event as a picker entry `{ eventId, slotId, region, type }` in
 * calendar order (a regional slot expands to its 4 region events). Reads the
 * SeasonState (the truth) so the CURRENT slot's events appear even mid-reveal.
 * @param {object} state
 * @returns {Array<{eventId:string, slotId:string, region:string|null, type:string}>}
 */
export const selectPlayedEvents = (state) => {
  const season = selectSeason(state);
  if (!season) return [];
  return season.events.map((e) => ({
    eventId: (e.result && e.result.eventId) || e.slotId,
    slotId: e.slotId,
    region: e.region || null,
    type: e.type
  }));
};

/**
 * A sensible default event to view: the followed team's most recent event (if it
 * played in one), else the latest played event. null when nothing has played.
 * @param {object} state
 * @returns {string|null}
 */
export const selectDefaultEventId = (state) => {
  const events = selectPlayedEvents(state);
  if (!events.length) return null;
  const followed = state.ui && state.ui.followedTeamId;
  if (followed) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = state.events.byId[events[i].eventId];
      if (ev && (ev.series || []).some((s) => s.teamAId === followed || s.teamBId === followed)) {
        return events[i].eventId;
      }
    }
  }
  return events[events.length - 1].eventId;
};

/* ----------------------------- rankings -------------------------- */

const rankingsMemo = memoOne((events, teams, players, leagues, revealKey, revealMapRef) => {
  const world = { leagues: leagues || {}, teamsById: teams || {}, playersById: players || {} };
  // Spoiler-safe: gate each event's series to the revealed ones for the active
  // reveal slot (other slots count in full; no reveal = everything counts).
  const series = [];
  for (const e of events || []) {
    const all = (e.result && e.result.series) || [];
    const set = revealMapRef ? revealMapRef.get((e.result && e.result.eventId) || e.slotId) : null;
    if (set) {
      for (const s of all) if (set.has(seriesKey(s.stageId, s.matchId))) series.push(s);
    } else {
      for (const s of all) series.push(s);
    }
  }
  return { key: [events, teams, players, revealKey], value: computeRankings(world, series) };
});

/**
 * The world ranking — all 48 teams by Elo rating (seeded from roster strength,
 * updated by every revealed series). Cross-region; memoized on the season's
 * events + world + reveal cursor.
 * @param {object} state
 * @returns {Array<{teamId:string, rating:number, rank:number, region:string|null, regionRank:number, w:number, l:number}>}
 */
export const selectTeamRatings = (state) => {
  const season = selectSeason(state);
  const events = season ? season.events : null;
  return rankingsMemo(
    events,
    state.world.teams,
    state.world.players,
    state.world.leagues,
    state.reveal ? state.reveal.dayIndex : -1,
    revealMap(state)
  );
};

/** A single team's world-ranking row (rank + rating + region rank + record), or null. */
export const selectTeamRank = (state, teamId) =>
  teamId ? selectTeamRatings(state).find((r) => r.teamId === teamId) || null : null;

/**
 * A StageResult from an event by stage id.
 * @param {object} state @param {string} eventId @param {string} stageId
 * @returns {object|null}
 */
export const selectStage = (state, eventId, stageId) => {
  const ev = selectEvent(state, eventId);
  if (!ev) return null;
  return (ev.stages || []).find((s) => s.stageId === stageId) || null;
};

/* ------------------------- memo plumbing ------------------------- */

/**
 * Build a single-slot memoizer keyed on an array of cache keys (references or
 * primitives), compared element-wise by ===. Recomputes only when a key
 * changes. `compute` returns `{ key:any[], value }`.
 * @template T
 * @param {(...args:any[]) => {key:any[], value:T}} compute
 * @returns {(...args:any[]) => T}
 */
function memoOne(compute) {
  /** @type {any[]|null} */
  let lastKey = null;
  let lastValue;
  return (...args) => {
    const { key, value } = compute(...args);
    if (
      lastKey &&
      lastKey.length === key.length &&
      lastKey.every((k, i) => k === key[i])
    ) {
      return lastValue;
    }
    lastKey = key;
    lastValue = value;
    return value;
  };
}

/* --------------------------- standings --------------------------- */

/**
 * Standings rows for a stage, joined with team display info.
 * Each row: { ...standing, team } where team is the world Team (or null).
 * @param {object} state @param {string} eventId @param {string} stageId
 * @returns {Array<object>}
 */
export const selectStandings = (state, eventId, stageId) => {
  const stage = selectStage(state, eventId, stageId);
  if (!stage) return [];
  const teams = state.world.teams;
  return (stage.standings || []).map((row) => ({
    ...row,
    team: teams[row.teamId] || null
  }));
};

/* --------------------------- placements -------------------------- */

const computeAwards = memoOne((season, players, teams, leagues) => {
  if (!season) return { key: [null], value: null };
  const world = { playersById: players || {}, teamsById: teams || {}, leagues: leagues || {} };
  // Key on the season events (box scores) + the player table (award identity:
  // role/age/team). Both are replaced wholesale when a slot is played.
  return { key: [season.events, players], value: computeSeasonAwards(season, world) };
});

const computePlacements = memoOne((event) => {
  if (!event) return { key: [null], value: [] };
  const cp = awardCP(event, CP_TABLE);
  const quals =
    event.type === 'kickoff' ? kickoffQualifiers(event) : [];
  const qualBy = new Map(quals.map((q) => [q.teamId, q.seedInto]));
  const rows = (event.placements || []).map((p) => ({
    rank: p.rank,
    teamId: p.teamId,
    losses: p.losses,
    eliminatedIn: p.eliminatedIn,
    cp: cp[p.teamId] || 0,
    qual: qualBy.get(p.teamId) || null
  }));
  return { key: [event], value: rows };
});

/**
 * Final placements for an event, joined with CP (awardCP) and qualification
 * slots (kickoffQualifiers). Memoized on the EventResult reference.
 * @param {object} state @param {string} eventId
 * @returns {Array<{rank:number, teamId:string, losses:number, eliminatedIn?:string, cp:number, qual:string|null}>}
 */
export const selectPlacements = (state, eventId) =>
  computePlacements(selectEvent(state, eventId));

/* ----------------------------- series ---------------------------- */

/**
 * A SeriesRef from any stage of any event, by series id.
 * @param {object} state @param {string} seriesId
 * @returns {object|null}
 */
export const selectSeries = (state, seriesId) => {
  for (const eid of state.events.order) {
    const ev = state.events.byId[eid];
    if (!ev) continue;
    const found = (ev.series || []).find((s) => s.id === seriesId);
    if (found) return found;
  }
  return null;
};

/* ----------------------------- leaders --------------------------- */

const computeLeaders = memoOne((event, topN) => {
  if (!event) return { key: [null, topN], value: [] };
  // HLTV-style Rating 2.0 per player across the event's (revealed) series.
  const ratings = ratePlayersOverSeries(event.series || []);
  /** @type {Map<string, object>} */
  const agg = new Map();
  for (const series of event.series || []) {
    for (const map of series.maps || []) {
      const box = map.boxScore || {};
      for (const pid of Object.keys(box)) {
        const stat = box[pid];
        let a = agg.get(pid);
        if (!a) {
          a = {
            playerId: pid,
            maps: 0,
            kills: 0,
            deaths: 0,
            assists: 0,
            firstBloods: 0,
            clutches: 0,
            acsSum: 0
          };
          agg.set(pid, a);
        }
        a.maps += 1;
        a.kills += stat.kills || 0;
        a.deaths += stat.deaths || 0;
        a.assists += stat.assists || 0;
        a.firstBloods += stat.firstBloods || 0;
        a.clutches += stat.clutches || 0;
        a.acsSum += stat.acs || 0;
      }
    }
  }
  const rows = [...agg.values()].map((a) => {
    const rb = ratings.get(a.playerId);
    return {
      playerId: a.playerId,
      maps: a.maps,
      kills: a.kills,
      deaths: a.deaths,
      assists: a.assists,
      firstBloods: a.firstBloods,
      clutches: a.clutches,
      acs: a.maps > 0 ? a.acsSum / a.maps : 0,
      kd: a.deaths > 0 ? a.kills / a.deaths : a.kills,
      rating: rb ? rb.rating : 0,
      kast: rb ? rb.kast : 0,
      adr: rb ? rb.adr : 0
    };
  });
  rows.sort((x, y) => y.acs - x.acs);
  const value = Number.isFinite(topN) ? rows.slice(0, topN) : rows;
  return { key: [event, topN], value };
});

/**
 * Flattened player box-score leaders (ACS/K/D/clutch) across every series of
 * an event, sorted by ACS desc, top N. Memoized on (EventResult, topN).
 * @param {object} state @param {string} eventId @param {number} [topN]
 * @returns {Array<object>}
 */
export const selectLeaders = (state, eventId, topN = 20) =>
  computeLeaders(selectEvent(state, eventId), topN);

/* --------------------------- scouting --------------------------- */

/**
 * All scouting focuses the user has placed across the career.
 * @param {object} state
 * @returns {Array<{playerId:string, seasonIndex:number}>}
 */
export const selectScoutingFocuses = (state) =>
  (state.scouting && state.scouting.focuses) || [];

/**
 * Number of seasons this player has been scouted (each focus season counts once).
 * @param {object} state
 * @param {string} playerId
 * @returns {number}
 */
export const selectPlayerFocusCount = (state, playerId) => {
  const focuses = selectScoutingFocuses(state);
  return focuses.filter((f) => f.playerId === playerId).length;
};

/**
 * How many scouting focuses have been used in the current season.
 * @param {object} state
 * @returns {number}
 */
export const selectScoutFocusesUsedThisSeason = (state) => {
  const seasonIndex = selectSeasonIndex(state);
  const focuses = selectScoutingFocuses(state);
  return focuses.filter((f) => f.seasonIndex === seasonIndex).length;
};

/**
 * Derive which traits are visible to the manager for a specific player.
 * Uses the engine's getRevealedTraits with the career seed + accumulated focus count.
 *
 * @param {object} state
 * @param {string} playerId
 * @returns {{ known: string[], hiddenCount: number }}
 */
export const selectRevealedTraits = (state, playerId) => {
  const player = state.world && state.world.players && state.world.players[playerId];
  if (!player) return { known: [], hiddenCount: 0 };
  const careerSeed = (state.career && state.career.seed != null) ? state.career.seed : 2026;
  const focusSeasons = selectPlayerFocusCount(state, playerId);
  return getRevealedTraits(player, focusSeasons, careerSeed);
};

/**
 * All players sorted by overall desc, each annotated with their revealed-trait view.
 * Used by the Scouting screen to list prospects across the whole world.
 * @param {object} state
 * @returns {Array<{player:object, known:string[], hiddenCount:number, focusSeasons:number}>}
 */
export const selectScoutingProspects = (state) => {
  const players = Object.values((state.world && state.world.players) || {});
  const careerSeed = (state.career && state.career.seed != null) ? state.career.seed : 2026;
  const focuses = selectScoutingFocuses(state);
  return players.map((player) => {
    const focusSeasons = focuses.filter((f) => f.playerId === player.id).length;
    const { known, hiddenCount } = getRevealedTraits(player, focusSeasons, careerSeed);
    return { player, known, hiddenCount, focusSeasons };
  }).sort((a, b) => meanOverall(b.player) - meanOverall(a.player));
};

/* ----------------------- Tier-2 (Challengers) -------------------- */

/**
 * Static per-team lookup built once from the Tier-2 seed data (immutable).
 * Maps teamId -> { id, name, tag, region } for all 48 T2 clubs.
 * @type {Record<string, {id:string, name:string, tag:string, region:string}>}
 */
const T2_TEAM_META = (() => {
  const out = {};
  for (const region of TIER2_REGION_ORDER) {
    for (const meta of TIER2_TEAMS_BY_REGION[region] || []) {
      out[meta.id] = { ...meta, region };
    }
  }
  return Object.freeze(out);
})();

/**
 * Static region -> [teamId] list (stable order = seed data order).
 * @type {Record<string, string[]>}
 */
const T2_REGION_TEAM_IDS = (() => {
  const out = {};
  for (const region of TIER2_REGION_ORDER) {
    out[region] = Object.freeze((TIER2_TEAMS_BY_REGION[region] || []).map((m) => m.id));
  }
  return Object.freeze(out);
})();

/**
 * Tier-2 (Challengers) CP standings by region, derived from the season's T2
 * ledger. Each region lists all 12 clubs ranked by cumulative CP (ties broken
 * by teamId). Enriched with team name + tag from the static seed data.
 *
 * Returns `{ hasData: false, byRegion: {} }` before the first T2 slot plays
 * (empty ledger); from the first regional slot onward `hasData` is true and
 * every region has 12 ranked rows (including teams with CP 0).
 *
 * @param {object} state
 * @returns {{
 *   hasData: boolean,
 *   byRegion: Record<string, Array<{
 *     rank: number,
 *     teamId: string,
 *     teamName: string,
 *     teamTag: string,
 *     cp: number
 *   }>>
 * }}
 */
export const selectT2Standings = (state) => {
  const season = selectSeason(state);
  if (!season || !season.tier2 || !season.tier2.ledger) {
    return { hasData: false, byRegion: {} };
  }
  const totals = season.tier2.ledger.totals || {};
  const hasData = Object.keys(totals).length > 0;

  /** @type {Record<string, Array<object>>} */
  const byRegion = {};
  for (const region of TIER2_REGION_ORDER) {
    const teamIds = T2_REGION_TEAM_IDS[region] || [];
    const rows = teamIds.map((teamId) => {
      const meta = T2_TEAM_META[teamId] || { id: teamId, name: teamId, tag: '???', region };
      return {
        teamId,
        teamName: meta.name,
        teamTag: meta.tag,
        cp: totals[teamId] || 0
      };
    });
    rows.sort((a, b) => (b.cp - a.cp) || (a.teamId < b.teamId ? -1 : 1));
    rows.forEach((row, i) => { row.rank = i + 1; });
    byRegion[region] = rows;
  }

  return { hasData, byRegion };
};
