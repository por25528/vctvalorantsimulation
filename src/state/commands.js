/**
 * state/commands.js — orchestration that touches the engine + persistence
 * (CONTRACTS-UI §2, CONTRACTS-PERSIST §5).
 *
 * Commands are imperative helpers that read the store, call the (pure) engine /
 * the (async) save manager, and dispatch plain actions. A command is just a
 * function `(store, ...args) => void | Promise<...>`. This is the ONLY
 * state-layer module that imports the engine, the seed data, and persistence.
 *
 * The SEASON is the source of truth. `bootstrap` builds the 48-team world and
 * inits a fresh SeasonState; `continueSeason` advances it one calendar slot at a
 * time (a regional slot plays 4 region events, an international slot plays 1).
 * Every played event is also MIRRORED into the Phase-3 `events` slice (keyed by
 * its EventResult id) so the existing event-scoped selectors/screens keep
 * working unchanged.
 *
 *   bootstrap(store)                build world + init season; try the autosave
 *                                   slot first and hydrate if present; follow a
 *                                   default team; route home.
 *   continueSeason(store)           advance the season one slot; autosave; toast
 *                                   the slot just played; navigate calendar/event
 *                                   (champion toast + champions screen on finish).
 *   openEvent(store, slotId, region)navigate the event's Tournament view.
 *   openSeries(store, seriesId)     hydrate the series, point the ticker, go match.
 *   signPlayer/releasePlayer/offerContract/moveRosterPlayer
 *                                   — the user's transfer-market + lineup moves;
 *                                   mutate the world slice directly (roster-valid),
 *                                   log into the transfers slice, autosave.
 *   saveCurrent/loadSlot/deleteSlot/duplicateSlot/exportCurrent/importSave
 *                                   — async persistence via a module-level
 *                                   saveManager = createSaveManager(getDefaultAdapter()).
 *
 * Determinism: all per-event seeds derive from the season seed via the engine's
 * hashSeed, so a stepped season is byte-identical to a straight-through one.
 *
 * @typedef {import('../engine/career/season.js').SeasonState} SeasonState
 */

import { buildWorld } from '../data/seed/index.js';
import { createPlayer } from '../domain/player.js';
import { createTeam } from '../domain/team.js';
import { hydrateSeries } from '../engine/career/season.js';
import {
  initCareer,
  advanceCareerSlot,
  runCareerOffseason
} from '../engine/career/career.js';
import { buildSlotSchedule } from '../engine/career/matchdays.js';
import { salaryFor } from '../engine/career/offseason/contracts.js';
import { transferFee, playerValue } from '../engine/career/offseason/transfers.js';
import { generateCoach } from '../engine/career/staff.js';
import { createRng } from '../core/rng.js';
import { hashSeed } from '../core/hash.js';
import { computeSeasonAwards } from '../engine/career/awards.js';
import { eventNews, awardNews, offseasonNews, injuryNews } from '../engine/career/news.js';
import { isFreshInjury } from '../engine/career/injuries.js';
import { BALANCE } from '../config/balance.js';
import { createSaveManager, AUTOSAVE_ID } from '../persistence/saveManager.js';
import { getDefaultAdapter } from '../persistence/db.js';
import { newSaveMeta } from '../persistence/migrations.js';
import { exportSave, importSave as deserializeSave } from '../persistence/serializer.js';

import { replaceWorld, setTeam, setPlayer } from './slices/world.js';
import {
  navigate,
  follow,
  addEvent,
  setStatus,
  resetEvents,
  setCareer,
  recordTransfer,
  resetTransfers,
  appendNews,
  loadInbox,
  tickerSet,
  setSpoilerFree,
  setAutoplaySpeed,
  pushToast,
  setSaveSlots,
  initSeason as initSeasonAction,
  advanceSeason as advanceSeasonAction,
  loadSeason as loadSeasonAction,
  setReveal,
  advanceReveal,
  revealToEnd,
  resetReveal,
  addScoutFocus,
  resetScouting
} from './actions.js';
import { selectSeason, selectScoutFocusesUsedThisSeason, selectPlayerFocusCount, selectSeasonIndex } from './selectors.js';
import { MAX_SCOUT_FOCUSES } from '../engine/career/scouting.js';

/** Transfer-market tuning (roster bounds + user contract length). */
const MARKET = BALANCE.CAREER.MARKET;

/** The default master season seed (deterministic 2026 cycle). */
export const DEFAULT_SEED = 2026;

/** The reserved autosave slot id (re-exported from the persistence layer). */
export { AUTOSAVE_ID };

/**
 * Clear the rolling autosave slot. Used by `bootstrap(store, { fresh:true })`
 * and by headless tests that must guarantee a fresh start (the module-level
 * save manager is a process singleton, so a prior suite's autosave can leak).
 * @returns {Promise<void>}
 */
export async function clearAutosave() {
  await saveManager.deleteSlot(AUTOSAVE_ID);
}

/**
 * Legacy Phase-3 event id. The full season's Pacific Kickoff event is keyed
 * `kickoff-pacific`; we ALSO mirror it under this id (and flip its status) so
 * the Phase-3 screens that read `state.events.status['pacific-kickoff']`
 * (HomeInbox / Calendar / app) keep working against the season model.
 */
export const KICKOFF_EVENT_ID = 'pacific-kickoff';

/** The Kickoff's deciding stage id (the triple-elim playoff). */
export const KICKOFF_PLAYOFF_STAGE = 'playoff';

/** The first regional Kickoff event id in REGION_ORDER (pacific). */
const PACIFIC_KICKOFF_EVENT_ID = 'kickoff-pacific';

/** Module-level save manager (adapter chosen per environment). */
const saveManager = createSaveManager(getDefaultAdapter());

/* ------------------------------------------------------------------ */
/* internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Mirror every event entry of a SeasonState into the `events` slice (keyed by
 * its EventResult id, status 'complete'). Idempotent: re-adding an id replaces
 * its result without duplicating order. Also mirrors the Pacific Kickoff under
 * the legacy KICKOFF_EVENT_ID so Phase-3 screens stay green.
 *
 * @param {import('../core/store.js').Store} store
 * @param {SeasonState} season
 */
function mirrorEvents(store, season) {
  for (const entry of season.events) {
    const result = entry.result;
    const eventId = (result && result.eventId) || entry.slotId;
    store.dispatch(addEvent(eventId, result));
    store.dispatch(setStatus(eventId, 'complete'));
    // Legacy mirror: the Pacific Kickoff also lives under 'pacific-kickoff'.
    if (eventId === PACIFIC_KICKOFF_EVENT_ID) {
      store.dispatch(addEvent(KICKOFF_EVENT_ID, result));
      store.dispatch(setStatus(KICKOFF_EVENT_ID, 'complete'));
    }
  }
}

/**
 * Build a SaveGame POJO from the current store state.
 *
 * @param {import('../core/store.js').Store} store
 * @param {{ id?:string, name?:string }} [opts]  reuse an existing slot id/name
 * @returns {object} SaveGame { meta, world, season, settings }
 */
