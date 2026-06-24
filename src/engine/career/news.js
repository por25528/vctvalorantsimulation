/**
 * engine/career/news.js — deterministic news-item generators (CONTRACTS-POLISH §0/P7b).
 *
 * PURE: each generator turns a slice of game state (played events, an off-season
 * report, a season's awards) into a list of NewsItem objects. No rng, no Date, no
 * DOM; same inputs → identical items. The inbox slice stamps each item with a
 * monotonic id + unread flag on append, so the generators stay free of any mutable
 * sequence (and thus deterministic and unit-testable in isolation).
 *
 * A NewsItem is a plain, JSON-safe object:
 *   { kind, seasonIndex, slotId, headline, teamId|null, playerId|null, tone }
 *   kind  : 'champion' | 'result' | 'award' | 'transfer' | 'retirement' | 'newgen' | 'injury'
 *   tone  : 'headline' | 'good' | 'bad' | 'neutral'  (good/bad are followed-team flavored)
 *
 * `world` is the engine World { teamsById, playersById }; names resolve against it.
 * Constants from BALANCE.CAREER.NEWS.
 *
 * @typedef {Object} NewsItem
 * @property {string} kind
 * @property {number} seasonIndex
 * @property {string|null} slotId
 * @property {string} headline
 * @property {string|null} teamId
 * @property {string|null} playerId
 * @property {string} tone
 */

import { BALANCE } from '../../config/balance.js';

const N = BALANCE.CAREER.NEWS;

/** Display labels for calendar slot ids (UI sugar; news text). */
const SLOT_LABELS = {
  kickoff: 'Kickoff', m0: 'Masters One', stage1: 'Stage 1', m1: 'Masters Two',
  stage2: 'Stage 2', m2: 'Masters Three', stage3: 'Stage 3', champions: 'Champions'
};
const REGION_LABELS = { pacific: 'Pacific', americas: 'Americas', emea: 'EMEA', china: 'China' };

/** Safe finite integer. */
function num(v, d) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/** Team display name (falls back to the id). */
function teamName(world, id) {
  const t = world && world.teamsById && world.teamsById[id];
  return (t && t.name) || id || 'A team';
}

/** Player display handle (falls back to the id). */
function playerName(world, id) {
  const p = world && world.playersById && world.playersById[id];
  return (p ? p.handle || p.name : id) || id;
}

/** Player age, or null if absent. */
function playerAge(world, id) {
  const p = world && world.playersById && world.playersById[id];
  return p && typeof p.age === 'number' ? p.age : null;
}

/** English ordinal for small ranks. */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** A human label for an event entry, e.g. "Kickoff Pacific" / "Masters One". */
function eventLabel(entry) {
  const slot = SLOT_LABELS[entry.slotId] || entry.slotId;
  return entry.region ? `${slot} ${REGION_LABELS[entry.region] || entry.region}` : slot;
}

/** Build a NewsItem (no id — the inbox slice stamps it). */
function item(kind, seasonIndex, slotId, headline, extra = {}) {
  return {
    kind,
    seasonIndex,
    slotId: slotId || null,
    headline,
    teamId: extra.teamId || null,
    playerId: extra.playerId || null,
    tone: extra.tone || 'neutral'
  };
}

/**
 * News from one or more freshly-played events (one regional slot = 4 entries).
 * Emits a winner headline per event (the Champions winner is a "world champions"
 * headline), plus a followed-team result line when they competed and didn't win.
 *
 * @param {Array<object>} entries  SeasonEventEntry[] just played
 * @param {object} world
 * @param {{ seasonIndex?:number, followedTeamId?:string }} [opts]
 * @returns {NewsItem[]}
 */
export function eventNews(entries, world, opts = {}) {
  const seasonIndex = num(opts.seasonIndex, 0);
  const followedTeamId = opts.followedTeamId || null;
  /** @type {NewsItem[]} */
  const items = [];

  for (const entry of entries || []) {
    const result = entry && entry.result;
    if (!result || !Array.isArray(result.placements)) continue;
    const label = eventLabel(entry);
    const winner = result.placements.find((p) => p.rank === 1);

    if (winner) {
      if (entry.type === 'champions') {
        items.push(item('champion', seasonIndex, entry.slotId,
          `${teamName(world, winner.teamId)} are crowned VCT World Champions!`,
          { teamId: winner.teamId, tone: 'headline' }));
      } else {
        const intl = entry.scope === 'international';
        items.push(item('result', seasonIndex, entry.slotId,
          `${teamName(world, winner.teamId)} win ${label}`,
          { teamId: winner.teamId, tone: intl ? 'headline' : 'neutral' }));
      }
    }

    if (followedTeamId) {
      const me = result.placements.find((p) => p.teamId === followedTeamId);
      if (me && me.rank !== 1) {
        items.push(item('result', seasonIndex, entry.slotId,
          `${teamName(world, followedTeamId)} finish ${ordinal(me.rank)} at ${label}`,
          { teamId: followedTeamId, tone: me.rank <= 3 ? 'good' : 'bad' }));
      }
    }
  }
  return items;
}

