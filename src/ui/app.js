/**
 * ui/app.js — the application shell (CONTRACTS-UI §4).
 *
 * `App(store)` mounts the FM-style shell into `#app`, subscribes to the store,
 * and re-renders (via the keyed `patch`) on every state change. The shell is a
 * single pure `view(state)` function composed of the TopBar, Sidebar, a
 * `<main>` RouterOutlet, and the Modal/Toast roots — so the whole tree is also
 * serializable headlessly via `toHtml` (the View export below is pure).
 *
 * `document` is touched ONLY inside `App` when it is *called* (to resolve `#app`
 * and mount/patch). A bare `import` of this module performs no DOM access, so it
 * loads cleanly in Node for the smoke/import checks.
 *
 * The TopBar reflects the FULL 2026 season (CONTRACTS-PERSIST §6): its event
 * label is the next slot to play (or "Season complete"), its Continue button is
 * driven by `season.complete` — NOT the Phase-3 Kickoff status — so the user can
 * keep hitting Continue through all 8 calendar slots to a champion.
 *
 * Wiring:
 *   onNavigate(screen, params) -> dispatch(navigate(screen, params))
 *   onContinue()               -> continueSeason(store)
 */

import { h, mount, patch } from './render.js';
import { TopBar } from './components/TopBar.js';
import { Sidebar } from './components/Sidebar.js';
import { ModalRoot, ToastRoot } from './components/Roots.js';
import { RouterOutlet } from './router.js';
import { navigate, tickerSet, setAutoplay } from '../state/actions.js';
import { continueSeason, followTeam, toggleSpoilerFree, setAutoplayPace } from '../state/commands.js';
import {
  selectRoute,
  selectFollowedTeam,
  selectCalendar,
  selectSlotsPlayed,
  selectChampion,
  selectTeam,
  selectCareerPhase,
  selectSeasonIndex,
  selectUnreadNews,
  selectSeries,
  selectReveal
} from '../state/selectors.js';

/** Region labels + order for the TopBar follow dropdown's optgroups. */
const REGION_LABELS = { pacific: 'Pacific', americas: 'Americas', emea: 'EMEA', china: 'China' };
const REGION_ORDER = ['pacific', 'americas', 'emea', 'china'];

/** Build the follow-dropdown's region-grouped team list from the world. */
function buildTeamGroups(state) {
  const leagues = (state.world && state.world.leagues) || {};
  const teams = (state.world && state.world.teams) || {};
  const order = REGION_ORDER.filter((r) => leagues[r]).concat(
    Object.keys(leagues).filter((r) => !REGION_ORDER.includes(r))
  );
  return order.map((region) => ({
    region,
    label: REGION_LABELS[region] || region,
    teams: ((leagues[region] && leagues[region].teamIds) || [])
      .map((id) => teams[id])
      .filter(Boolean)
      .map((t) => ({ id: t.id, name: t.name, tag: t.tag }))
  })).filter((g) => g.teams.length);
}

/** Display labels for calendar slot ids shown in the TopBar (UI sugar). */
const SLOT_LABELS = {
  kickoff: 'Kickoff',
  m0: 'Masters One',
  stage1: 'Stage 1',
  m1: 'Masters Two',
  stage2: 'Stage 2',
  m2: 'Masters Three',
  stage3: 'Stage 3',
  champions: 'Champions'
};

/**
 * Build the full shell VNode for a given state. Pure — no DOM, no side effects;
 * the `dispatch`/`store` it closes over are only invoked by event handlers at
 * interaction time, so this serializes via toHtml.
 *
 * @param {object} state     the full store state
 * @param {(action:object)=>void} dispatch
 * @param {object} store     store reference (forwarded for command access)
 * @returns {import('./render.js').VNode}
 */