function buildSaveGame(store, opts = {}) {
  const state = store.getState();
  const season = selectSeason(state);
  const c = state.career || {};
  const seed = c.seed != null ? c.seed : (season ? season.seed : DEFAULT_SEED);
  const meta = newSaveMeta(opts.name || 'Save', seed, 0);
  if (opts.id) meta.id = opts.id;
  return {
    meta,
    world: state.world,
    season,
    career: {
      seed: c.seed != null ? c.seed : seed,
      seasonIndex: c.seasonIndex || 0,
      history: c.history || [],
      offseason: c.offseason || null,
      phase: c.phase || 'inSeason'
    },
    inbox: (state.inbox && state.inbox.items) || [],
    // The match-day reveal cursor (the schedule is rebuilt from the season on load).
    reveal: state.reveal && state.reveal.slotId
      ? { slotId: state.reveal.slotId, dayIndex: state.reveal.dayIndex }
      : null,
    // Scouting focuses persist across saves so the manager's scouting history
    // survives reloads.
    scouting: {
      focuses: (state.scouting && state.scouting.focuses) || []
    },
    settings: {
      followedTeamId: state.ui.followedTeamId || null,
      spoilerFree: state.ui.spoilerFree !== false,
      autoplaySpeed: state.ui.autoplaySpeed || 'normal'
    }
  };
}

/**
 * Hydrate a loaded SaveGame into the store: install world (rebuilt from
 * buildWorld so frozen domain objects + leagues are canonical), season, the
 * mirrored events, and the followed team. Routes home.
 *
 * The persisted `season` is the source of truth; `world` from the save is used
 * for team/player display, but we rebuild the canonical World from buildWorld so
 * leagues and frozen domain shapes are exactly as bootstrap produced them
 * (the seed is deterministic, so the rosters match).
 *
 * @param {import('../core/store.js').Store} store
 * @param {object} saveGame
 */
function hydrateSaveGame(store, saveGame) {
  const world = saveGame.world && saveGame.world.teams
    ? { leagues: saveGame.world.leagues || {}, teams: saveGame.world.teams, players: saveGame.world.players || {}, tier2: saveGame.world.tier2 || null }
    : worldToSlice(buildWorld());
  store.dispatch(replaceWorld(world));
  store.dispatch(resetEvents());
  store.dispatch(resetTransfers());
  store.dispatch(loadSeasonAction(saveGame.season));
  if (saveGame.season) mirrorEvents(store, saveGame.season);

  // Restore the multi-season career meta (default for legacy single-season saves).
  const c = saveGame.career || {};
  store.dispatch(setCareer({
    seed: c.seed != null ? c.seed : (saveGame.season ? saveGame.season.seed : DEFAULT_SEED),
    seasonIndex: c.seasonIndex || 0,
    history: c.history || [],
    offseason: c.offseason || null,
    phase: c.phase || (saveGame.season && saveGame.season.complete ? 'offseason' : 'inSeason')
  }));

  // Restore the career news inbox (empty for legacy pre-v3 saves).
  store.dispatch(loadInbox(Array.isArray(saveGame.inbox) ? saveGame.inbox : []));

  // Restore the match-day reveal cursor — the schedule is rebuilt from the
  // (log-stripped) season events; gating only needs team/stage/match ids.
  const rev = saveGame.reveal;
  if (rev && rev.slotId && saveGame.season) {
    const entries = saveGame.season.events.filter((e) => e.slotId === rev.slotId);
    const schedule = buildSlotSchedule(entries);
    store.dispatch(setReveal({
      slotId: rev.slotId,
      schedule,
      dayIndex: typeof rev.dayIndex === 'number' ? rev.dayIndex : schedule.length - 1
    }));
  } else {
    store.dispatch(resetReveal());
  }

  // Restore scouting focuses (empty for legacy pre-scouting saves).
  store.dispatch(resetScouting());
  const savedFocuses = (saveGame.scouting && saveGame.scouting.focuses) || [];
  for (const f of savedFocuses) {
    if (f && f.playerId && typeof f.seasonIndex === 'number') {
      store.dispatch(addScoutFocus(f.playerId, f.seasonIndex));
    }
  }

  // Restore viewing preferences (default spoiler-free ON for pre-v? saves).
  const settings = saveGame.settings || {};
  store.dispatch(setSpoilerFree(settings.spoilerFree !== false));
  store.dispatch(setAutoplaySpeed(settings.autoplaySpeed || 'normal'));

  const followedId = settings.followedTeamId || null;
  if (followedId) store.dispatch(follow(followedId));
  else {
    const teamIds = Object.keys(world.teams || {});
    if (teamIds.length > 0) store.dispatch(follow(teamIds[0]));
  }
  store.dispatch(navigate('home'));
}

/**
 * Adapt a World { teamsById, playersById, leagues, tier2? } (engine shape) to
 * the world slice shape { teams, players, leagues, tier2 }.
 * @param {object} world
 * @returns {{leagues:object, teams:object, players:object, tier2:object|null}}
 */
function worldToSlice(world) {
  return {
    leagues: world.leagues || {},
    teams: world.teamsById || {},
    players: world.playersById || {},
    tier2: world.tier2 || null
  };
}

/* ------------------------------------------------------------------ */
/* career bridge (store slices <-> engine CareerState)                 */
/* ------------------------------------------------------------------ */

/**
 * Reconstruct a full engine CareerState from the store slices (world + season +
 * career-meta). The engine functions (advanceCareerSlot / runCareerOffseason)
 * take and return this shape.
 *
 * @param {import('../core/store.js').Store} store
 * @returns {object} CareerState { seed, seasonIndex, world, season, history, offseason, phase }
 */
function readCareer(store) {
  const state = store.getState();
  const c = state.career || {};
  return {
    seed: c.seed != null ? c.seed : DEFAULT_SEED,
    seasonIndex: c.seasonIndex || 0,
    world: sliceToWorld(state.world),
    season: selectSeason(state),
    history: c.history || [],
    offseason: c.offseason || null,
    phase: c.phase || 'inSeason'
  };
}

/**
 * Write an engine CareerState back into the store slices.
 * @param {import('../core/store.js').Store} store
 * @param {object} career  CareerState
 * @param {{ newSeason?: boolean }} [opts]  newSeason resets the event mirror + inits the season
 */
function writeCareer(store, career, opts = {}) {
  store.dispatch(replaceWorld(worldToSlice(career.world)));
  if (opts.newSeason) {
    store.dispatch(resetEvents());
    store.dispatch(resetTransfers()); // a fresh transfer window opens each season
    store.dispatch(initSeasonAction(career.season));
  } else {
    store.dispatch(advanceSeasonAction(career.season));
  }
  store.dispatch(setCareer({
    seed: career.seed,
    seasonIndex: career.seasonIndex,
    history: career.history,
    offseason: career.offseason,
    phase: career.phase
  }));
  if (career.season) mirrorEvents(store, career.season);
}

/**
 * Install a fresh CareerState into the store (world + reset events + season +
 * career-meta), follow a default team, and route home.
 * @param {import('../core/store.js').Store} store
 * @param {object} career  CareerState from initCareer
 */
