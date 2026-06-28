/**
 * ui/screens/WorldHub.js — the "God View" home: a world-at-a-glance hub for the
 * hands-off spectator sim (route id 'home').
 *
 * This is the WorldBox-style god's-eye dashboard: you don't manage a team, you
 * watch a self-running VCT world. The hero is a TIME MACHINE — step the sim a
 * match-day at a time, fast-forward a whole event, or hit play and let it run —
 * and the panels below update live as the world turns: the global power ranking,
 * each region's kingpin, the players to watch, the latest happenings, recently
 * decided events, and what's live right now.
 *
 * Pure `(state, dispatch, store) => VNode`. Reads game truth ONLY through the
 * dashboard derivations (ui/homeDashboard.js), which themselves read through
 * selectors — the screen never touches the raw state shape. Time controls call
 * the engine-touching commands via `store` (forwarded by the router); with no
 * store (headless render-only tests) the controls render inert and nothing
 * throws. Everything is clickable to stare deeper: team → team view, player →
 * player view.
 */

import { h, classNames } from '../render.js';
import { Icon } from '../components/Icon.js';
import { navigate, setAutoplay } from '../../state/actions.js';
import { continueSeason, setAutoplayPace } from '../../state/commands.js';
import {
  seasonPulse,
  followedLens,
  powerRanking,
  regionLeaders,
  peopleToWatch,
  latestHappenings,
  recentResults,
  nowAndNext
} from '../homeDashboard.js';

/** Autoplay speed chips (id + label), slowest → fastest. */
const SPEEDS = [
  { id: 'slow', label: 'Slow' },
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Fast' }
];

/**
 * The God View home screen.
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @param {object} [store]
 * @returns {import('../render.js').VNode}
 */
export function WorldHub(state, dispatch, store) {
  const pulse = seasonPulse(state);
  const lens = followedLens(state);
  const go = (screen, params) =>
    dispatch ? dispatch(navigate(screen, params || {})) : undefined;
  const goTeam = (teamId) => (teamId ? go('team', { teamId }) : undefined);
  const goPlayer = (playerId, teamId) =>
    playerId ? go('player', { playerId, teamId: teamId || undefined }) : undefined;

  return h(
    'section',
    { class: 'screen screen--worldhub', id: 'screen-home', 'data-screen': 'home' },
    h('h1', { class: 'screen__title worldhub__title' }, 'God View'),
    h(
      'p',
      { class: 'screen__subtitle' },
      'The VCT world runs itself. Step time forward and watch it unfold — stare into any team or player to go deeper.'
    ),
    heroCard(state, pulse, lens, store, dispatch, goTeam),
    h(
      'div',
      { class: 'worldhub__grid' },
      powerRankingPanel(state, goTeam),
      regionLeadersPanel(state, goTeam),
      peopleToWatchPanel(state, goPlayer),
      nowNextPanel(state, pulse, goTeam, go),
      recentResultsPanel(state, goTeam),
      happeningsPanel(state, go)
    )
  );
}

/* ----------------------------- hero / time machine ---------------------- */