export function AppView(state, dispatch, store) {
  const route = selectRoute(state) || { screen: 'home' };
  const followedTeam = selectFollowedTeam(state);

  // Career-driven TopBar labels. The career is endless, so Continue is never
  // "disabled-complete" — at season's end it advances into the off-season.
  const phase = selectCareerPhase(state);
  const seasonIndex = selectSeasonIndex(state);
  const calendar = selectCalendar(state);
  const played = selectSlotsPlayed(state);
  const offseason = phase === 'offseason';
  const nextSlot = offseason ? null : calendar[played] || null;
  // A slot mid-reveal drives the label day-by-day; otherwise show what's up next.
  const reveal = selectReveal(state);
  const midReveal = !!(reveal && reveal.slotId && reveal.dayIndex < reveal.totalDays - 1);
  const eventLabel = offseason
    ? 'Off-season — review & continue'
    : midReveal
      ? `${SLOT_LABELS[reveal.slotId] || reveal.slotId} · Day ${reveal.dayIndex + 1} / ${reveal.totalDays}`
      : nextSlot
        ? `Up next — ${SLOT_LABELS[nextSlot.id] || nextSlot.id}`
        : `Season ${seasonIndex + 1}`;
  let seasonLabel = `Season ${seasonIndex + 1} — VCT World Tour`;
  if (offseason) {
    const champId = selectChampion(state);
    const champ = champId ? selectTeam(state, champId) : null;
    seasonLabel = `Season ${seasonIndex + 1} Champion: ${(champ && champ.name) || champId || 'TBD'}`;
  }

  // Shell wiring. Navigation goes through the ui slice; Continue runs the engine
  // command. The Sidebar's followed-team badge navigates with the team's id.
  const onNavigate = (screen, params = {}) => {
    if (screen === 'team' && (!params || !params.teamId) && followedTeam) {
      params = { teamId: followedTeam.id };
    }
    dispatch(navigate(screen, params));
  };
  const onContinue = () => continueSeason(store);
  const onSimEvent = () => continueSeason(store, { simEvent: true });
  const autoplay = !!(state.ui && state.ui.autoplay);
  const onToggleAutoplay = () => dispatch(setAutoplay(!autoplay));
  const autoplaySpeed = (state.ui && state.ui.autoplaySpeed) || 'normal';
  const onAutoplaySpeed = (speed) => setAutoplayPace(store, speed);
  // Spoiler-free viewing (P14): results stay hidden until you watch them.
  const spoilerFree = state.ui ? state.ui.spoilerFree !== false : true;
  const onToggleSpoilerFree = () => toggleSpoilerFree(store, !spoilerFree);
  // Follow-any-team dropdown (spectator control): change who you follow from
  // anywhere, or pick "Spectating" to follow no one.
  const teamGroups = buildTeamGroups(state);
  const followedTeamId = followedTeam ? followedTeam.id : null;
  const onFollow = (teamId) => followTeam(store, teamId || null);

  return h(
    'div',
    { class: 'app' },
    TopBar({
      eventLabel,
      seasonLabel,
      kickoffComplete: false, // the career is endless — Continue always advances
      onContinue,
      onSimEvent,
      revealing: midReveal,
      continueLabel: midReveal ? 'Advance day' : 'Continue',
      autoplay,
      onToggleAutoplay,
      autoplaySpeed,
      onAutoplaySpeed,
      spoilerFree,
      onToggleSpoilerFree,
      teamGroups,
      followedTeamId,
      onFollow,
      onOpenSaves: () => onNavigate('saves')
    }),
    Sidebar({ route, followedTeam, onNavigate, unread: selectUnreadNews(state) }),
    h('main', { class: 'screen-host' }, RouterOutlet(state, dispatch, store)),
    ModalRoot(state, dispatch),
    ToastRoot(state, dispatch)
  );
}

/** Per-round playback cadence at 1× speed (ms). */
const PLAYBACK_BASE_MS = 750;

/** Total rounds in the ticker's currently-selected map (0 if none resolvable). */
function tickerMapRounds(state, ticker) {
  if (!ticker || !ticker.seriesId) return 0;
  const series = selectSeries(state, ticker.seriesId);
  const maps = (series && series.maps) || [];
  if (!maps.length) return 0;
  const mi = Math.min(Math.max(ticker.mapIndex || 0, 0), maps.length - 1);
  const score = (maps[mi] && maps[mi].score) || { A: 0, B: 0 };
  return (score.A || 0) + (score.B || 0);
}

/**
 * The match-playback driver — the live "spectator" loop. While the Match screen
 * is open and `ui.ticker.playing` is true, it advances `ui.ticker.roundIndex`
 * one round per tick (cadence scaled by `ui.ticker.speed`) until the map's final
 * round, then stops. DOM-only (uses setInterval), so it lives here in `App` and
 * never touches the pure, headlessly-serialized `AppView`.
 *
 * @param {import('../core/store.js').Store} store
 * @returns {() => void} teardown (clears the timer + unsubscribes)
 */