function installCareer(store, career) {
  store.dispatch(replaceWorld(worldToSlice(career.world)));
  store.dispatch(resetEvents());
  store.dispatch(resetTransfers());
  store.dispatch(resetReveal()); // no slot is mid-reveal at the start of a career
  store.dispatch(resetScouting()); // a fresh career starts with no scouting history
  store.dispatch(loadInbox([])); // a fresh career starts with an empty news feed
  store.dispatch(initSeasonAction(career.season));
  store.dispatch(setCareer({
    seed: career.seed,
    seasonIndex: career.seasonIndex,
    history: career.history,
    offseason: career.offseason,
    phase: career.phase
  }));
  const teamIds = Object.keys(career.world.teamsById);
  if (teamIds.length > 0) store.dispatch(follow(teamIds[0]));
  store.dispatch(navigate('home'));
}

/* ------------------------------------------------------------------ */
/* lifecycle commands                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build the full 48-team world, init a fresh SeasonState, set a default followed
 * team, and land on Home — SYNCHRONOUSLY, so callers that don't await still see
 * a fully-initialised store immediately (the Node smoke checks, main.js).
 *
 * It THEN probes the autosave slot asynchronously and, if one is present,
 * hydrates from it (so a returning browser player resumes where they left off).
 * The returned Promise resolves once that probe settles; `await bootstrap(store)`
 * guarantees the resume (when any) has been applied.
 *
 * @param {import('../core/store.js').Store} store
 * @param {{ fresh?: boolean }} [opts]  fresh:true skips the autosave resume
 * @returns {Promise<{resumed:boolean}>}
 */
export async function bootstrap(store, opts = {}) {
  // A fresh multi-season career: build + stagger the world and init season 0.
  // Synchronous, so non-awaiting callers get a fully-inited store immediately.
  installCareer(store, initCareer(DEFAULT_SEED));

  if (opts.fresh) {
    // Even on a fresh start, warm the ui-held slot list so the SaveLoad screen
    // shows any persisted (non-autosave) slots immediately.
    await refreshSlots(store);
    return { resumed: false };
  }

  // Resume from the autosave slot if one exists (browser). In Node with the
  // Memory adapter there is none, so this resolves to a no-op fresh start.
  try {
    const save = await saveManager.loadSlot(saveManager.AUTOSAVE_ID);
    if (save && save.season) {
      hydrateSaveGame(store, save);
      await refreshSlots(store);
      return { resumed: true };
    }
  } catch {
    // No persistence available / corrupt autosave — keep the fresh start.
  }
  await refreshSlots(store);
  return { resumed: false };
}

/**
 * Followed-team match-result news for the given revealed match-days — the
 * day-by-day flavour. Reads each ref's series from the season's events.
 * @returns {object[]} NewsItem[]
 */
function revealedDayNews(days, season, world, ctx) {
  if (!ctx.followedTeamId || !days || !days.length) return [];
  const teamsById = (world && world.teamsById) || {};
  const name = (id) => (teamsById[id] && teamsById[id].name) || id;
  const items = [];
  for (const day of days) {
    for (const ref of day.refs) {
      const entry = season.events.find((e) => e.result && e.result.eventId === ref.eventId);
      const s = entry && entry.result.series.find((x) => x.stageId === ref.stageId && x.matchId === ref.matchId);
      if (!s) continue;
      if (s.teamAId !== ctx.followedTeamId && s.teamBId !== ctx.followedTeamId) continue;
      const isA = s.teamAId === ctx.followedTeamId;
      const opp = isA ? s.teamBId : s.teamAId;
      const my = isA ? s.score.A : s.score.B;
      const oppScore = isA ? s.score.B : s.score.A;
      const won = s.winnerId === ctx.followedTeamId;
      items.push({
        kind: 'result',
        seasonIndex: ctx.seasonIndex,
        slotId: ctx.slotId,
        teamId: ctx.followedTeamId,
        tone: won ? 'good' : 'bad',
        headline: `${day.label}: ${name(ctx.followedTeamId)} ${won ? 'beat' : 'lost to'} ${name(opp)} ${my}–${oppScore}`
      });
    }
  }
  return items;
}

/** Injury news for the followed team's new knocks between two worlds (engine shape). */
function followedInjuryNews(beforeWorld, afterWorld, slotId, ctx) {
  if (!ctx.followedTeamId) return [];
  const fresh = [];
  for (const id of Object.keys(afterWorld.playersById)) {
    const after = afterWorld.playersById[id];
    const before = beforeWorld.playersById[id];
    if (
      after && after.contract && after.contract.teamId === ctx.followedTeamId &&
      isFreshInjury(before && before.injury, after.injury)
    ) {
      fresh.push({ playerId: id, injury: after.injury });
    }
  }
  return injuryNews(fresh, afterWorld, { seasonIndex: ctx.seasonIndex, slotId, followedTeamId: ctx.followedTeamId });
}

/** Event-result (+ champion/awards on season end) news, fired when a slot fully reveals. */
function slotFinishNews(season, world, seasonIndex, slotId, followedTeamId) {
  const entries = season.events.filter((e) => e.slotId === slotId);
  const news = eventNews(entries, world, { seasonIndex, followedTeamId });
  if (season.complete) {
    const awards = computeSeasonAwards(season, world);
    news.push(...awardNews(awards, world, { seasonIndex, followedTeamId }));
  }
  return news;
}

/** Toast (+ navigate unless noNav) when a slot's reveal completes (engine-shape world). */
function finishSlot(store, season, world, slotId, noNav) {
  if (season.complete) {
    const champ = season.champion;
    const name = (world.teamsById && world.teamsById[champ] && world.teamsById[champ].name) || champ;
    store.dispatch(pushToast('success', `${name} are crowned World Champions! Continue for the off-season.`));
    if (!noNav) store.dispatch(navigate('champions'));
  } else {
    const slot = season.calendar.find((s) => s.id === slotId);
    store.dispatch(pushToast('success', `${slotLabel(slot)} complete`));
    if (!noNav) store.dispatch(navigate('calendar'));
  }
}

/**
 * Advance the career by ONE MATCH-DAY (the day-by-day "Continue").
 *
 * Each Continue either reveals the next match-day of the slot currently in
 * progress, starts the next calendar slot (computing it atomically + revealing
 * its first day), or — once the final slot is fully watched — resolves the
 * off-season and rolls into the next season. The engine still resolves whole
 * slots deterministically; this only PACES the reveal, so Standings/Bracket/
 * Leaders build up spoiler-free (the gating lives in the selectors).
 *
 * @param {import('../core/store.js').Store} store
 * @param {{ simEvent?: boolean }} [opts]  simEvent: reveal the rest of the slot at once
 * @returns {void}
 */
