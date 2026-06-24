/**
 * ui/screens/Match.js — Match screen (CONTRACTS-UI §5 id 'match').
 * Phase 3 (UI shell). PURE (state, dispatch) -> VNode; renders headlessly via
 * toHtml (no DOM access here — only state, selectors, and dispatch).
 *
 * Resolves a series from `ui.route.params.seriesId` (falling back to
 * `ui.ticker.seriesId`) via selectSeries, then shows:
 *   - a series header (the two teams + the running map score),
 *   - a VetoPanel listing the veto picks (mapId + who picked it),
 *   - a map switcher: a tab per map in the series; selecting a tab dispatches
 *     tickerSet({ mapIndex }) (also resets the round cursor),
 *   - for the selected map: a play/pause + seek (range) playback control wired
 *     to tickerSet, then the RoundTicker and BoxScore for that map.
 *
 * SPECTATOR (spoiler-free) MODE — `ui.spoilerFree` (P14):
 * When on, an opened series plays out LIVE and nothing is spoiled ahead of the
 * watch cursor. The series score + winner stay hidden behind a "LIVE" pill, only
 * the maps watched so far (`ticker.maxMap` high-water mark) get tabs, each map's
 * score + box score stay hidden until that map is watched to its final round, and
 * the result unlocks once the last map ends (or "Reveal result" is pressed). A
 * "Next map" control carries the watch through a Bo3/Bo5 map by map. Turn spoilers
 * back on from the top bar to see everything instantly (the legacy behaviour).
 */

import { h, classNames } from '../render.js';
import { selectSeries, selectTeam, selectWorld } from '../../state/selectors.js';
import { tickerSet } from '../../state/actions.js';
import { RoundTicker } from '../components/RoundTicker.js';
import { BoxScore } from '../components/BoxScore.js';
import { CommentaryLog } from '../components/CommentaryLog.js';
import { KillFeed } from '../components/KillFeed.js';
import { MomentumTimeline } from '../components/MomentumTimeline.js';
import { MAPS } from '../../config/maps.js';

/** mapId -> display name, derived once from the config pool. */
const MAP_NAME = Object.freeze(
  MAPS.reduce((acc, m) => {
    acc[m.id] = m.name;
    return acc;
  }, {})
);

/** Pretty map name (falls back to the raw id). */
function mapName(id) {
  return (id && MAP_NAME[id]) || id || '?';
}

/** Rounds played on a map (= score.A + score.B). */
function mapTotalOf(m) {
  const s = (m && m.score) || { A: 0, B: 0 };
  return (s.A || 0) + (s.B || 0);
}

/**
 * Derive the spectator reveal state from the series + ticker + spoiler setting.
 * Everything the screen gates on is computed here so the rendering stays a pure
 * function of state. In non-spoiler mode this collapses to "everything revealed".
 *
 * @param {object} series
 * @param {object} ticker  ui.ticker
 * @param {boolean} spoilerFree
 * @returns {object} { spoilerFree, maps, mapCount, lastMap, mapIndex, maxMap,
 *   mapResult, curTotal, cursor, revealing, mapRevealed, seriesRevealed, liveScore }
 */