function startPlaybackDriver(store) {
  let timer = null;
  let runningSpeed = 0;
  const clear = () => {
    if (timer && typeof clearInterval === 'function') clearInterval(timer);
    timer = null;
    runningSpeed = 0;
  };

  const evaluate = () => {
    const state = store.getState();
    const route = (state.ui && state.ui.route) || {};
    const ticker = (state.ui && state.ui.ticker) || {};
    const total = tickerMapRounds(state, ticker);
    const shouldRun = route.screen === 'match' && !!ticker.playing && total > 0;
    if (!shouldRun) {
      clear();
      return;
    }
    const speed = ticker.speed && ticker.speed > 0 ? ticker.speed : 1;
    if (timer) {
      if (runningSpeed === speed) return; // already running at the right cadence
      clear(); // speed changed — restart with the new period
    }
    runningSpeed = speed;
    const period = Math.max(120, Math.round(PLAYBACK_BASE_MS / speed));
    if (typeof setInterval !== 'function') return;
    timer = setInterval(() => {
      const s = store.getState();
      const tk = (s.ui && s.ui.ticker) || {};
      if ((s.ui.route || {}).screen !== 'match' || !tk.playing) {
        clear();
        return;
      }
      const tot = tickerMapRounds(s, tk);
      const cur = typeof tk.roundIndex === 'number' ? tk.roundIndex : 0;
      if (cur >= tot) {
        // Spoiler-free: finishing the LAST map of the series unlocks the result
        // (so it stays revealed even after navigating between maps). Earlier maps
        // just stop — the screen then offers a "Next map" control.
        const spoilerFree = !!(s.ui && s.ui.spoilerFree);
        const series = selectSeries(s, tk.seriesId);
        const maps = (series && series.maps) || [];
        const isLastMap = (tk.mapIndex || 0) >= maps.length - 1;
        store.dispatch(tickerSet(spoilerFree && isLastMap ? { playing: false, revealed: true } : { playing: false }));
        clear();
        return;
      }
      store.dispatch(tickerSet({ roundIndex: cur + 1 }));
    }, period);
  };

  const unsub = store.subscribe(evaluate);
  evaluate();
  return () => {
    clear();
    unsub();
  };
}

/** Autoplay cadence per speed setting — one match-day revealed per this many ms. */
const AUTOPLAY_MS = Object.freeze({ slow: 2400, normal: 1400, fast: 650 });

/** Resolve the autoplay period (ms) from the ui.autoplaySpeed setting. */
function autoplayPeriod(state) {
  const speed = (state.ui && state.ui.autoplaySpeed) || 'normal';
  return AUTOPLAY_MS[speed] || AUTOPLAY_MS.normal;
}

/**
 * The autoplay driver — the hands-free "just stare and watch" loop. While
 * `ui.autoplay` is on, it advances the season ONE match-day per tick WITHOUT
 * navigating (so whatever you're watching — a bracket filling in, the Match Day
 * feed, a league's standings — updates live where you are). The cadence follows
 * `ui.autoplaySpeed` (slow/normal/fast) and re-times when it changes. DOM-only.
 *
 * @param {import('../core/store.js').Store} store
 * @returns {() => void} teardown
 */
function startAutoplayDriver(store) {
  let timer = null;
  let runningPeriod = 0;
  const clear = () => {
    if (timer && typeof clearInterval === 'function') clearInterval(timer);
    timer = null;
    runningPeriod = 0;
  };
  const evaluate = () => {
    const state = store.getState();
    const on = !!(state.ui && state.ui.autoplay);
    if (!on) {
      clear();
      return;
    }
    const period = autoplayPeriod(state);
    if (timer) {
      if (runningPeriod === period) return; // already running at the right cadence
      clear(); // speed changed — restart with the new period
    }
    if (typeof setInterval !== 'function') return;
    runningPeriod = period;
    timer = setInterval(() => {
      if (!store.getState().ui.autoplay) {
        clear();
        return;
      }
      continueSeason(store, { noNav: true });
    }, period);
  };
  const unsub = store.subscribe(evaluate);
  evaluate();
  return () => {
    clear();
    unsub();
  };
}

/**
 * Mount the shell into `#app` and keep it in sync with the store.
 *
 * @param {import('../core/store.js').Store} store
 * @param {Element} [root]  optional mount target; defaults to `#app`.
 * @returns {() => void} teardown (stops playback/autoplay + tears down the subscription)
 */
export function App(store, root) {
  const container =
    root || (typeof document !== 'undefined' ? document.getElementById('app') : null);
  if (!container) {
    throw new Error('App: no mount target (expected #app element)');
  }

  const render = () => {
    const state = store.getState();
    const view = AppView(state, store.dispatch, store);
    if (container.__vnode === undefined) mount(view, container);
    else patch(container, view);
  };

  render();
  const unsubscribe = store.subscribe(render);
  const stopPlayback = startPlaybackDriver(store);
  const stopAutoplay = startAutoplayDriver(store);
  return () => {
    stopAutoplay();
    stopPlayback();
    unsubscribe();
  };
}
