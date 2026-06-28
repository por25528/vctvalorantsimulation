/**
 * ui/homeDashboard.js — pure presentation-model derivations for the "God View"
 * home (the WorldHub screen). DOM-free and deterministic: turns the live world /
 * season / inbox state into the flat, render-ready view models the dashboard
 * panels consume. No `document`/`window`, no engine mutation, no randomness.
 *
 * Everything here reads game truth ONLY through the state selectors, so the
 * dashboard never reaches into the raw state shape. Every derivation is guarded
 * for empty / early-career worlds (no NaN, sensible empty arrays) so the hub
 * renders cleanly from the very first frame of a fresh career.
 */

import {
  selectSeason,
  selectCalendar,
  selectSlotsPlayed,
  selectSeasonIndex,
  selectCareerPhase,
  selectChampion,
  selectTeam,
  selectTeamRatings,
  selectPlayedEvents,
  selectPlacements,
  selectSeasonAwards,
  selectReveal,
  selectCurrentMatchDay,
  selectMatchDaySeries,
  selectTransferWindow
} from '../state/selectors.js';
import { overall } from '../engine/career/playerStats.js';
import { happeningsFeed } from './worldFeed.js';
import { SLOT_LABELS, REGION_LABELS, REGION_ORDER } from './eventFormats.js';

/** Human label for a calendar slot id (falls back to the id). */
function slotLabel(id) {
  return SLOT_LABELS[id] || id || 'Event';
}

/** Human label for a region code (falls back to the code). */
function regionLabel(region) {
  return region ? REGION_LABELS[region] || region : null;
}

/** Display name for a team id, via the world. */
function teamName(state, teamId) {
  const t = teamId ? selectTeam(state, teamId) : null;
  return (t && t.name) || teamId || '—';
}

/** Display tag for a team id (derived from the name when absent). */
function teamTag(state, teamId) {
  const t = teamId ? selectTeam(state, teamId) : null;
  if (t && t.tag) return t.tag;
  const name = (t && t.name) || teamId || '';
  return name ? String(name).slice(0, 3).toUpperCase() : '';
}

/* ------------------------------------------------------------------ */
/* season pulse — the at-a-glance "where are we" header model          */
/* ------------------------------------------------------------------ */

/**
 * The world's clock: which season + calendar slot we're on, how far through the
 * season we are, the active off-season/champion state, and the live reveal
 * cursor (so the hero can show "Stage 1 · Day 3 / 9" while a slot is watched).
 *
 * @param {object} state
 * @returns {{
 *   seasonIndex:number, seasonNumber:number, phase:string, offseason:boolean,
 *   played:number, total:number, pct:number, complete:boolean,
 *   currentLabel:string, currentType:string|null, currentScope:string|null,
 *   nextLabel:string|null, nextScope:string|null,
 *   midReveal:boolean, revealLabel:string|null, revealDay:number, revealTotal:number,
 *   championId:string|null, championName:string|null
 * }}
 */
export function seasonPulse(state) {
  const season = selectSeason(state);
  const calendar = selectCalendar(state);
  const total = calendar.length || 0;
  const played = selectSlotsPlayed(state);
  const seasonIndex = selectSeasonIndex(state);
  const offseason = selectCareerPhase(state) === 'offseason';
  const complete = !!(season && season.complete);
  const pct = total > 0 ? Math.round((Math.min(played, total) / total) * 100) : 0;

  const reveal = selectReveal(state);
  const midReveal = !!(reveal && reveal.slotId && reveal.dayIndex < reveal.totalDays - 1);
  const revealSlot = reveal && reveal.slotId ? calendar.find((s) => s.id === reveal.slotId) || null : null;

  // The slot "in focus": the one being watched (reveal), else the next to play.
  const focusSlot = revealSlot || (offseason ? null : calendar[played] || null);
  const nextSlot = offseason ? null : calendar[played] || null;

  const championId = offseason || complete ? selectChampion(state) : null;

  return {
    seasonIndex,
    seasonNumber: seasonIndex + 1,
    phase: offseason ? 'offseason' : 'inSeason',
    offseason,
    played,
    total,
    pct,
    complete,
    currentLabel: offseason ? 'Off-season' : focusSlot ? slotLabel(focusSlot.id) : 'Pre-season',
    currentType: focusSlot ? focusSlot.type || null : null,
    currentScope: focusSlot ? focusSlot.scope || null : null,
    nextLabel: nextSlot ? slotLabel(nextSlot.id) : null,
    nextScope: nextSlot ? nextSlot.scope || null : null,
    midReveal,
    revealLabel: midReveal && revealSlot ? slotLabel(revealSlot.id) : null,
    revealDay: reveal ? (reveal.dayIndex || 0) + 1 : 0,
    revealTotal: reveal ? reveal.totalDays || 0 : 0,
    championId: championId || null,
    championName: championId ? teamName(state, championId) : null
  };
}