function spectatorView(series, ticker, spoilerFree) {
  const maps = series.maps || [];
  const mapCount = maps.length;
  const lastMap = Math.max(mapCount - 1, 0);

  const rawIndex = typeof ticker.mapIndex === 'number' ? ticker.mapIndex : 0;
  // The furthest map reached while watching (spectator); free roam otherwise.
  const maxMap = spoilerFree
    ? Math.min(Math.max(typeof ticker.maxMap === 'number' ? ticker.maxMap : 0, 0), lastMap)
    : lastMap;
  const mapIndex = mapCount > 0
    ? Math.min(Math.max(rawIndex, 0), spoilerFree ? maxMap : lastMap)
    : 0;
  const mapResult = maps[mapIndex] || null;

  const rawRound = typeof ticker.roundIndex === 'number' ? ticker.roundIndex : 0;
  const curTotal = mapTotalOf(mapResult);

  // A displayed map is fully revealed when it sits below the high-water mark or
  // has been watched to its final round.
  const mapRevealed = !spoilerFree || mapIndex < maxMap || rawRound >= curTotal;
  // The series result unlocks once the last map has been watched out (the driver
  // also stamps ticker.revealed so it survives navigating between maps).
  const seriesRevealed =
    !spoilerFree ||
    !!ticker.revealed ||
    (maxMap >= lastMap && mapIndex >= lastMap && rawRound >= curTotal);

  // `revealing` = "hide rounds past the cursor + show a live partial score",
  // shared with the ticker / momentum / feeds. In non-spoiler mode it's just the
  // raw playback flag, preserving the legacy watch-through behaviour.
  const revealing = spoilerFree ? !mapRevealed : !!ticker.playing;
  const cursor = revealing
    ? Math.min(Math.max(rawRound, 0), curTotal)
    : spoilerFree
      ? curTotal
      : rawRound > 0
        ? Math.min(rawRound, curTotal)
        : curTotal;

  // Live series score: maps won among the maps revealed so far.
  let liveA = 0;
  let liveB = 0;
  if (seriesRevealed) {
    const s = series.score || { A: 0, B: 0 };
    liveA = s.A || 0;
    liveB = s.B || 0;
  } else {
    for (let i = 0; i <= maxMap && i < mapCount; i += 1) {
      const revealedI = i < maxMap || mapRevealed;
      if (!revealedI) continue;
      if (maps[i].winner === 'A') liveA += 1;
      else if (maps[i].winner === 'B') liveB += 1;
    }
  }

  return {
    spoilerFree, maps, mapCount, lastMap, mapIndex, maxMap, mapResult,
    curTotal, cursor, revealing, mapRevealed, seriesRevealed,
    liveScore: { A: liveA, B: liveB }
  };
}

/**
 * The Match screen.
 * @param {object} state  root store state
 * @param {(action:object)=>void} dispatch
 * @returns {import('../render.js').VNode}
 */
export function MatchScreen(state, dispatch) {
  const ticker = (state.ui && state.ui.ticker) || {};
  const params = (state.ui && state.ui.route && state.ui.route.params) || {};
  const seriesId = params.seriesId || ticker.seriesId || null;

  const series = seriesId ? selectSeries(state, seriesId) : null;
  if (!series) {
    return h(
      'section',
      { class: 'screen screen--match match match--empty' },
      h('p', { class: 'muted' }, 'No series selected.')
    );
  }

  const world = selectWorld(state);
  const teamsById = world.teams || {};
  const playersById = world.players || {};
  const teamA = selectTeam(state, series.teamAId);
  const teamB = selectTeam(state, series.teamBId);

  const spoilerFree = !!(state.ui && state.ui.spoilerFree);
  const v = spectatorView(series, ticker, spoilerFree);

  return h(
    'section',
    { class: classNames('screen screen--match match', spoilerFree && 'match--spoilerfree'), 'data-series': series.id },
    seriesHeader(series, teamA, teamB, v),
    VetoPanel({ veto: series.veto, teamA, teamB }),
    mapSwitcher({ maps: v.maps, mapIndex: v.mapIndex, maxMap: v.maxMap, spoilerFree, mapRevealed: v.mapRevealed, dispatch }),
    v.mapResult
      ? mapPane({ series, v, ticker, playersById, teamsById, dispatch })
      : h('div', { class: 'match__map match__map--empty muted' }, 'No maps played.')
  );
}

/* ----------------------------- header ----------------------------- */

/** The series header: both team names + the series (map) score. */
function seriesHeader(series, teamA, teamB, v) {
  const revealed = v.seriesRevealed;
  const score = revealed ? (series.score || { A: 0, B: 0 }) : v.liveScore;
  const nameA = (teamA && teamA.name) || series.teamAId;
  const nameB = (teamB && teamB.name) || series.teamBId;
  const wonA = revealed && series.winnerId === series.teamAId;
  const wonB = revealed && series.winnerId === series.teamBId;
  const bestOf = series.bestOf || (series.maps || []).length;

  return h(
    'header',
    { class: classNames('match__header', !revealed && 'match__header--live') },
    h(
      'div',
      { class: classNames('match__team match__team--a', wonA && 'match__team--won') },
      h('span', { class: 'match__teamname' }, nameA)
    ),
    h(
      'div',
      { class: 'match__score' },
      h('span', { class: 'match__score-a' }, String(score.A || 0)),
      h('span', { class: 'match__score-sep' }, '–'),
      h('span', { class: 'match__score-b' }, String(score.B || 0)),
      revealed
        ? h('span', { class: 'match__bestof' }, `Bo${bestOf}`)
        : h('span', { class: 'match__live' }, '● LIVE')
    ),
    h(
      'div',
      { class: classNames('match__team match__team--b', wonB && 'match__team--won') },
      h('span', { class: 'match__teamname' }, nameB)
    )
  );
}

