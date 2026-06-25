/**
 * ui/screens/HomeInbox.js — the FM-style hub / inbox (CONTRACTS-PERSIST §6, id 'home').
 *
 * Pure `(state, dispatch, store) => VNode`. Reads game truth ONLY through
 * selectors; performs no data fetching. For the FULL 2026 season it shows:
 *   - season progress (slot X of 8 + a progress bar),
 *   - the NEXT event to play (the upcoming calendar slot),
 *   - a prominent Continue call-to-action (ContinueButton -> continueSeason(store)),
 *   - the followed team's PATH through the season so far (its placement in every
 *     event it has played, newest first),
 *   - a CHAMPION banner once the season is complete.
 *
 * The season is the source of truth (selectSeason / selectCalendar /
 * selectSlotsPlayed / selectChampion); team display joins via selectTeam.
 *
 * SIGNATURE / WIRING CONTRACT (the router/app author must honour this):
 *   HomeInbox(state, dispatch, store) => VNode
 *   - `state`    : the full store state (read via selectors)
 *   - `dispatch` : store.dispatch (for plain actions like navigate)
 *   - `store`    : the store reference, forwarded to engine-touching commands
 *                  (continueSeason / openEvent). The app author binds it via a
 *                  closure when constructing the RouterOutlet so screens stay free
 *                  of document/window. When `store` is omitted the Continue button
 *                  is inert (used by headless render-only tests).
 */

import { h, classNames } from '../render.js';
import { ContinueButton } from '../components/ContinueButton.js';
import { Icon } from '../components/Icon.js';
import { navigate } from '../../state/actions.js';
import { continueSeason, openEvent } from '../../state/commands.js';
import {
  selectFollowedTeam,
  selectSeason,
  selectCalendar,
  selectSlotsPlayed,
  selectChampion,
  selectTeam,
  selectCareerPhase,
  selectSeasonIndex,
  selectRecentNews
} from '../../state/selectors.js';

/** Fixed league order under a regional slot (mirrors REGION_ORDER). */
const REGION_ORDER = ['pacific', 'americas', 'emea', 'china'];

/** Display labels for slot ids + regions (UI sugar; no engine import). */
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
const REGION_LABELS = {
  pacific: 'Pacific',
  americas: 'Americas',
  emea: 'EMEA',
  china: 'China'
};

/**
 * @param {object} state
 * @param {(action:object)=>void} [dispatch]
 * @param {object} [store]
 * @returns {import('../render.js').VNode}
 */
export function HomeInbox(state, dispatch, store) {
  const season = selectSeason(state);
  const followed = selectFollowedTeam(state);
  const champion = selectChampion(state);
  const seasonIndex = selectSeasonIndex(state);
  // The career is endless; a finished season pauses in the 'offseason' phase
  // (champion crowned) until the next Continue resolves the break.
  const offseason = selectCareerPhase(state) === 'offseason';

  const go = (screen, params) =>
    dispatch ? dispatch(navigate(screen, params || {})) : undefined;

  return h(
    'section',
    { class: 'screen screen--home', id: 'screen-home' },
    h('h1', { class: 'screen__title' }, 'Home'),
    offseason ? championBanner(state, champion, seasonIndex) : null,
    h(
      'div',
      { class: 'home__grid' },
      progressCard(state, season, offseason, seasonIndex),
      continueCard(state, season, store, offseason, go),
      latestNewsCard(state, go),
      followedPathCard(state, season, followed, go, store),
      followedTeamCard(followed, go)
    )
  );
}

/* -------------------------------- news ---------------------------------- */