export function continueSeason(store, opts = {}) {
  const simToEnd = !!opts.simEvent;
  const noNav = !!opts.noNav; // autoplay: advance without yanking the viewer's screen
  const career = readCareer(store);

  if (!career.season) {
    store.dispatch(pushToast('error', 'No season in progress — bootstrap first.'));
    return;
  }

  const followedTeamId = store.getState().ui.followedTeamId || null;
  const reveal = store.getState().reveal || { slotId: null, dayIndex: -1, totalDays: 0, schedule: [] };

  // 1) A slot is mid-reveal — play through its match-days. This precedes the
  //    off-season check so the final Champions slot is fully watched first.
  if (reveal.slotId && reveal.dayIndex < reveal.totalDays - 1) {
    const fromDay = reveal.dayIndex + 1;
    const toDay = simToEnd ? reveal.totalDays - 1 : fromDay;
    store.dispatch(simToEnd ? revealToEnd() : advanceReveal());

    const shown = reveal.schedule.slice(fromDay, toDay + 1);
    const news = revealedDayNews(shown, career.season, career.world, {
      seasonIndex: career.seasonIndex, slotId: reveal.slotId, followedTeamId
    });
    if (toDay >= reveal.totalDays - 1) {
      news.push(...slotFinishNews(career.season, career.world, career.seasonIndex, reveal.slotId, followedTeamId));
      if (news.length) store.dispatch(appendNews(news));
      finishSlot(store, career.season, career.world, reveal.slotId, noNav);
    } else {
      if (news.length) store.dispatch(appendNews(news));
      if (!noNav) store.dispatch(navigate('matchday'));
    }
    void autosaveCurrent(store);
    return;
  }

  // 2) Off-season — aging/retirements/newgens/transfers, then start next season.
  if (career.phase === 'offseason') {
    // Shield the user's own club from AI buy/sell raids — they manage their squad.
    const next = runCareerOffseason(career, { protectTeamId: followedTeamId });
    store.dispatch(resetReveal()); // a fresh season opens with no slot revealing
    writeCareer(store, next, { newSeason: true });
    const osNews = offseasonNews(next.offseason, next.world, {
      seasonIndex: next.offseason ? next.offseason.season : career.seasonIndex,
      followedTeamId
    });
    if (osNews.length) store.dispatch(appendNews(osNews));
    void autosaveCurrent(store);
    store.dispatch(pushToast('success', `Off-season complete — Season ${next.seasonIndex + 1} begins.`));
    if (!noNav) store.dispatch(navigate('offseason'));
    return;
  }

  // 3) Start the next calendar slot: compute it (atomic + deterministic), build its
  //    day schedule, reveal day 0 (or the whole slot if "Sim event"). The reveal is
  //    set BEFORE the events are mirrored so the new slot is gated from the first frame.
  const playedSlot = career.season.calendar[career.season.slotIndex];
  const next = advanceCareerSlot(career);
  const entries = next.season.events.filter((e) => e.slotId === playedSlot.id);
  const schedule = buildSlotSchedule(entries);
  const lastDay = schedule.length - 1;
  const dayIndex = simToEnd ? lastDay : 0;
  store.dispatch(setReveal({ slotId: playedSlot.id, schedule, dayIndex }));
  writeCareer(store, next, { newSeason: false });

  const news = followedInjuryNews(career.world, next.world, playedSlot.id, { seasonIndex: next.seasonIndex, followedTeamId });
  news.push(...revealedDayNews(schedule.slice(0, dayIndex + 1), next.season, next.world, {
    seasonIndex: next.seasonIndex, slotId: playedSlot.id, followedTeamId
  }));

  if (dayIndex >= lastDay) {
    // A single-day slot or "Sim event": the whole slot is revealed at once.
    news.push(...slotFinishNews(next.season, next.world, next.seasonIndex, playedSlot.id, followedTeamId));
    if (news.length) store.dispatch(appendNews(news));
    finishSlot(store, next.season, next.world, playedSlot.id, noNav);
  } else {
    if (news.length) store.dispatch(appendNews(news));
    if (!noNav) store.dispatch(navigate('matchday'));
  }
  void autosaveCurrent(store);
}

/**
 * Navigate to an event's Tournament view (group stage by default). For a
 * regional slot pass the `region`; for an international slot pass only `slotId`.
 * The unified Tournament screen takes a `view` sub-tab ('standings' | 'bracket').
 *
 * @param {import('../core/store.js').Store} store
 * @param {string} slotId
 * @param {string} [region]
 * @param {string} [view='standings']  'standings' | 'bracket' Tournament sub-tab
 * @returns {void}
 */
export function openEvent(store, slotId, region, view = 'standings') {
  const eventId = region ? `${slotId}-${region}` : slotId;
  store.dispatch(navigate('tournament', { slotId, region: region || null, eventId, view }));
}

/**
 * Follow a team — or pass null/falsy to spectate with NO team followed. Pure UI
 * state (no engine effect); autosaves so the choice persists across reloads.
 *
 * @param {import('../core/store.js').Store} store
 * @param {string|null} teamId
 * @returns {void}
 */
export function followTeam(store, teamId) {
  store.dispatch(follow(teamId || null));
  void autosaveCurrent(store);
}

/**
 * Hydrate a series' round logs (re-sim from its seed when stripped), point the
 * match round-ticker at it (map 0, round 0, stopped), and open the Match screen.
 *
 * Hydration is a no-op when the series already carries logs (in-memory play);
 * after a stripped load it rebuilds byte-identical maps via the engine's
 * hydrateSeries. The rehydrated series is mirrored back into its event so the
 * Match screen reads full logs through the usual selectors.
 *
 * @param {import('../core/store.js').Store} store
 * @param {string} seriesId
 * @returns {void}
 */
export function openSeries(store, seriesId) {
  const state = store.getState();
  const world = sliceToWorld(state.world);

  // Find the series + its owning event so we can re-mirror the hydrated copy.
  for (const eid of state.events.order) {
    const ev = state.events.byId[eid];
    if (!ev || !Array.isArray(ev.series)) continue;
    const idx = ev.series.findIndex((s) => s && s.id === seriesId);
    if (idx === -1) continue;

    const series = ev.series[idx];
    const hydrated = hydrateSeries(series, world);
    if (hydrated !== series) {
      // Re-mirror the event with the hydrated series in both the flat list and
      // the matching stage list, so selectors expose the restored logs.
      const next = rehydrateEvent(ev, seriesId, hydrated);
      store.dispatch(addEvent(eid, next));
      store.dispatch(setStatus(eid, 'complete'));
    }
    break;
  }

  // In spoiler-free mode a freshly opened series plays out live from round 1 of
  // map 1 (the spectator experience); otherwise it opens paused on the full result.
  const spoilerFree = !!state.ui.spoilerFree;
  store.dispatch(tickerSet({ seriesId, mapIndex: 0, roundIndex: 0, playing: spoilerFree, maxMap: 0, revealed: false }));
  store.dispatch(navigate('match', { seriesId }));
}

/**
 * Toggle spoiler-free mode and persist the choice.
 * @param {import('../core/store.js').Store} store
 * @param {boolean} on
 * @returns {void}
 */
export function toggleSpoilerFree(store, on) {
  store.dispatch(setSpoilerFree(!!on));
  void autosaveCurrent(store);
}

/**
 * Set the hands-free autoplay cadence and persist it.
 * @param {import('../core/store.js').Store} store
 * @param {'slow'|'normal'|'fast'} speed
 * @returns {void}
 */
export function setAutoplayPace(store, speed) {
  store.dispatch(setAutoplaySpeed(speed));
  void autosaveCurrent(store);
}

/* ------------------------------------------------------------------ */
/* transfer-market commands (P6d)                                      */
/* ------------------------------------------------------------------ */
/**
 * The user brokers moves on the world DIRECTLY (the season engine stays pure —
 * it just receives whatever world the next Continue hands it, exactly as it
 * already does). Each command updates the affected Player + Team in the world
 * slice, logs the Move into the transfer-window slice, toasts, and autosaves.
 * Roster validity (≥ MIN_ROSTER, ≤ MAX_ROSTER) is enforced so the match engine
 * always fields a legal starting five (its lineup = the first 5 roster ids).
 *
 * Salary/length reuse the engine's salaryFor + BALANCE so user pay is consistent
 * with the AI market. Contract length is fixed (no rng in the UI layer), and the
 * expiry is set past the upcoming off-season so a fresh signing isn't instantly
 * up for renewal (the off-season treats expires ≤ seasonIndex as "up").
 */