/* ----------------------------- veto ------------------------------- */

/**
 * VetoPanel — the series' veto picks (CONTRACTS §9 veto.picks).
 * Each pick: { mapId, by:'A'|'B'|'decider' }.
 * @param {object} props { veto, teamA, teamB }
 * @returns {import('../render.js').VNode}
 */
export function VetoPanel(props) {
  const { veto, teamA, teamB } = props || {};
  const picks = (veto && veto.picks) || [];

  if (picks.length === 0) {
    return h(
      'div',
      { class: 'veto veto--empty muted' },
      'No veto recorded.'
    );
  }

  const byLabel = (by) => {
    if (by === 'A') return (teamA && teamA.tag) || (teamA && teamA.name) || 'A';
    if (by === 'B') return (teamB && teamB.tag) || (teamB && teamB.name) || 'B';
    return 'Decider';
  };

  return h(
    'div',
    { class: 'veto' },
    h('h3', { class: 'veto__title' }, 'Veto'),
    h(
      'ol',
      { class: 'veto__list' },
      picks.map((p, i) =>
        h(
          'li',
          {
            key: `veto-${i}-${p.mapId}`,
            class: classNames('veto__pick', `veto__pick--${p.by}`),
            'data-map': p.mapId
          },
          h('span', { class: 'veto__by' }, byLabel(p.by)),
          h('span', { class: 'veto__map' }, mapName(p.mapId))
        )
      )
    )
  );
}

/* -------------------------- map switcher -------------------------- */

/** Tabs: one per played map; selecting sets ui.ticker.mapIndex (resets cursor). */
function mapSwitcher(props) {
  const { maps, mapIndex, maxMap, spoilerFree, dispatch } = props;
  // In spectator mode only the maps reached so far get tabs (so the number of
  // maps — itself a result spoiler in a Bo3 — isn't given away early).
  const shown = spoilerFree ? maps.slice(0, maxMap + 1) : maps;

  return h(
    'div',
    { class: 'match__tabs', role: 'tablist' },
    shown.map((m, i) => {
      const active = i === mapIndex;
      const winner = m && m.winner;
      // A map's score shows once it's revealed: below the high-water mark always,
      // or the high-water map once watched out (re-derived in spectatorView).
      const scoreShown = !spoilerFree || i < maxMap || (i === maxMap && props.mapRevealed);
      const onClick = () => {
        if (!spoilerFree) {
          dispatch(tickerSet({ mapIndex: i, roundIndex: 0, playing: false }));
        } else if (i < maxMap) {
          // Review a finished earlier map in full.
          dispatch(tickerSet({ mapIndex: i, roundIndex: mapTotalOf(maps[i]), playing: false }));
        } else {
          // Re-watch the current (high-water) map from the top.
          dispatch(tickerSet({ mapIndex: i, roundIndex: 0, playing: true }));
        }
      };
      return h(
        'button',
        {
          key: `maptab-${i}`,
          type: 'button',
          role: 'tab',
          'aria-selected': active ? 'true' : 'false',
          'data-mapindex': i,
          class: classNames('match__tab', active && 'match__tab--active'),
          onClick
        },
        h('span', { class: 'match__tab-n' }, `Map ${i + 1}`),
        h('span', { class: 'match__tab-name' }, mapName(m && m.mapId)),
        m && m.score && scoreShown
          ? h(
              'span',
              { class: classNames('match__tab-score', winner === 'A' ? 'is-a' : winner === 'B' ? 'is-b' : null) },
              `${m.score.A}-${m.score.B}`
            )
          : spoilerFree
            ? h('span', { class: 'match__tab-score match__tab-score--hidden' }, '·')
            : null
      );
    })
  );
}

/* ----------------------------- map pane --------------------------- */