/** A compact "Latest News" card: the few most-recent headlines + a link to the inbox. */
function latestNewsCard(state, go) {
  const recent = selectRecentNews(state, 5);
  let body;
  if (recent.length === 0) {
    body = h('p', { class: 'card__muted' }, 'Headlines will appear here as you play.');
  } else {
    body = h(
      'ul',
      { class: 'home__news' },
      recent.map((it) =>
        h(
          'li',
          { key: it.id, class: classNames('home__news-item', `home__news-item--${it.tone}`) },
          h('span', { class: 'home__news-text' }, it.headline)
        )
      )
    );
  }
  return h(
    'div',
    { class: 'card home__news-card' },
    h('h2', { class: 'card__title' }, 'Latest News'),
    body,
    h(
      'button',
      { type: 'button', class: 'link home__news-link', onClick: () => go('news') },
      'Open inbox →'
    )
  );
}

/* ------------------------------- champion ------------------------------- */

/** A prominent banner crowning the World Champion (shown in the off-season). */
function championBanner(state, championId, seasonIndex) {
  const name = championId ? teamName(state, championId) : 'TBD';
  return h(
    'div',
    { class: 'home__champion-banner', id: 'home-champion-banner' },
    Icon('trophy', { size: 30, class: 'home__champion-trophy' }),
    h(
      'div',
      { class: 'home__champion-text' },
      h('span', { class: 'home__champion-label' }, `Season ${(seasonIndex || 0) + 1} World Champions`),
      h('span', { class: 'home__champion-name' }, name)
    )
  );
}

/* ------------------------------- progress ------------------------------- */

/** Season progress: slot X of 8 + a progress bar (with the season number). */
function progressCard(state, season, offseason, seasonIndex) {
  const calendar = selectCalendar(state);
  const total = calendar.length || 8;
  const played = selectSlotsPlayed(state);
  const pct = total > 0 ? Math.round((played / total) * 100) : 0;
  const label = offseason
    ? `Season ${(seasonIndex || 0) + 1} complete (${total}/${total})`
    : `Season ${(seasonIndex || 0) + 1} · Slot ${Math.min(played + 1, total)} of ${total}`;

  return h(
    'div',
    { class: 'card home__progress' },
    h('h2', { class: 'card__title' }, 'Season Progress'),
    h('p', { class: 'home__progress-label' }, label),
    h(
      'div',
      { class: 'home__progress-bar', role: 'progressbar', 'aria-valuenow': pct },
      h('div', {
        class: 'home__progress-fill',
        style: { width: `${pct}%` }
      })
    ),
    h('p', { class: 'card__muted' }, `${played} of ${total} slots played`)
  );
}

/* ----------------------------- continue / next -------------------------- */

/** Prominent Continue CTA + the next event to play (or the off-season prompt). */
function continueCard(state, season, store, offseason, go) {
  const calendar = selectCalendar(state);
  const played = selectSlotsPlayed(state);
  const nextSlot = offseason ? null : calendar[played] || null;
  const nextLabel = nextSlot
    ? SLOT_LABELS[nextSlot.id] || nextSlot.id
    : null;

  return h(
    'div',
    { class: 'card home__continue' },
    h('h2', { class: 'card__title' }, offseason ? 'Off-season' : 'Up Next'),
    h(
      'p',
      { class: 'home__next' },
      offseason
        ? 'The season is decided. Continue to run the off-season — aging, retirements, newgens and transfers — then kick off the next season.'
        : nextSlot
          ? h(
              'span',
              null,
              'Next: ',
              h('strong', { class: 'home__next-name' }, nextLabel),
              nextSlot.scope === 'regional'
                ? ' (4 regional events)'
                : ' (international)'
            )
          : 'No season in progress.'
    ),
    // The career never ends, so Continue is always live — it advances a slot, or
    // (in the off-season) rolls into the next season.
    ContinueButton({
      complete: false,
      onContinue: store ? () => continueSeason(store) : null
    }),
    offseason
      ? h(
          'button',
          {
            type: 'button',
            class: 'link home__champions-link',
            onClick: () => go('champions')
          },
          'View Champions →'
        )
      : null
  );
}

/* --------------------------- followed-team path ------------------------- */

/**
 * The followed team's path through the season so far: its placement in every
 * event it has appeared in, newest first. Empty-state when nothing played yet.
 */