/**
 * The team the spectator is currently following (their "lens" into the world),
 * or null when spectating with no team followed. Joined to its world-ranking row
 * so the hero can show where the followed side sits.
 *
 * @param {object} state
 * @returns {{ id:string, name:string, tag:string, region:string|null,
 *   regionLabel:string|null, rank:number|null, rating:number|null }|null}
 */
export function followedLens(state) {
  const id = (state.ui && state.ui.followedTeamId) || null;
  if (!id) return null;
  const team = selectTeam(state, id);
  if (!team) return null;
  const row = (selectTeamRatings(state) || []).find((r) => r.teamId === id) || null;
  return {
    id,
    name: team.name || id,
    tag: teamTag(state, id),
    region: team.region || null,
    regionLabel: regionLabel(team.region),
    rank: row ? row.rank : null,
    rating: row ? Math.round(row.rating) || 0 : null
  };
}

/* ------------------------------------------------------------------ */
/* power ranking + region leaders                                      */
/* ------------------------------------------------------------------ */

/**
 * The global team power ranking (Elo) — the strongest teams in the world, in
 * order. Joined to display info, capped at `limit`. Empty before any world loads.
 *
 * @param {object} state
 * @param {number} [limit=8]
 * @returns {Array<{teamId:string, name:string, tag:string, region:string|null,
 *   regionLabel:string|null, rating:number, rank:number, w:number, l:number, followed:boolean}>}
 */
export function powerRanking(state, limit = 8) {
  const ratings = selectTeamRatings(state) || [];
  const followedId = (state.ui && state.ui.followedTeamId) || null;
  return ratings.slice(0, Math.max(0, limit)).map((r) => ({
    teamId: r.teamId,
    name: teamName(state, r.teamId),
    tag: teamTag(state, r.teamId),
    region: r.region || null,
    regionLabel: regionLabel(r.region),
    rating: Math.round(r.rating) || 0,
    rank: r.rank,
    w: r.w || 0,
    l: r.l || 0,
    followed: r.teamId === followedId
  }));
}

/**
 * The top-ranked team in each region (the four regional kingpins). Reads the
 * world ranking and picks each region's `regionRank === 1`. Regions with no
 * ranked team are omitted. Stable region order.
 *
 * @param {object} state
 * @returns {Array<{region:string, regionLabel:string, teamId:string, name:string,
 *   tag:string, rating:number, rank:number, w:number, l:number}>}
 */
export function regionLeaders(state) {
  const ratings = selectTeamRatings(state) || [];
  const byRegion = new Map();
  for (const r of ratings) {
    if (!r.region) continue;
    const cur = byRegion.get(r.region);
    if (!cur || r.regionRank < cur.regionRank) byRegion.set(r.region, r);
  }
  const order = REGION_ORDER.filter((reg) => byRegion.has(reg)).concat(
    [...byRegion.keys()].filter((reg) => !REGION_ORDER.includes(reg))
  );
  return order.map((reg) => {
    const r = byRegion.get(reg);
    return {
      region: reg,
      regionLabel: regionLabel(reg) || reg,
      teamId: r.teamId,
      name: teamName(state, r.teamId),
      tag: teamTag(state, r.teamId),
      rating: Math.round(r.rating) || 0,
      rank: r.rank,
      w: r.w || 0,
      l: r.l || 0
    };
  });
}

/* ------------------------------------------------------------------ */
/* people to watch                                                     */
/* ------------------------------------------------------------------ */