/** The selected map's playback controls + RoundTicker + BoxScore. */
function mapPane(props) {
  const { series, v, ticker, playersById, teamsById, dispatch } = props;
  const { mapResult, mapIndex, maxMap, lastMap, maps, curTotal, cursor, revealing, mapRevealed, seriesRevealed, spoilerFree } = v;

  const onSeek = (n) => {
    const patch = { roundIndex: n, playing: true };
    // Seeking the last map to its end in spectator mode unlocks the result.
    if (spoilerFree && mapIndex >= lastMap && n >= curTotal) {
      patch.playing = false;
      patch.revealed = true;
    }
    dispatch(tickerSet(patch));
  };

  const nextMap = () => dispatch(tickerSet({
    mapIndex: mapIndex + 1,
    maxMap: Math.max(maxMap, mapIndex + 1),
    roundIndex: 0,
    playing: true
  }));
  const revealResult = () => dispatch(tickerSet({
    mapIndex: lastMap,
    maxMap: lastMap,
    roundIndex: mapTotalOf(maps[lastMap]),
    playing: false,
    revealed: true
  }));

  const showNextMap = spoilerFree && mapRevealed && mapIndex === maxMap && maxMap < lastMap;
  const showReveal = spoilerFree && !seriesRevealed;

  return h(
    'div',
    { class: 'match__map', 'data-mapindex': mapIndex },
    playbackControls({ playing: !!ticker.playing, roundIndex: cursor, totalRounds: curTotal, speed: ticker.speed, spoilerFree, dispatch }),
    (showNextMap || showReveal)
      ? h(
          'div',
          { class: 'match__spectator-bar' },
          showNextMap
            ? h('button', { type: 'button', class: 'btn btn--primary match__nextmap', onClick: nextMap }, `Next map — Map ${mapIndex + 2} ▶`)
            : null,
          showReveal
            ? h('button', { type: 'button', class: 'btn btn--ghost match__reveal', onClick: revealResult }, '⏭ Reveal result')
            : null
        )
      : null,
    MomentumTimeline({ mapResult, index: cursor, playing: revealing }),
    RoundTicker({
      mapResult,
      index: cursor,
      playing: revealing,
      onSeek
    }),
    // The live "spectator" pair: a casted play-by-play feed beside the round's
    // kill feed — both driven by the same reveal cursor as the ticker.
    h(
      'div',
      { class: 'match__playbyplay' },
      CommentaryLog({ mapResult, playersById, teamsById, teamAId: series.teamAId, teamBId: series.teamBId, index: cursor, playing: revealing }),
      KillFeed({ mapResult, playersById, index: cursor, playing: revealing })
    ),
    mapRevealed
      ? BoxScore({
          mapResult,
          playersById,
          teamsById,
          teamAId: series.teamAId,
          teamBId: series.teamBId
        })
      : h('div', { class: 'match__boxhold muted' }, 'Box score reveals when the map ends.')
  );
}

/**
 * Play/pause + restart + a seek range + speed control, all bound to
 * `ui.ticker`. The actual round-by-round animation is driven by the playback
 * loop in `ui/app.js` (it advances `roundIndex` on a timer while `playing`).
 */
function playbackControls(props) {
  const { playing, roundIndex, totalRounds, speed, dispatch } = props;
  const curSpeed = speed && speed > 0 ? speed : 1;

  const togglePlay = () => {
    if (!playing) {
      // Resuming from the end restarts the watch-through from round 0.
      const startAt = roundIndex >= totalRounds ? 0 : roundIndex;
      dispatch(tickerSet({ playing: true, roundIndex: startAt }));
    } else {
      dispatch(tickerSet({ playing: false }));
    }
  };
  const restart = () => dispatch(tickerSet({ roundIndex: 0, playing: true }));
  const onInput = (ev) => {
    const v = ev && ev.target ? Number(ev.target.value) : roundIndex;
    dispatch(tickerSet({ roundIndex: v, playing: false }));
  };
  const speedBtn = (n) =>
    h(
      'button',
      {
        type: 'button',
        class: classNames('btn', 'btn--sm', curSpeed === n && 'btn--primary'),
        'aria-pressed': curSpeed === n ? 'true' : 'false',
        onClick: () => dispatch(tickerSet({ speed: n }))
      },
      `${n}×`
    );

  return h(
    'div',
    { class: 'match__playback' },
    h(
      'button',
      {
        type: 'button',
        class: classNames('match__play', playing && 'match__play--playing'),
        'aria-pressed': playing ? 'true' : 'false',
        onClick: togglePlay
      },
      playing ? '❚❚ Pause' : '► Play'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--sm btn--ghost',
        title: 'Restart',
        'aria-label': 'Restart playback',
        onClick: restart
      },
      '⟲'
    ),
    h('input', {
      type: 'range',
      class: 'match__seek',
      min: 0,
      max: totalRounds,
      step: 1,
      value: roundIndex,
      'aria-label': 'Seek round',
      onInput
    }),
    h('span', { class: 'match__round-label' }, `Round ${roundIndex} / ${totalRounds}`),
    h('div', { class: 'row' }, speedBtn(1), speedBtn(2), speedBtn(4))
  );
}