function followedPathCard(state, season, followed, go, store) {
  const teamId = followed ? followed.id : null;
  const entries = teamId ? teamPath(season, teamId) : [];

  let body;
  if (!teamId) {
    body = h('p', { class: 'card__muted' }, 'No team followed yet.');
  } else if (entries.length === 0) {
    body = h(
      'p',
      { class: 'card__muted' },
      'Hit Continue to start the season — your run will appear here.'
    );
  } else {
    body = h(
      'ul',
      { class: 'home__path' },
      entries.map((e) =>
        h(
          'li',
          { class: 'home__path-item', key: e.eventId },
          h(
            'button',
            {
              type: 'button',
              class: 'home__path-link',
              onClick: () =>
                store
                  ? openEvent(store, e.slotId, e.region || undefined)
                  : go('standings', { slotId: e.slotId, region: e.region || null, eventId: e.eventId })
            },
            h(
              'span',
              {
                class: classNames(
                  'badge',
                  'home__path-rank',
                  e.rank === 1 && 'badge--win'
                )
              },
              e.rank === 1
                ? [Icon('trophy', { size: 12, class: 'home__path-trophy' }), ' 1st']
                : ordinal(e.rank)
            ),
            h('span', { class: 'home__path-event' }, e.label)
          )
        )
      )
    );
  }

  return h(
    'div',
    { class: 'card home__path-card' },
    h(
      'h2',
      { class: 'card__title' },
      followed ? `${followed.name || followed.id} — Season Path` : 'Your Season Path'
    ),
    body
  );
}

/**
 * Build the followed team's per-event path from the season events (newest
 * first). Each item: { eventId, slotId, region, label, rank }.
 */
function teamPath(season, teamId) {
  if (!season || !Array.isArray(season.events)) return [];
  const out = [];
  for (const entry of season.events) {
    const result = entry.result;
    if (!result || !Array.isArray(result.placements)) continue;
    const placement = result.placements.find((p) => p.teamId === teamId);
    if (!placement) continue;
    const slotName = SLOT_LABELS[entry.slotId] || entry.slotId;
    const label = entry.region
      ? `${slotName} · ${REGION_LABELS[entry.region] || entry.region}`
      : slotName;
    out.push({
      eventId: (result && result.eventId) || entry.slotId,
      slotId: entry.slotId,
      region: entry.region || null,
      label,
      rank: placement.rank
    });
  }
  return out.reverse();
}

/* ------------------------------ followed team --------------------------- */

/** Followed-team summary card (clicks through to the team screen). */
function followedTeamCard(team, go) {
  if (!team) {
    return h(
      'div',
      { class: 'card home__followed home__followed--empty' },
      h('h2', { class: 'card__title' }, 'Your Team'),
      h('p', { class: 'card__muted' }, 'No team followed yet.')
    );
  }
  const name = team.name != null ? team.name : team.id;
  const tag = team.tag || (name ? String(name).slice(0, 3).toUpperCase() : '');
  return h(
    'div',
    { class: 'card home__followed' },
    h('h2', { class: 'card__title' }, 'Your Team'),
    h(
      'button',
      {
        type: 'button',
        class: 'home__followed-link',
        onClick: () => go('team', { teamId: team.id }),
        'aria-label': `Open ${name}`
      },
      h('span', { class: 'badge badge--team home__followed-tag' }, tag),
      h('span', { class: 'home__followed-name' }, name)
    ),
    h(
      'p',
      { class: 'card__muted' },
      team.region ? capitalize(team.region) + ' League' : 'VCT 2026'
    )
  );
}

/* -------------------------------- helpers ------------------------------- */

/** Display name for a team id (falls back to the id). */
function teamName(state, teamId) {
  const team = selectTeam(state, teamId);
  return (team && team.name) || teamId;
}

/** Capitalize the first letter of a string. */
function capitalize(s) {
  return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s;
}

/** English ordinal suffix for small ranks. */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