/** A frozen Player copy with a replaced contract. */
function withContract(player, contract) {
  return Object.freeze({ ...player, contract });
}

/** A frozen Team copy with a replaced roster (also frozen). */
function withRoster(team, roster) {
  return Object.freeze({ ...team, roster: Object.freeze(roster) });
}

/** The current season ordinal (for contract expiry math). */
function currentSeasonIndex(store) {
  const c = store.getState().career;
  return (c && c.seasonIndex) || 0;
}

/**
 * Sign a free agent onto a team (defaults to the followed team). The player must
 * be a free agent and the team must have room (< MAX_ROSTER). New signings join
 * the bench (end of the roster); reorder via {@link moveRosterPlayer} to start them.
 *
 * @param {import('../core/store.js').Store} store
 * @param {string} playerId
 * @param {string} [teamId]  defaults to the followed team
 * @returns {boolean} true if the signing went through
 */
export function signPlayer(store, playerId, teamId) {
  const state = store.getState();
  const tid = teamId || state.ui.followedTeamId;
  const team = tid ? state.world.teams[tid] : null;
  const player = state.world.players[playerId];

  if (!team) {
    store.dispatch(pushToast('error', 'No team selected to sign for.'));
    return false;
  }
  if (!player) {
    store.dispatch(pushToast('error', 'Player not found.'));
    return false;
  }
  const label = player.handle || player.name || playerId;
  if (!player.contract || player.contract.status !== 'free_agent') {
    store.dispatch(pushToast('error', `${label} is not a free agent.`));
    return false;
  }
  const roster = team.roster || [];
  if (roster.includes(playerId)) return false; // already rostered (defensive no-op)
  if (roster.length >= MARKET.MAX_ROSTER) {
    store.dispatch(pushToast('error', `${team.name} are full (${MARKET.MAX_ROSTER} max) — release someone first.`));
    return false;
  }

  const salary = salaryFor(player);
  // Economy gate (P7e): the club must have the cash on hand to carry the wage.
  const budget = Number(team.budget) || 0;
  if (salary > budget) {
    store.dispatch(pushToast('error', `${team.name} can't afford ${label} — $${Math.round(salary / 1000)}k wage vs $${Math.round(budget / 1000)}k budget.`));
    return false;
  }
  const expires = currentSeasonIndex(store) + MARKET.USER_SIGN_LENGTH;
  store.dispatch(setPlayer(withContract(player, { teamId: tid, salary, expires, status: 'active' })));
  store.dispatch(setTeam(withRoster(team, [...roster, playerId])));
  store.dispatch(recordTransfer({ playerId, fromTeamId: null, toTeamId: tid, fee: 0, salary, kind: 'signing', name: label }));
  store.dispatch(pushToast('success', `Signed ${label} to ${team.name}.`));
  void autosaveCurrent(store);
  return true;
}

/**
 * Release a player to free agency. Refused if it would drop the roster below
 * MIN_ROSTER (the match engine must always have five to field).
 *
 * @param {import('../core/store.js').Store} store
 * @param {string} playerId
 * @returns {boolean} true if the release went through
 */
export function releasePlayer(store, playerId) {
  const state = store.getState();
  const player = state.world.players[playerId];
  if (!player) {
    store.dispatch(pushToast('error', 'Player not found.'));
    return false;
  }
  const tid = (player.contract && player.contract.teamId) || state.ui.followedTeamId;
  const team = tid ? state.world.teams[tid] : null;
  const label = player.handle || player.name || playerId;
  if (!team || !(team.roster || []).includes(playerId)) {
    store.dispatch(pushToast('error', `${label} is not on a roster you manage.`));
    return false;
  }
  if ((team.roster || []).length <= MARKET.MIN_ROSTER) {
    store.dispatch(pushToast('error', `Can't release — ${team.name} can't drop below ${MARKET.MIN_ROSTER}.`));
    return false;
  }

  store.dispatch(setPlayer(withContract(player, { teamId: null, salary: 0, expires: 0, status: 'free_agent' })));
  store.dispatch(setTeam(withRoster(team, team.roster.filter((id) => id !== playerId))));
  store.dispatch(recordTransfer({ playerId, fromTeamId: tid, toTeamId: null, fee: 0, salary: 0, kind: 'release', name: label }));
  store.dispatch(pushToast('info', `Released ${label} from ${team.name}.`));
  void autosaveCurrent(store);
  return true;
}

/**
 * Offer a rostered player a contract extension — re-prices the salary (salaryFor)
 * and pushes the expiry out USER_SIGN_LENGTH seasons past the upcoming off-season.
 *
 * @param {import('../core/store.js').Store} store
 * @param {string} playerId
 * @param {{ length?: number }} [opts]
 * @returns {boolean} true if the extension went through
 */
export function offerContract(store, playerId, opts = {}) {
  const state = store.getState();
  const player = state.world.players[playerId];
  if (!player) {
    store.dispatch(pushToast('error', 'Player not found.'));
    return false;
  }
  const tid = player.contract && player.contract.teamId;
  const team = tid ? state.world.teams[tid] : null;
  const label = player.handle || player.name || playerId;
  if (!team || !(team.roster || []).includes(playerId) || player.contract.status !== 'active') {
    store.dispatch(pushToast('error', `Can only extend an active player on a roster you manage.`));
    return false;
  }

  const length = opts.length > 0 ? opts.length : MARKET.USER_SIGN_LENGTH;
  const seasonIndex = currentSeasonIndex(store);
  const prevExpires = Number(player.contract.expires) || 0;
  const expires = Math.max(prevExpires, seasonIndex) + length;
  const salary = salaryFor(player);
  store.dispatch(setPlayer(withContract(player, { teamId: tid, salary, expires, status: 'active' })));
  store.dispatch(recordTransfer({ playerId, fromTeamId: tid, toTeamId: tid, fee: 0, salary, kind: 'renew', name: label }));
  store.dispatch(pushToast('success', `Extended ${label} through S${expires + 1}.`));
  void autosaveCurrent(store);
  return true;
}

/**
 * Reorder the followed team's roster (lineup management): the FIRST FIVE roster
 * ids are the starting five the match engine fields, so moving a player up/down
 * sets who starts vs. who benches. `delta < 0` moves up (toward starter), `delta
 * > 0` moves down (toward bench). Clamped at the ends.
 *
 * @param {import('../core/store.js').Store} store
 * @param {string} playerId
 * @param {number} delta  -1 to promote, +1 to demote
 * @returns {boolean} true if the order changed
 */
export function moveRosterPlayer(store, playerId, delta) {
  const state = store.getState();
  const tid = state.ui.followedTeamId;
  const team = tid ? state.world.teams[tid] : null;
  if (!team || !Array.isArray(team.roster)) return false;
  const roster = team.roster.slice();
  const i = roster.indexOf(playerId);
  if (i < 0) return false;
  const j = i + (delta < 0 ? -1 : 1);
  if (j < 0 || j >= roster.length) return false;
  const tmp = roster[i];
  roster[i] = roster[j];
  roster[j] = tmp;
  store.dispatch(setTeam(withRoster(team, roster)));
  void autosaveCurrent(store);
  return true;
}