/** The hero: season pulse + progress + the time controls (step / sim / play). */
function heroCard(state, pulse, lens, store, dispatch, goTeam) {
  const autoplay = !!(state.ui && state.ui.autoplay);
  const speed = (state.ui && state.ui.autoplaySpeed) || 'normal';

  // Step semantics depend on where we are: advance a watched day, run the
  // off-season, or kick off the next event. Always keeps the viewer on the hub
  // (noNav) so the dashboard updates in place — the whole point of god view.
  const stepLabel = pulse.offseason
    ? 'Run Off-season'
    : pulse.midReveal
      ? 'Advance Day'
      : 'Step Forward';
  const onStep = store ? () => continueSeason(store, { noNav: true }) : null;
  const onSim = store ? () => continueSeason(store, { simEvent: true, noNav: true }) : null;
  const onPlay = dispatch ? () => dispatch(setAutoplay(!autoplay)) : null;
  const onSpeed = store ? (s) => setAutoplayPace(store, s) : null;

  const statusBits = [];
  if (pulse.midReveal && pulse.revealTotal > 0) {
    statusBits.push(`Day ${pulse.revealDay} / ${pulse.revealTotal}`);
  }
  if (pulse.currentScope) {
    statusBits.push(pulse.currentScope === 'international' ? 'International' : 'Regional');
  }

  return h(
    'div',
    { class: 'card worldhub__hero' },
    h(
      'div',
      { class: 'worldhub__pulse' },
      h('span', { class: 'worldhub__season' }, `Season ${pulse.seasonNumber}`),
      h('span', { class: 'worldhub__phase' }, pulse.currentLabel),
      statusBits.length
        ? h('span', { class: 'worldhub__phase-meta' }, statusBits.join(' · '))
        : null,
      lensChip(lens, goTeam)
    ),
    pulse.offseason && pulse.championName
      ? h(
          'div',
          { class: 'worldhub__champion', id: 'worldhub-champion' },
          Icon('trophy', { size: 22, class: 'worldhub__champion-icon' }),
          h(
            'span',
            { class: 'worldhub__champion-text' },
            h('span', { class: 'worldhub__champion-label' }, `Season ${pulse.seasonNumber} World Champions`),
            h('span', { class: 'worldhub__champion-name' }, pulse.championName)
          )
        )
      : null,
    progressBar(pulse),
    h(
      'div',
      { class: 'worldhub__controls' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary worldhub__step',
          disabled: onStep ? undefined : true,
          onClick: onStep || undefined
        },
        Icon('play', { size: 16 }),
        h('span', null, stepLabel)
      ),
      !pulse.offseason
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn worldhub__sim',
              disabled: onSim ? undefined : true,
              onClick: onSim || undefined,
              title: 'Fast-forward the whole event'
            },
            Icon('skip', { size: 16 }),
            h('span', null, 'Sim Event')
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class: classNames('btn', 'worldhub__play', autoplay && 'worldhub__play--on'),
          'aria-pressed': autoplay ? 'true' : 'false',
          disabled: onPlay ? undefined : true,
          onClick: onPlay || undefined
        },
        Icon(autoplay ? 'pause' : 'play', { size: 16 }),
        h('span', null, autoplay ? 'Pause' : 'Auto-Play')
      ),
      h(
        'div',
        { class: 'worldhub__speeds', role: 'group', 'aria-label': 'Auto-play speed' },
        SPEEDS.map((s) =>
          h(
            'button',
            {
              key: s.id,
              type: 'button',
              class: classNames('worldhub__speed', s.id === speed && 'worldhub__speed--active'),
              'aria-pressed': s.id === speed ? 'true' : 'false',
              disabled: onSpeed ? undefined : true,
              onClick: onSpeed ? () => onSpeed(s.id) : undefined
            },
            s.label
          )
        )
      )
    )
  );
}