/** Pack an AwardWinner into a watch-list entry (hot in-season form). */
function watchFromAward(state, w, kind) {
  const tid = w.teamId || null;
  return {
    playerId: w.playerId,
    handle: w.handle || w.playerId,
    role: w.role || null,
    age: w.age != null ? w.age : null,
    teamId: tid,
    teamName: tid ? teamName(state, tid) : null,
    teamTag: tid ? teamTag(state, tid) : null,
    overall: null,
    kind,
    note:
      kind === 'mvp'
        ? `MVP · ${Math.round(w.acs || 0)} ACS`
        : kind === 'rookie'
          ? `Rookie · ${Math.round(w.acs || 0)} ACS`
          : `${Math.round(w.acs || 0)} ACS`
  };
}

/** Pack a world Player into a watch-list entry (rising prospect, no match data yet). */
function watchFromProspect(state, p) {
  const tid = (p.contract && p.contract.teamId) || null;
  const ovr = Math.round(overall(p));
  const pot = Math.round(p.potential || 0);
  const rising = pot > ovr;
  return {
    playerId: p.id,
    handle: p.handle || p.name || p.id,
    role: p.role || null,
    age: p.age != null ? p.age : null,
    teamId: tid,
    teamName: tid ? teamName(state, tid) : null,
    teamTag: tid ? teamTag(state, tid) : null,
    overall: ovr,
    kind: 'prospect',
    note: rising ? `OVR ${ovr} · ceiling ${pot}` : `OVR ${ovr}`
  };
}

/**
 * "People to watch" — a blend of this season's hot performers (MVP, Rookie, the
 * All-Pro first team, derived from real box scores) topped up with the brightest
 * young prospects in the world (highest ceiling, age ≤ 23) when there isn't yet
 * enough match data. Each entry is clickable into the player view.
 *
 * Robust to an empty season: with no maps played it returns pure prospects; with
 * no players at all it returns [].
 *
 * @param {object} state
 * @param {number} [limit=6]
 * @returns {Array<{playerId:string, handle:string, role:string|null, age:number|null,
 *   teamId:string|null, teamName:string|null, teamTag:string|null, overall:number|null,
 *   kind:string, note:string}>}
 */