/* ------------------------------------------------------------------ */
/* buy/sell + coach (P13)                                              */
/* ------------------------------------------------------------------ */

/** The highest-value free agent a team can afford the wage of (or best available). */
function bestRefillFreeAgent(state, teamBudget) {
  const players = state.world.players || {};
  let bestAfford = null;
  let bestAny = null;
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (!p || !p.contract || p.contract.status !== 'free_agent') continue;
    if (!bestAny || playerValue(p) > playerValue(bestAny)) bestAny = p;
    if (salaryFor(p) <= teamBudget && (!bestAfford || playerValue(p) > playerValue(bestAfford))) bestAfford = p;
  }
  return bestAfford || bestAny;
}

/**
 * Buy a CONTRACTED player from another club for the followed team, paying a
 * transfer fee from the budget (the coach's negotiation rating trims it). The
 * selling AI club banks the fee and refills its vacated slot from the free-agent
 * pool, so every roster stays valid. The bought player joins the user's bench
 * (≤ MAX_ROSTER). Refused if the club can't afford the fee+wage, is full, or the
 * seller has no replacement on the market.
 *
 * @param {import('../core/store.js').Store} store
 * @param {string} playerId
 * @returns {boolean}
 */
export function buyPlayer(store, playerId) {
  const state = store.getState();
  const tid = state.ui.followedTeamId;
  const team = tid ? state.world.teams[tid] : null;
  const player = state.world.players[playerId];
  if (!team) { store.dispatch(pushToast('error', 'No team selected to buy for.')); return false; }
  if (!player) { store.dispatch(pushToast('error', 'Player not found.')); return false; }
  const label = player.handle || player.name || playerId;
  const c = player.contract;
  if (!c || c.status !== 'active' || !c.teamId || c.teamId === tid) {
    store.dispatch(pushToast('error', `${label} isn't a contracted player at another club.`));
    return false;
  }
  const seller = state.world.teams[c.teamId];
  if (!seller) { store.dispatch(pushToast('error', 'Selling club not found.')); return false; }
  const roster = team.roster || [];
  if (roster.length >= MARKET.MAX_ROSTER) {
    store.dispatch(pushToast('error', `${team.name} are full (${MARKET.MAX_ROSTER} max) — release someone first.`));
    return false;
  }
  const season = currentSeasonIndex(store);
  const nego = team.coach ? team.coach.negotiation : 0;
  const fee = transferFee(player, seller, { season, coachNego: nego });
  const wage = salaryFor(player);
  const budget = Number(team.budget) || 0;
  if (fee > budget) {
    store.dispatch(pushToast('error', `Can't afford ${label} — $${Math.round(fee / 1000)}k fee vs $${Math.round(budget / 1000)}k budget.`));
    return false;
  }
  if (budget - fee < wage) {
    store.dispatch(pushToast('error', `Can't carry ${label}'s $${Math.round(wage / 1000)}k wage after a $${Math.round(fee / 1000)}k fee.`));
    return false;
  }
  // Never spend below the budget floor (the seller is credited the full fee, so a
  // floor-breaching buy would mint money — refuse, consistent with the AI market).
  const floor = BALANCE.CAREER.ECONOMY.BUDGET_FLOOR;
  if (budget - fee < floor) {
    store.dispatch(pushToast('error', `A $${Math.round(fee / 1000)}k fee would drop ${team.name} below its $${Math.round(floor / 1000)}k reserve floor.`));
    return false;
  }

  // Seller loses the player and must refill from the pool to stay ≥ MIN_ROSTER.
  const sellerBudgetAfter = (Number(seller.budget) || 0) + fee;
  const sellerRoster = (seller.roster || []).filter((id) => id !== playerId);
  if (sellerRoster.length < MARKET.MIN_ROSTER) {
    const refill = bestRefillFreeAgent(state, sellerBudgetAfter);
    if (!refill) {
      store.dispatch(pushToast('error', `${seller.name} have no replacement on the market — the deal collapses.`));
      return false;
    }
    sellerRoster.push(refill.id);
    store.dispatch(setPlayer(withContract(refill, { teamId: seller.id, salary: salaryFor(refill), expires: season + 1, status: 'active' })));
  }
  store.dispatch(setTeam(Object.freeze({ ...seller, roster: Object.freeze(sellerRoster), budget: Math.round(sellerBudgetAfter) })));

  // The bought player joins the user's bench; pay the fee.
  store.dispatch(setPlayer(withContract(player, { teamId: tid, salary: wage, expires: season + MARKET.USER_SIGN_LENGTH, status: 'active' })));
  store.dispatch(setTeam(Object.freeze({ ...team, roster: Object.freeze([...roster, playerId]), budget: Math.round(budget - fee) })));
  store.dispatch(recordTransfer({ playerId, fromTeamId: seller.id, toTeamId: tid, fee, salary: wage, kind: 'transfer', name: label }));
  store.dispatch(pushToast('success', `Bought ${label} from ${seller.name} for $${Math.round(fee / 1000)}k.`));
  void autosaveCurrent(store);
  return true;
}

/**
 * Sell a rostered player to an AI club. The engine picks the richest willing
 * buyer deterministically (most budget → ties broken by teamId). The user's
 * club receives the transfer fee; the buyer pays it and carries the wage.
 * Refused if the club would drop below MIN_ROSTER or no team can afford it.
 *
 * @param {import('../core/store.js').Store} store
 * @param {string} playerId
 * @returns {boolean}
 */
export function sellPlayer(store, playerId) {
  const state = store.getState();
  const tid = state.ui.followedTeamId;
  const team = tid ? state.world.teams[tid] : null;
  const player = state.world.players[playerId];
  if (!team) { store.dispatch(pushToast('error', 'No team selected.')); return false; }
  if (!player) { store.dispatch(pushToast('error', 'Player not found.')); return false; }
  const label = player.handle || player.name || playerId;
  const c = player.contract;
  if (!c || c.status !== 'active' || c.teamId !== tid) {
    store.dispatch(pushToast('error', `${label} is not on your active roster.`));
    return false;
  }
  if ((team.roster || []).length <= MARKET.MIN_ROSTER) {
    store.dispatch(pushToast('error', `Can't sell — ${team.name} can't drop below ${MARKET.MIN_ROSTER}.`));
    return false;
  }
  const season = currentSeasonIndex(store);
  const nego = team.coach ? team.coach.negotiation : 0;
  const fee = transferFee(player, team, { season, coachNego: nego });
  const wage = salaryFor(player);
  const floor = BALANCE.CAREER.ECONOMY.BUDGET_FLOOR;

  // Find the richest team that can afford the fee+wage and still has roster room.
  // Sort by teamId for a fully-deterministic tiebreak before taking the max-budget.
  const allTeams = state.world.teams;
  let buyer = null;
  let bestBudget = -1;
  for (const id of Object.keys(allTeams).sort()) {
    if (id === tid) continue;
    const t = allTeams[id];
    const tBudget = Number(t.budget) || 0;
    if ((t.roster || []).length >= MARKET.MAX_ROSTER) continue;
    if (tBudget - fee < floor) continue;
    if (tBudget - fee < wage) continue;
    if (tBudget > bestBudget) { bestBudget = tBudget; buyer = t; }
  }
  if (!buyer) {
    store.dispatch(pushToast('error', `No team can afford ${label} right now.`));
    return false;
  }

  // User's club: remove player, bank the fee.
  const sellerRoster = (team.roster || []).filter((id) => id !== playerId);
  store.dispatch(setTeam(Object.freeze({ ...team, roster: Object.freeze(sellerRoster), budget: Math.round((Number(team.budget) || 0) + fee) })));

  // Buying AI club: add player on a fresh contract, pay the fee.
  const buyerRoster = [...(buyer.roster || []), playerId];
  store.dispatch(setPlayer(withContract(player, { teamId: buyer.id, salary: wage, expires: season + MARKET.USER_SIGN_LENGTH, status: 'active' })));
  store.dispatch(setTeam(Object.freeze({ ...buyer, roster: Object.freeze(buyerRoster), budget: Math.round((Number(buyer.budget) || 0) - fee) })));

  store.dispatch(recordTransfer({ playerId, fromTeamId: tid, toTeamId: buyer.id, fee, salary: wage, kind: 'transfer', name: label }));
  store.dispatch(pushToast('success', `Sold ${label} to ${buyer.name} for $${Math.round(fee / 1000)}k.`));
  void autosaveCurrent(store);
  return true;
}