/** Season progress bar (slots played of total). */
function progressBar(pulse) {
  const label = pulse.offseason
    ? `Season complete — ${pulse.total}/${pulse.total} slots`
    : pulse.total > 0
      ? `${pulse.played} of ${pulse.total} slots played`
      : 'Season not started';
  return h(
    'div',
    { class: 'worldhub__progress' },
    h(
      'div',
      { class: 'worldhub__progress-bar', role: 'progressbar', 'aria-valuenow': pulse.pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('div', { class: 'worldhub__progress-fill', style: { width: `${pulse.pct}%` } })
    ),
    h('span', { class: 'worldhub__progress-label' }, label)
  );
}

/**
 * The "following" lens chip: the team the spectator is currently watching (their
 * window into the world), clickable to its team view. When no team is followed it
 * reads "Spectating" — the pure god-observer mode.
 */
function lensChip(lens, goTeam) {
  if (!lens) {
    return h('span', { class: 'worldhub__lens worldhub__lens--none' }, 'Spectating');
  }
  return h(
    'button',
    {
      type: 'button',
      class: 'worldhub__lens',
      onClick: () => goTeam(lens.id),
      'aria-label': `Open followed team ${lens.name}`
    },
    Icon('eye', { size: 13, class: 'worldhub__lens-icon' }),
    h('span', { class: 'worldhub__lens-label' }, 'Watching'),
    h('span', { class: 'worldhub__lens-name' }, lens.name),
    lens.rank ? h('span', { class: 'worldhub__lens-rank' }, `#${lens.rank}`) : null
  );
}

/* ------------------------------- panels --------------------------------- */

/** A titled dashboard panel (card) with an icon header + an optional footer link. */
function panel(title, iconName, body, footer) {
  return h(
    'div',
    { class: 'card worldhub__panel' },
    h(
      'h2',
      { class: 'card__title worldhub__panel-title' },
      Icon(iconName, { size: 16, class: 'worldhub__panel-icon' }),
      h('span', null, title)
    ),
    body,
    footer || null
  );
}

/** Empty-state paragraph. */
function empty(text) {
  return h('p', { class: 'card__muted worldhub__empty' }, text);
}

/** Footer link button (navigates somewhere to stare deeper). */
function moreLink(label, onClick) {
  return h(
    'button',
    { type: 'button', class: 'link worldhub__more', onClick: onClick || undefined },
    label
  );
}

/** Global team power ranking — the strongest teams in the world. */
function powerRankingPanel(state, goTeam) {
  const rows = powerRanking(state, 8);
  const body = rows.length
    ? h(
        'ol',
        { class: 'worldhub__rank' },
        rows.map((r) =>
          h(
            'li',
            { key: r.teamId, class: classNames('worldhub__rank-item', r.followed && 'worldhub__rank-item--me') },
            h('span', { class: 'worldhub__rank-pos' }, `${r.rank}`),
            h(
              'button',
              {
                type: 'button',
                class: 'worldhub__team',
                onClick: () => goTeam(r.teamId),
                'aria-label': `Open ${r.name}`
              },
              h('span', { class: 'badge badge--team worldhub__team-tag' }, r.tag),
              h('span', { class: 'worldhub__team-name' }, r.name)
            ),
            r.regionLabel ? h('span', { class: 'worldhub__rank-region' }, r.regionLabel) : null,
            h('span', { class: 'worldhub__rank-rating' }, `${r.rating}`)
          )
        )
      )
    : empty('The world is still loading.');
  return panel('Power Ranking', 'globe', body, rows.length ? moreLink('Full world ranking →', null) : null);
}

/** Regional kingpins — the #1 team in each league. */
function regionLeadersPanel(state, goTeam) {
  const rows = regionLeaders(state);
  const body = rows.length
    ? h(
        'ul',
        { class: 'worldhub__regions' },
        rows.map((r) =>
          h(
            'li',
            { key: r.region, class: 'worldhub__region' },
            h('span', { class: 'worldhub__region-name' }, r.regionLabel),
            h(
              'button',
              {
                type: 'button',
                class: 'worldhub__team',
                onClick: () => goTeam(r.teamId),
                'aria-label': `Open ${r.name}`
              },
              h('span', { class: 'badge badge--team worldhub__team-tag' }, r.tag),
              h('span', { class: 'worldhub__team-name' }, r.name)
            ),
            h('span', { class: 'worldhub__region-record' }, `${r.w}-${r.l}`)
          )
        )
      )
    : empty('No regional leaders yet.');
  return panel('Region Leaders', 'standings', body);
}

/** People to watch — hot performers + rising prospects. */
function peopleToWatchPanel(state, goPlayer) {
  const people = peopleToWatch(state, 6);
  const body = people.length
    ? h(
        'ul',
        { class: 'worldhub__people' },
        people.map((p) =>
          h(
            'li',
            { key: p.playerId, class: 'worldhub__person' },
            h(
              'button',
              {
                type: 'button',
                class: 'worldhub__person-link',
                onClick: () => goPlayer(p.playerId, p.teamId),
                'aria-label': `Open ${p.handle}`
              },
              h(
                'span',
                { class: 'worldhub__person-main' },
                h('span', { class: 'worldhub__person-name' }, p.handle),
                p.role ? h('span', { class: 'worldhub__person-role' }, p.role) : null
              ),
              h(
                'span',
                { class: 'worldhub__person-meta' },
                p.teamTag ? h('span', { class: 'worldhub__person-team' }, p.teamTag) : null,
                h('span', { class: 'worldhub__person-note' }, p.note)
              )
            )
          )
        )
      )
    : empty('No players to watch yet.');
  return panel('People to Watch', 'star', body);
}

/** What's live right now (the watched match-day) + what's up next. */
function nowNextPanel(state, pulse, goTeam, go) {
  const nn = nowAndNext(state);
  let body;
  if (nn.fixtures.length) {
    body = h(
      'ul',
      { class: 'worldhub__fixtures' },
      nn.fixtures.slice(0, 6).map((f, i) =>
        h(
          'li',
          { key: f.seriesId || `fx-${i}`, class: classNames('worldhub__fixture', f.done && 'worldhub__fixture--done') },
          fixtureSide(f.aId, f.aTag, f.winnerId === f.aId && f.done, goTeam),
          h(
            'span',
            { class: 'worldhub__fixture-score' },
            f.aScore != null && f.bScore != null ? `${f.aScore}–${f.bScore}` : 'vs'
          ),
          fixtureSide(f.bId, f.bTag, f.winnerId === f.bId && f.done, goTeam)
        )
      )
    );
  } else if (nn.nextLabel) {
    body = h(
      'p',
      { class: 'worldhub__next' },
      'Up next: ',
      h('strong', { class: 'worldhub__next-name' }, nn.nextLabel),
      '. Step forward to play it out.'
    );
  } else if (pulse.offseason) {
    body = empty('The season is decided — run the off-season to begin the next.');
  } else {
    body = empty('Nothing scheduled — step forward to begin.');
  }
  const title = nn.dayLabel ? `On Now — ${nn.dayLabel}` : 'Now & Next';
  return panel(title, 'play', body, h('button', {
    type: 'button', class: 'link worldhub__more', onClick: () => go('calendar')
  }, 'Open calendar →'));
}

/** One side of a fixture row (team tag, clickable, winner-highlighted). */
function fixtureSide(teamId, tag, isWinner, goTeam) {
  return h(
    'button',
    {
      type: 'button',
      class: classNames('worldhub__fixture-side', isWinner && 'worldhub__fixture-side--win'),
      onClick: teamId ? () => goTeam(teamId) : undefined,
      disabled: teamId ? undefined : true,
      'aria-label': teamId ? `Open ${tag}` : undefined
    },
    h('span', { class: 'badge badge--team worldhub__team-tag' }, tag || '—')
  );
}

/** Recently decided events — champion + runner-up. */
function recentResultsPanel(state, goTeam) {
  const results = recentResults(state, 5);
  const body = results.length
    ? h(
        'ul',
        { class: 'worldhub__results' },
        results.map((r) =>
          h(
            'li',
            { key: r.eventId, class: 'worldhub__result' },
            h('span', { class: 'worldhub__result-event' }, r.label),
            h(
              'span',
              { class: 'worldhub__result-winner' },
              Icon('trophy', { size: 13, class: 'worldhub__result-trophy' }),
              h(
                'button',
                { type: 'button', class: 'worldhub__team', onClick: () => goTeam(r.winnerId), 'aria-label': `Open ${r.winnerName}` },
                h('span', { class: 'badge badge--team worldhub__team-tag' }, r.winnerTag),
                h('span', { class: 'worldhub__team-name' }, r.winnerName)
              ),
              r.runnerUpName ? h('span', { class: 'worldhub__result-runner' }, `def. ${r.runnerUpName}`) : null
            )
          )
        )
      )
    : empty('No events decided yet — step forward to make history.');
  return panel('Recent Results', 'trophy', body);
}

/** Latest happenings feed — recent headlines + transfer milestones. */
function happeningsPanel(state, go) {
  const items = latestHappenings(state, 8);
  const body = items.length
    ? h(
        'ul',
        { class: 'worldhub__feed' },
        items.map((it) =>
          h(
            'li',
            { key: it.id, class: classNames('worldhub__feed-item', `worldhub__feed-item--${it.tone}`) },
            h('span', { class: 'worldhub__feed-text' }, it.headline)
          )
        )
      )
    : empty('The world is quiet — step time forward to make news.');
  return panel('Latest Happenings', 'inbox', body, items.length
    ? h('button', { type: 'button', class: 'link worldhub__more', onClick: () => go('news') }, 'Open inbox →')
    : null);
}