export function peopleToWatch(state, limit = 6) {
  const out = [];
  const seen = new Set();
  const push = (entry) => {
    if (!entry || !entry.playerId || seen.has(entry.playerId)) return;
    seen.add(entry.playerId);
    out.push(entry);
  };

  const awards = selectSeasonAwards(state);
  if (awards) {
    if (awards.mvp) push(watchFromAward(state, awards.mvp, 'mvp'));
    if (awards.rookieOfYear) push(watchFromAward(state, awards.rookieOfYear, 'rookie'));
    for (const w of awards.allProFirst || []) {
      if (out.length >= limit) break;
      if (w) push(watchFromAward(state, w, 'allpro'));
    }
  }

  // Top up with rising prospects (high ceiling, young), strongest first.
  if (out.length < limit) {
    const players = Object.values((state.world && state.world.players) || {});
    const prospects = players
      .filter((p) => p && p.contract && p.contract.status === 'active' && (p.age == null || p.age <= 23))
      .map((p) => ({ p, pot: Math.round(p.potential || 0), ovr: Math.round(overall(p)) }))
      .sort((a, b) => b.pot - a.pot || b.ovr - a.ovr || (a.p.id < b.p.id ? -1 : 1));
    for (const { p } of prospects) {
      if (out.length >= limit) break;
      push(watchFromProspect(state, p));
    }
  }

  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* latest happenings                                                   */
/* ------------------------------------------------------------------ */

/**
 * The latest-happenings feed for the God-View hub: the freshest, most dramatic
 * items from the World Feed — the cross-season storylines (dynasties, rivalries,
 * breakouts, upsets) blended with the live inbox news, newest-first. Each item
 * carries an icon, a context blurb and an era tag, and the ids to click through.
 * Falls back to the most recent window's marquee signing so the panel still tells
 * a story when the world is otherwise quiet.
 *
 * @param {object} state
 * @param {number} [limit=7]
 * @returns {Array<{id:string, icon:string, headline:string, blurb:string,
 *   era:string, tone:string, category:string, teamId:string|null, playerId:string|null}>}
 */
export function latestHappenings(state, limit = 7) {
  const out = happeningsFeed(state, limit);

  // If the feed is light (e.g. a fresh world with no history yet), fold in the
  // most recent window's marquee signing so the panel still tells a story.
  if (out.length < limit) {
    const window = selectTransferWindow(state);
    if (window && window.biggest) {
      const d = window.biggest;
      out.push({
        id: `transfer-${window.season}-${d.player}`,
        icon: 'swap',
        headline: `${d.player} joins ${d.to} for $${Math.round((d.fee || 0) / 1000)}k`,
        blurb: '',
        era: `S${(window.season || 0) + 1} · Off-season`,
        tone: 'headline',
        category: 'transfer',
        teamId: d.toId || null,
        playerId: null
      });
    }
  }

  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* recent results + now/next                                           */
/* ------------------------------------------------------------------ */

/**
 * Recently-decided events (newest first): each event's champion + runner-up.
 * Spoiler-safe by construction — it reads placements through `selectPlacements`,
 * which returns [] for any event still being watched day-by-day, so an
 * in-progress slot never leaks its winner here.
 *
 * @param {object} state
 * @param {number} [limit=5]
 * @returns {Array<{eventId:string, slotId:string, region:string|null, label:string,
 *   type:string, winnerId:string, winnerName:string, winnerTag:string,
 *   runnerUpId:string|null, runnerUpName:string|null}>}
 */
export function recentResults(state, limit = 5) {
  const events = selectPlayedEvents(state) || [];
  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const ev = events[i];
    const placements = selectPlacements(state, ev.eventId) || [];
    if (!placements.length) continue; // not yet fully revealed → skip (no spoiler)
    const winner = placements.find((p) => p.rank === 1);
    if (!winner) continue;
    const runnerUp = placements.find((p) => p.rank === 2) || null;
    const rl = regionLabel(ev.region);
    out.push({
      eventId: ev.eventId,
      slotId: ev.slotId,
      region: ev.region || null,
      label: rl ? `${slotLabel(ev.slotId)} · ${rl}` : slotLabel(ev.slotId),
      type: ev.type,
      winnerId: winner.teamId,
      winnerName: teamName(state, winner.teamId),
      winnerTag: teamTag(state, winner.teamId),
      runnerUpId: runnerUp ? runnerUp.teamId : null,
      runnerUpName: runnerUp ? teamName(state, runnerUp.teamId) : null
    });
  }
  return out;
}

/**
 * What's live right now: the match-day currently being watched (its fixtures with
 * scores), plus what's queued next. When nothing is mid-reveal, `fixtures` is []
 * and `nextLabel` names the next event to play.
 *
 * @param {object} state
 * @returns {{ dayLabel:string|null, fixtures:Array<{seriesId:string|null,
 *   aId:string|null, aTag:string, aScore:number|null, bId:string|null, bTag:string,
 *   bScore:number|null, winnerId:string|null, done:boolean}>, nextLabel:string|null }}
 */
export function nowAndNext(state) {
  const day = selectCurrentMatchDay(state);
  const pulse = seasonPulse(state);
  const fixtures = [];
  if (day) {
    const series = selectMatchDaySeries(state) || [];
    for (const g of series) {
      const s = g.series;
      const score = (s && s.score) || { A: null, B: null };
      fixtures.push({
        seriesId: s ? s.id : null,
        aId: g.teamA ? g.teamA.id : (s ? s.teamAId : null),
        aTag: g.teamA ? g.teamA.tag || teamTag(state, g.teamA.id) : teamTag(state, s && s.teamAId),
        aScore: typeof score.A === 'number' ? score.A : null,
        bId: g.teamB ? g.teamB.id : (s ? s.teamBId : null),
        bTag: g.teamB ? g.teamB.tag || teamTag(state, g.teamB.id) : teamTag(state, s && s.teamBId),
        bScore: typeof score.B === 'number' ? score.B : null,
        winnerId: s ? s.winnerId || null : null,
        done: !!(s && s.winnerId)
      });
    }
  }
  return {
    dayLabel: day ? day.label || null : null,
    fixtures,
    nextLabel: pulse.nextLabel
  };
}