/**
 * Hire a head coach / GM for a team (defaults to the followed team). Generates a
 * candidate (quality biased by club reputation), gated by the budget covering the
 * coach's wage. A better `negotiation` rating means cheaper future transfers.
 *
 * @param {import('../core/store.js').Store} store
 * @param {string} [teamId]
 * @returns {boolean}
 */
export function hireCoach(store, teamId) {
  const state = store.getState();
  const tid = teamId || state.ui.followedTeamId;
  const team = tid ? state.world.teams[tid] : null;
  if (!team) { store.dispatch(pushToast('error', 'No team selected.')); return false; }
  const seed = (state.career && state.career.seed != null) ? state.career.seed : DEFAULT_SEED;
  // Re-roll varies with how many coaches this club has already cycled through.
  const salt = (team.coach ? 1 : 0) + currentSeasonIndex(store);
  const rng = createRng(hashSeed(seed, 'userhire', tid, salt));
  const coach = generateCoach(rng, { reputation: team.reputation });
  if (coach.salary > (Number(team.budget) || 0)) {
    store.dispatch(pushToast('error', `${team.name} can't afford ${coach.name}'s $${Math.round(coach.salary / 1000)}k salary.`));
    return false;
  }
  store.dispatch(setTeam(createTeam({ ...team, coach, id: team.id })));
  store.dispatch(pushToast('success', `Hired ${coach.name} — coaching ${coach.rating}, negotiation ${coach.negotiation}.`));
  void autosaveCurrent(store);
  return true;
}

/**
 * Dismiss a team's coach (defaults to the followed team).
 * @param {import('../core/store.js').Store} store
 * @param {string} [teamId]
 * @returns {boolean}
 */
export function fireCoach(store, teamId) {
  const state = store.getState();
  const tid = teamId || state.ui.followedTeamId;
  const team = tid ? state.world.teams[tid] : null;
  if (!team || !team.coach) { store.dispatch(pushToast('error', 'No coach to dismiss.')); return false; }
  const name = team.coach.name;
  store.dispatch(setTeam(createTeam({ ...team, coach: null, id: team.id })));
  store.dispatch(pushToast('info', `Dismissed ${name}.`));
  void autosaveCurrent(store);
  return true;
}

/* ------------------------------------------------------------------ */
/* scouting (P-scouting-c2)                                            */
/* ------------------------------------------------------------------ */

/**
 * Spend one scouting focus on a player for the current season. Focuses are
 * capped at MAX_SCOUT_FOCUSES per season; each season-focus is idempotent
 * (the same player can only be focused once per season). Focuses accumulate
 * across seasons: scouting the same player three seasons in a row fully
 * reveals all their hidden traits.
 *
 * @param {import('../core/store.js').Store} store
 * @param {string} playerId
 * @returns {boolean} true if the focus was recorded
 */
export function scoutPlayer(store, playerId) {
  const state = store.getState();
  const player = state.world && state.world.players && state.world.players[playerId];
  if (!player) {
    store.dispatch(pushToast('error', 'Player not found.'));
    return false;
  }
  const seasonIndex = selectSeasonIndex(state);
  const focuses = (state.scouting && state.scouting.focuses) || [];

  if (focuses.some((f) => f.playerId === playerId && f.seasonIndex === seasonIndex)) {
    store.dispatch(pushToast('info', `${player.handle || player.name} is already a scouting focus this season.`));
    return false;
  }

  const usedThisSeason = focuses.filter((f) => f.seasonIndex === seasonIndex).length;
  if (usedThisSeason >= MAX_SCOUT_FOCUSES) {
    store.dispatch(pushToast('error', `Scouting capacity full — max ${MAX_SCOUT_FOCUSES} focuses per season.`));
    return false;
  }

  store.dispatch(addScoutFocus(playerId, seasonIndex));
  store.dispatch(pushToast('success', `Scouting ${player.handle || player.name} this season.`));
  void autosaveCurrent(store);
  return true;
}

/* ------------------------------------------------------------------ */
/* god-mode editor (P7d)                                               */
/* ------------------------------------------------------------------ */
/**
 * The sandbox half of the "god-mode sandbox + follow a team" decision: edit any
 * Player or Team in place. Patches are merged onto the current entity and run
 * back through the domain factory (createPlayer/createTeam) so every edit is
 * re-validated and clamped to the domain ranges (attributes 0-100, reputation
 * 0-100, etc.). Identity (id) and untouched sub-objects are preserved. Autosaves.
 */

/**
 * Edit a player. `patch` may set top-level fields (handle, age, role, potential,
 * nationality) and/or nested `attributes` / `dynamics` / `development` / `contract`
 * (shallow-merged), and may clear/set `injury`.
 * @param {import('../core/store.js').Store} store
 * @param {string} playerId
 * @param {object} patch
 * @returns {boolean}
 */
export function editPlayer(store, playerId, patch) {
  const cur = store.getState().world.players[playerId];
  if (!cur) {
    store.dispatch(pushToast('error', 'Player not found.'));
    return false;
  }
  const p = patch || {};
  const merged = {
    ...cur,
    ...p,
    id: cur.id, // never let an edit change identity
    attributes: { ...cur.attributes, ...(p.attributes || {}) },
    dynamics: { ...cur.dynamics, ...(p.dynamics || {}) },
    development: { ...cur.development, ...(p.development || {}) },
    contract: { ...cur.contract, ...(p.contract || {}) }
  };
  if ('injury' in p) merged.injury = p.injury;
  store.dispatch(setPlayer(createPlayer(merged)));
  void autosaveCurrent(store);
  return true;
}

/**
 * Edit a team's identity / standing (name, tag, reputation, budget). The roster is
 * preserved; reputation/budget are clamped by the domain factory.
 * @param {import('../core/store.js').Store} store
 * @param {string} teamId
 * @param {object} patch
 * @returns {boolean}
 */