/**
 * News from a completed season's awards: MVP, Finals MVP, Rookie of the Year.
 *
 * @param {object} awards  SeasonAwards
 * @param {object} world
 * @param {{ seasonIndex?:number, followedTeamId?:string }} [opts]
 * @returns {NewsItem[]}
 */
export function awardNews(awards, world, opts = {}) {
  if (!awards) return [];
  const seasonIndex = num(opts.seasonIndex, 0);
  const followedTeamId = opts.followedTeamId || null;
  /** @type {NewsItem[]} */
  const items = [];

  const award = (w, title) => {
    if (!w) return;
    const tone = followedTeamId && w.teamId === followedTeamId ? 'good' : 'headline';
    items.push(item('award', seasonIndex, null,
      `${title}: ${playerName(world, w.playerId)} (${teamName(world, w.teamId)})`,
      { playerId: w.playerId, teamId: w.teamId, tone }));
  };

  award(awards.mvp, 'Season MVP');
  award(awards.finalsMvp, 'Finals MVP');
  award(awards.rookieOfYear, 'Rookie of the Year');
  return items;
}

/**
 * News from an off-season report: headline retirements, signings and newgens
 * (bounded by BALANCE.CAREER.NEWS so a churny window stays readable).
 *
 * @param {object} report  OffseasonReport
 * @param {object} world   the POST-off-season world (holds retirees + newgens)
 * @param {{ seasonIndex?:number, followedTeamId?:string }} [opts]
 * @returns {NewsItem[]}
 */
export function offseasonNews(report, world, opts = {}) {
  if (!report) return [];
  const seasonIndex = num(opts.seasonIndex, 0);
  const followedTeamId = opts.followedTeamId || null;
  /** @type {NewsItem[]} */
  const items = [];

  // Retirements (oldest/most-notable first as the report ordered them).
  for (const id of (report.retired || []).slice(0, N.OFFSEASON_RETIREMENTS)) {
    const age = playerAge(world, id);
    items.push(item('retirement', seasonIndex, null,
      `${playerName(world, id)} retires${age != null ? ` at ${age}` : ''}`,
      { playerId: id, tone: 'neutral' }));
  }

  // Headline signings (highest salary first), followed-team flavored.
  const signings = (report.transfers || [])
    .filter((m) => m.toTeamId)
    .sort((a, b) => (b.salary || 0) - (a.salary || 0))
    .slice(0, N.OFFSEASON_SIGNINGS);
  for (const m of signings) {
    const tone = followedTeamId && m.toTeamId === followedTeamId ? 'good' : 'neutral';
    items.push(item('transfer', seasonIndex, null,
      `${playerName(world, m.playerId)} signs for ${teamName(world, m.toTeamId)} ($${Math.round((m.salary || 0) / 1000)}k)`,
      { playerId: m.playerId, teamId: m.toTeamId, tone }));
  }

  // Top newgen arrivals (highest potential first).
  const newgens = (report.newgens || [])
    .map((id) => world.playersById && world.playersById[id])
    .filter(Boolean)
    .sort((a, b) => (b.potential || 0) - (a.potential || 0))
    .slice(0, N.OFFSEASON_NEWGENS);
  for (const p of newgens) {
    items.push(item('newgen', seasonIndex, null,
      `Wonderkid ${p.handle} (${p.role}, ${p.age}) enters the scene — potential ${p.potential}`,
      { playerId: p.id, tone: 'neutral' }));
  }

  return items;
}

/**
 * News from players who picked up a NEW injury this slot. Callers pass only the
 * injuries they want surfaced (e.g. the followed team's), so the feed stays
 * relevant — every other team's knocks are silent (but still felt in play).
 *
 * @param {Array<{playerId:string, injury:{weeks:number,type:string}}>} injured
 * @param {object} world
 * @param {{ seasonIndex?:number, slotId?:string, followedTeamId?:string }} [opts]
 * @returns {NewsItem[]}
 */
export function injuryNews(injured, world, opts = {}) {
  const seasonIndex = num(opts.seasonIndex, 0);
  const followedTeamId = opts.followedTeamId || null;
  /** @type {NewsItem[]} */
  const items = [];
  for (const rec of injured || []) {
    if (!rec || !rec.injury) continue;
    const p = world.playersById && world.playersById[rec.playerId];
    const teamId = (p && p.contract && p.contract.teamId) || null;
    const weeks = rec.injury.weeks;
    const tone = followedTeamId && teamId === followedTeamId ? 'bad' : 'neutral';
    items.push(item('injury', seasonIndex, opts.slotId || null,
      `${playerName(world, rec.playerId)} picks up a ${rec.injury.type} — out ~${weeks} event${weeks > 1 ? 's' : ''}`,
      { playerId: rec.playerId, teamId, tone }));
  }
  return items;
}