export function editTeam(store, teamId, patch) {
  const cur = store.getState().world.teams[teamId];
  if (!cur) {
    store.dispatch(pushToast('error', 'Team not found.'));
    return false;
  }
  store.dispatch(setTeam(createTeam({ ...cur, ...(patch || {}), id: cur.id })));
  void autosaveCurrent(store);
  return true;
}

/**
 * God-mode convenience: clear a player's injury and reset their fatigue.
 * @param {import('../core/store.js').Store} store
 * @param {string} playerId
 * @returns {boolean}
 */
export function healPlayer(store, playerId) {
  const ok = editPlayer(store, playerId, { injury: null, dynamics: { fatigue: 0 } });
  if (ok) {
    const p = store.getState().world.players[playerId];
    store.dispatch(pushToast('success', `${p ? (p.handle || p.name) : 'Player'} patched up.`));
  }
  return ok;
}

/* ------------------------------------------------------------------ */
/* persistence commands (async)                                        */
/* ------------------------------------------------------------------ */

/**
 * Save the current career to a named slot (a fresh slot id each call).
 * @param {import('../core/store.js').Store} store
 * @param {string} [name='Save']
 * @returns {Promise<object>} the written SaveMeta
 */
export async function saveCurrent(store, name = 'Save') {
  const saveGame = buildSaveGame(store, { name });
  const meta = await saveManager.saveSlot(saveGame);
  store.dispatch(pushToast('success', `Saved "${meta.name}"`));
  await refreshSlots(store);
  return meta;
}

/**
 * Write the current career to the rolling autosave slot (debounced).
 * @param {import('../core/store.js').Store} store
 * @returns {Promise<object>} the written autosave SaveMeta
 */
export async function autosaveCurrent(store) {
  const saveGame = buildSaveGame(store, { name: 'Autosave' });
  return saveManager.autosave(saveGame);
}

/**
 * Load a saved slot by id, hydrate world+season+settings, toast, route home.
 * @param {import('../core/store.js').Store} store
 * @param {string} id
 * @returns {Promise<boolean>} true if a slot was loaded
 */
export async function loadSlot(store, id) {
  const save = await saveManager.loadSlot(id);
  if (!save) {
    store.dispatch(pushToast('error', 'Save not found.'));
    return false;
  }
  hydrateSaveGame(store, save);
  store.dispatch(pushToast('success', `Loaded "${save.meta ? save.meta.name : id}"`));
  await refreshSlots(store);
  return true;
}

/**
 * Delete a saved slot by id.
 * @param {import('../core/store.js').Store} store
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteSlot(store, id) {
  await saveManager.deleteSlot(id);
  store.dispatch(pushToast('info', 'Save deleted.'));
  await refreshSlots(store);
}

/**
 * Duplicate a saved slot under a new name.
 * @param {import('../core/store.js').Store} store
 * @param {string} id
 * @param {string} [newName]
 * @returns {Promise<object>} the new slot's SaveMeta
 */
export async function duplicateSlot(store, id, newName) {
  const meta = await saveManager.duplicateSlot(id, newName);
  store.dispatch(pushToast('success', `Duplicated to "${meta.name}"`));
  await refreshSlots(store);
  return meta;
}

/**
 * List all save slot metas (most-recently-played first).
 * @returns {Promise<object[]>}
 */
export async function listSlots() {
  return saveManager.listSlots();
}

/**
 * Refresh the ui-held save-slot list: await saveManager.listSlots() and dispatch
 * setSaveSlots so the SaveLoad screen re-renders from fresh data.
 *
 * The SaveLoad screen is PURE (`(state, dispatch, store) => VNode`) and renders
 * the slot list straight off `state.ui.saveSlots` — it never awaits anything
 * during render. Because listSlots() is async, SOMETHING must push the list into
 * state out-of-band; that is this command. It is invoked:
 *   - by `bootstrap` (so the list is warm before the user opens Saves),
 *   - by every slot-mutating command here (saveCurrent / loadSlot / deleteSlot /
 *     duplicateSlot / importSave) so the list reflects the change immediately,
 *   - by the SaveLoad screen on mount (its "Refresh" control + an initial kick
 *     when it sees an empty/never-loaded list).
 *
 * @param {import('../core/store.js').Store} store
 * @returns {Promise<object[]>} the slot metas just installed
 */
export async function refreshSlots(store) {
  let slots = [];
  try {
    slots = await saveManager.listSlots();
  } catch {
    slots = [];
  }
  store.dispatch(setSaveSlots(slots));
  return slots;
}

/**
 * Export the current career to a compact (log-stripped) JSON string.
 * @param {import('../core/store.js').Store} store
 * @param {{ includeLogs?: boolean }} [opts]
 * @returns {string} JSON
 */
export function exportCurrent(store, opts = {}) {
  const saveGame = buildSaveGame(store, { name: 'Export' });
  const json = exportSave(saveGame, opts);
  store.dispatch(pushToast('success', 'Career exported.'));
  return json;
}

/**
 * Import a career from a JSON string (parse + migrate), hydrate the store.
 * @param {import('../core/store.js').Store} store
 * @param {string} json
 * @returns {object} the imported SaveGame
 */
export function importSave(store, json) {
  const saveGame = deserializeSave(json);
  hydrateSaveGame(store, saveGame);
  store.dispatch(pushToast('success', 'Career imported.'));
  return saveGame;
}

/* ------------------------------------------------------------------ */
/* small pure helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Adapt the world slice { teams, players, leagues, tier2 } to the engine World
 * { teamsById, playersById, leagues, tier2? } that the season engine expects.
 * @param {{teams:object, players:object, leagues:object, tier2?:object|null}} worldSlice
 * @returns {{teamsById:object, playersById:object, leagues:object, tier2?:object}}
 */
function sliceToWorld(worldSlice) {
  const out = {
    leagues: worldSlice.leagues || {},
    teamsById: worldSlice.teams || {},
    playersById: worldSlice.players || {}
  };
  if (worldSlice.tier2) out.tier2 = worldSlice.tier2;
  return out;
}

/**
 * A human label for a calendar slot just played.
 * @param {object} slot CalendarSlot
 * @returns {string}
 */
function slotLabel(slot) {
  if (!slot) return 'Event';
  const names = {
    kickoff: 'Kickoff',
    stage: 'Stage',
    masters: 'Masters',
    champions: 'Champions'
  };
  return `${names[slot.type] || slot.id} (${slot.id})`;
}

/**
 * Return a copy of an EventResult with one series (matched by id) replaced by a
 * hydrated version, in both the flat `series[]` and the per-stage
 * `stages[].series[]` lists.
 * @param {object} event EventResult
 * @param {string} seriesId
 * @param {object} hydrated the rehydrated series
 * @returns {object}
 */
function rehydrateEvent(event, seriesId, hydrated) {
  const out = { ...event };
  if (Array.isArray(event.series)) {
    out.series = event.series.map((s) => (s && s.id === seriesId ? hydrated : s));
  }
  if (Array.isArray(event.stages)) {
    out.stages = event.stages.map((stage) => {
      if (!stage || !Array.isArray(stage.series)) return stage;
      return {
        ...stage,
        series: stage.series.map((s) => (s && s.id === seriesId ? hydrated : s))
      };
    });
  }
  return out;
}
