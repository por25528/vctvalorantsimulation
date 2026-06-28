/**
 * engine/career/storylines.js — the Storyteller: a PURE narrative engine that
 * mines the frozen per-season history ledger (`state.career.history[]`) for the
 * dramatic, cross-season arcs the raw news feed can't see on its own.
 *
 * Where `news.js` reports single moments as they happen (a result, an award, a
 * signing), this module reads the WHOLE timeline and recognises STORIES:
 *   - dynasties        — a club hoarding titles / going back-to-back
 *   - rivalries        — two clubs forever deciding the title between them
 *   - breakout arcs    — Rookie of the Year → league MVP, a prospect's rise
 *   - all-time greats  — repeat MVPs / serial winners (milestones)
 *   - upsets           — a low-seeded side shocking the field to lift the trophy
 *   - comebacks        — worst-to-first redemption runs
 *   - declines         — fallen giants who've slipped out of contention
 *   - crownings        — the backbone champion-of-the-year line per season
 *   - retirement tributes — careers of the recently retired, weighed by silverware
 *
 * DETERMINISM IS SACRED. This reads the frozen history (and an optional
 * off-season report) only — never the match/season engines — so match results
 * stay byte-identical. Headline VARIETY is drawn from a dedicated `hashSeed`
 * namespace ('storyline', …) so it can NEVER perturb a match/season rng stream.
 * No `Math.random`, no `Date`, no DOM; same history → identical stories.
 *
 * Each detector is guarded for empty / early-career worlds (returns [] cleanly),
 * so the very first frame of a fresh career renders without a single NaN.
 *
 * @typedef {Object} Story
 * @property {string} id           stable, unique key (category + anchors)
 * @property {string} category     'crown'|'dynasty'|'rivalry'|'breakout'|'milestone'|'upset'|'comeback'|'decline'|'retirement'
 * @property {number} seasonIndex  the era anchor (0-based; the season the story is "about")
 * @property {string} era          display era tag, e.g. "S3" or "S2–S4"
 * @property {string} headline     the dramatic one-liner
 * @property {string} blurb        a sentence of context (who/when/why it matters)
 * @property {string} tone         'headline'|'good'|'bad'|'neutral'
 * @property {string|null} teamId  primary subject team (click-through), or null
 * @property {string[]} teamIds    every team involved
 * @property {string|null} playerId primary subject player (click-through), or null
 * @property {number} weight       drama score, for ranking/selection
 */

import { hashSeed } from '../../core/hash.js';

/* --------------------------- name resolution ---------------------------- */

/**
 * Build name/tag resolvers tolerant of BOTH world shapes: the engine career
 * world ({ teamsById, playersById }) and the UI state world ({ teams, players }).
 */
function resolvers(world) {
  const teams = (world && (world.teamsById || world.teams)) || {};
  const players = (world && (world.playersById || world.players)) || {};
  const teamName = (id) => (teams[id] && teams[id].name) || id || 'A team';
  const teamTag = (id) => {
    const t = teams[id];
    if (t && t.tag) return t.tag;
    const n = (t && t.name) || id || '';
    return n ? String(n).slice(0, 3).toUpperCase() : '';
  };
  const playerName = (id) => {
    const p = players[id];
    return (p && (p.handle || p.name)) || id || 'A player';
  };
  return { teams, players, teamName, teamTag, playerName };
}

/** Pick one of `options` deterministically from a stable key (no rng streams). */
function pick(options, ...keyParts) {
  if (!options.length) return '';
  const i = hashSeed('storyline', ...keyParts.map((p) => (p == null ? '' : p))) % options.length;
  return options[i];
}

/** English ordinal for small counts. */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** A spelt count for small repeat-runs ("two", "three", …); falls back to digits. */
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function countWord(n) {
  return COUNT_WORDS[n] || String(n);
}

/** "peat" word for a consecutive run of length n (2 → back-to-back, 3 → three-peat). */
function peatWord(n) {
  if (n === 2) return 'back-to-back';
  if (n === 3) return 'three-peat';
  if (n === 4) return 'four-peat';
  if (n === 5) return 'five-peat';
  return `${countWord(n)} straight`;
}

/** Era label for a single season or a span. */
function eraLabel(fromIdx, toIdx) {
  const a = `S${(fromIdx || 0) + 1}`;
  if (toIdx == null || toIdx === fromIdx) return a;
  return `${a}–S${(toIdx || 0) + 1}`;
}

/** Unordered pair key (stable). */
function pairKey(a, b) {
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

/** Safe finite number. */
function num(v, d) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/** Build a frozen Story (fills the array/optional fields). */
function story(category, seasonIndex, headline, extra = {}) {
  const teamIds = (extra.teamIds || (extra.teamId ? [extra.teamId] : [])).filter(Boolean);
  return Object.freeze({
    id: extra.id || `${category}-${seasonIndex}-${(extra.teamId || extra.playerId || teamIds[0] || 'x')}`,
    category,
    seasonIndex,
    era: extra.era || eraLabel(seasonIndex),
    headline,
    blurb: extra.blurb || '',
    tone: extra.tone || 'neutral',
    teamId: extra.teamId || null,
    teamIds: Object.freeze(teamIds),
    playerId: extra.playerId || null,
    weight: num(extra.weight, 1)
  });
}

/* ------------------------- timeline index helpers ----------------------- */

/** The runner-up proxy of a season (CP-second / champion-aware final standings). */
function runnerUpOf(summary) {
  const fs = summary && summary.finalStandings;
  if (!Array.isArray(fs) || fs.length < 2) return null;
  return fs[1] || null;
}

/** A team's 0-based finishing position in a season (index in finalStandings), or null. */
function standingOf(summary, teamId) {
  const fs = summary && summary.finalStandings;
  if (!Array.isArray(fs)) return null;
  const i = fs.indexOf(teamId);
  return i < 0 ? null : i;
}

/** The champion's seed (index in championsField; 0 = top seed), or null. */
function championSeed(summary) {
  const field = summary && summary.championsField;
  if (!Array.isArray(field) || !field.length || !summary.champion) return null;
  const i = field.indexOf(summary.champion);
  return i < 0 ? null : i;
}

/** Collect every award-winning appearance of each player across history. */
function playerAwardTimeline(history) {
  /** @type {Map<string,{handle:string, role:string|null, firsts:number[], mvps:number[], finalsMvps:number[], rookies:number[], allpros:number[]}>} */
  const m = new Map();
  const touch = (w) => {
    if (!w || !w.playerId) return null;
    let e = m.get(w.playerId);
    if (!e) {
      e = { handle: w.handle || w.playerId, role: w.role || null, firsts: [], mvps: [], finalsMvps: [], rookies: [], allpros: [] };
      m.set(w.playerId, e);
    }
    if (w.handle) e.handle = w.handle;
    return e;
  };
  for (const s of history) {
    const a = s.awards;
    if (!a) continue;
    const i = s.seasonIndex;
    let e;
    if ((e = touch(a.mvp))) e.mvps.push(i);
    if ((e = touch(a.finalsMvp))) e.finalsMvps.push(i);
    if ((e = touch(a.rookieOfYear))) e.rookies.push(i);
    for (const w of a.allProFirst || []) if ((e = touch(w))) e.firsts.push(i);
    for (const w of a.allProSecond || []) if ((e = touch(w))) e.allpros.push(i);
  }
  return m;
}

/* ------------------------------- detectors ------------------------------ */

/** Per-season champion crowning — the narrative backbone (one line per title). */
function crownStories(history, R) {
  const out = [];
  for (const s of history) {
    if (!s.champion) continue;
    const name = R.teamName(s.champion);
    const ru = runnerUpOf(s);
    const headline = pick(
      [
        `${name} are crowned Season ${s.seasonIndex + 1} World Champions`,
        `${name} lift the Season ${s.seasonIndex + 1} trophy`,
        `Season ${s.seasonIndex + 1} belongs to ${name}`
      ],
      'crown', s.seasonIndex, s.champion
    );
    out.push(story('crown', s.seasonIndex, headline, {
      teamId: s.champion,
      teamIds: ru ? [s.champion, ru] : [s.champion],
      tone: 'headline',
      weight: 5,
      blurb: ru ? `${name} got the better of ${R.teamName(ru)} to rule the world.` : `${name} stood atop the VCT world.`
    }));
  }
  return out;
}

/** Dynasties — clubs hoarding titles, with extra drama for consecutive runs. */
function dynastyStories(history, R) {
  const out = [];
  /** @type {Map<string, number[]>} seasonIndices a team won, in order */
  const titles = new Map();
  for (const s of history) {
    if (!s.champion) continue;
    if (!titles.has(s.champion)) titles.set(s.champion, []);
    titles.get(s.champion).push(s.seasonIndex);
  }
  for (const [teamId, seasons] of titles) {
    if (seasons.length < 2) continue;
    // Longest consecutive streak.
    let best = 1, run = 1, bestEnd = seasons[0];
    for (let i = 1; i < seasons.length; i++) {
      run = seasons[i] === seasons[i - 1] + 1 ? run + 1 : 1;
      if (run > best) { best = run; bestEnd = seasons[i]; }
    }
    const name = R.teamName(teamId);
    const total = seasons.length;
    const span = seasons[seasons.length - 1] - seasons[0] + 1;
    const anchor = seasons[seasons.length - 1];
    let headline;
    if (best >= 2) {
      headline = pick(
        [
          `Dynasty: ${name} go ${peatWord(best)} as champions`,
          `${name} make it ${peatWord(best)} titles — a dynasty for the ages`,
          `${name} won't let go — ${peatWord(best)} world crowns`
        ],
        'dynasty-run', bestEnd, teamId
      );
    } else {
      headline = pick(
        [
          `${name} cement a dynasty — ${countWord(total)} titles in ${span} seasons`,
          `${name} rule an era with ${countWord(total)} world championships`,
          `${countWord(total)}-time champions: ${name} are the team of their generation`
        ],
        'dynasty', anchor, teamId
      );
    }
    out.push(story('dynasty', anchor, headline, {
      id: `dynasty-${teamId}-${anchor}`,
      teamId,
      tone: 'headline',
      era: eraLabel(seasons[0], anchor),
      weight: 9 + total + (best >= 2 ? best : 0),
      blurb: `${name} have ${countWord(total)} world titles (${seasons.map((i) => `S${i + 1}`).join(', ')}).`
    }));
  }
  return out;
}

/** Rivalries — two clubs that keep deciding the title between them. */
function rivalryStories(history, R) {
  const out = [];
  /** @type {Map<string,{count:number, a:string, b:string, seasons:number[]}>} */
  const pairs = new Map();
  for (const s of history) {
    if (!s.champion) continue;
    const ru = runnerUpOf(s);
    if (!ru || ru === s.champion) continue;
    const k = pairKey(s.champion, ru);
    let e = pairs.get(k);
    if (!e) { e = { count: 0, a: s.champion, b: ru, seasons: [] }; pairs.set(k, e); }
    e.count += 1;
    e.seasons.push(s.seasonIndex);
  }
  for (const e of pairs.values()) {
    if (e.count < 2) continue;
    const an = R.teamName(e.a);
    const bn = R.teamName(e.b);
    const anchor = e.seasons[e.seasons.length - 1];
    const headline = pick(
      [
        `Rivalry renewed: ${an} and ${bn} clash for the title again`,
        `${an} vs ${bn} — the rivalry that defines the era`,
        `${an} and ${bn} keep meeting with everything on the line`
      ],
      'rivalry', anchor, pairKey(e.a, e.b)
    );
    out.push(story('rivalry', anchor, headline, {
      id: `rivalry-${pairKey(e.a, e.b)}`,
      teamId: e.a,
      teamIds: [e.a, e.b],
      tone: 'headline',
      era: eraLabel(e.seasons[0], anchor),
      weight: 8 + e.count * 2,
      blurb: `They've split the sport's biggest stage ${countWord(e.count)} times (${e.seasons.map((i) => `S${i + 1}`).join(', ')}).`
    }));
  }
  return out;
}

/** Breakout arcs (Rookie → MVP/All-Pro) and all-time-great milestones. */
function playerStories(history) {
  const out = [];
  const tl = playerAwardTimeline(history);
  for (const [playerId, e] of tl) {
    const firstRookie = e.rookies.length ? Math.min(...e.rookies) : null;
    const peakSeasons = [...e.mvps, ...e.finalsMvps, ...e.firsts];
    const peak = peakSeasons.length ? Math.max(...peakSeasons) : null;

    // Breakout arc: a Rookie of the Year who later reached the top table.
    if (firstRookie != null && peak != null && peak > firstRookie) {
      const top = e.mvps.length ? 'league MVP' : e.finalsMvps.length ? 'a Finals MVP' : 'an All-Pro';
      const headline = pick(
        [
          `From Rookie of the Year to ${top}: ${e.handle}'s rise`,
          `${e.handle} completes the climb — Rookie of the Year to ${top}`,
          `The prophecy fulfilled: ${e.handle} goes from rookie sensation to ${top}`
        ],
        'breakout', peak, playerId
      );
      out.push(story('breakout', peak, headline, {
        id: `breakout-${playerId}`,
        playerId,
        tone: 'good',
        era: eraLabel(firstRookie, peak),
        weight: 8,
        blurb: `Rookie of the Year in S${firstRookie + 1}, ${e.handle} hit the top of the world by S${peak + 1}.`
      }));
    }

    // All-time great: serial MVP winner.
    if (e.mvps.length >= 2) {
      const last = Math.max(...e.mvps);
      const headline = pick(
        [
          `${e.handle} claims a ${ordinal(e.mvps.length)} MVP — an all-time great`,
          `Generational: ${e.handle} is your league MVP yet again (${e.mvps.length}×)`,
          `${e.handle} adds to the legend with MVP number ${e.mvps.length}`
        ],
        'mvp-milestone', last, playerId
      );
      out.push(story('milestone', last, headline, {
        id: `milestone-mvp-${playerId}`,
        playerId,
        tone: 'headline',
        era: eraLabel(Math.min(...e.mvps), last),
        weight: 7 + e.mvps.length,
        blurb: `${e.handle} has been named league MVP ${countWord(e.mvps.length)} times (${e.mvps.map((i) => `S${i + 1}`).join(', ')}).`
      }));
    }
  }
  return out;
}

/** Upsets, comebacks and declines — fortune's sharp turns, season over season. */
function fortuneStories(history, R) {
  const out = [];
  const byIndex = new Map(history.map((s) => [s.seasonIndex, s]));
  const fieldSize = (s) => (Array.isArray(s.championsField) && s.championsField.length) || (Array.isArray(s.finalStandings) && s.finalStandings.length) || 16;

  for (const s of history) {
    if (!s.champion) continue;
    const name = R.teamName(s.champion);
    const prev = byIndex.get(s.seasonIndex - 1) || null;

    // Upset: champion came through from the lower half of the seeding.
    const seed = championSeed(s);
    if (seed != null && seed >= Math.ceil(fieldSize(s) / 2)) {
      const headline = pick(
        [
          `Cinderella story: ${name} crash the party to win it all`,
          `Against the odds — unseeded ${name} shock the world`,
          `${name} defy the bracket to lift the trophy`
        ],
        'upset', s.seasonIndex, s.champion
      );
      out.push(story('upset', s.seasonIndex, headline, {
        id: `upset-${s.seasonIndex}-${s.champion}`,
        teamId: s.champion,
        tone: 'good',
        weight: 8,
        blurb: `Seeded ${ordinal(seed + 1)} into Champions, ${name} weren't supposed to be here.`
      }));
    }

    // Comeback: champion finished in the bottom half of the world the prior year.
    if (prev) {
      const prevPos = standingOf(prev, s.champion);
      const prevSize = fieldSize(prev);
      if (prevPos != null && prevPos >= Math.ceil(prevSize / 2)) {
        const headline = pick(
          [
            `Worst to first: ${name} complete a stunning turnaround`,
            `Redemption: ${name} go from also-rans to world champions`,
            `${name} rebuild and rise — from the pack to the very top`
          ],
          'comeback', s.seasonIndex, s.champion
        );
        out.push(story('comeback', s.seasonIndex, headline, {
          id: `comeback-${s.seasonIndex}-${s.champion}`,
          teamId: s.champion,
          tone: 'good',
          era: eraLabel(s.seasonIndex - 1, s.seasonIndex),
          weight: 7,
          blurb: `${name} finished ${ordinal(prevPos + 1)} of ${prevSize} in S${prev.seasonIndex + 1} before this title.`
        }));
      }
    }
  }

  // Declines: a former champion that has slid out of contention.
  const lastWonBy = new Map();
  for (const s of history) if (s.champion) lastWonBy.set(s.champion, s.seasonIndex);
  const latest = history[history.length - 1];
  if (latest) {
    for (const [teamId, wonIdx] of lastWonBy) {
      if (wonIdx >= latest.seasonIndex - 1) continue; // still recent — not a decline
      const pos = standingOf(latest, teamId);
      const size = fieldSize(latest);
      if (pos == null || pos < Math.ceil((size * 2) / 3)) continue; // not far enough fallen
      const name = R.teamName(teamId);
      const headline = pick(
        [
          `Fallen giants: ${name} are a shadow of their title-winning self`,
          `How far they've slipped — ${name} can't recapture the magic`,
          `${name}, champions of S${wonIdx + 1}, are lost in the pack`
        ],
        'decline', latest.seasonIndex, teamId
      );
      out.push(story('decline', latest.seasonIndex, headline, {
        id: `decline-${teamId}-${latest.seasonIndex}`,
        teamId,
        tone: 'bad',
        era: eraLabel(wonIdx, latest.seasonIndex),
        weight: 5,
        blurb: `Champions in S${wonIdx + 1}, ${name} sit ${ordinal(pos + 1)} of ${size} today.`
      }));
    }
  }
  return out;
}

/**
 * Retirement tributes — careers ending this off-season, weighted by silverware.
 * Reads ONLY the (frozen) history awards + the most-recent off-season report's
 * `retired` list, so it stays pure. Handles resolve from history awards (so a
 * retiree already removed from the world still gets a named tribute).
 */
function retirementStories(history, report, R) {
  if (!report || !Array.isArray(report.retired) || !report.retired.length) return [];
  const tl = playerAwardTimeline(history);
  const seasonIndex = num(report.season, history.length ? history[history.length - 1].seasonIndex + 1 : 0);
  const out = [];
  for (const id of report.retired) {
    const e = tl.get(id);
    const handle = (e && e.handle) || R.playerName(id);
    const mvps = e ? e.mvps.length : 0;
    const firsts = e ? e.firsts.length : 0;
    const rookie = e ? e.rookies.length > 0 : false;
    const decorated = mvps + firsts > 0 || rookie;
    if (!decorated) continue; // only the notable get a tribute (the rest are routine news)
    const honours = [];
    if (mvps) honours.push(`${countWord(mvps)} MVP${mvps > 1 ? 's' : ''}`);
    if (firsts) honours.push(`${countWord(firsts)} All-Pro First Team${firsts > 1 ? 's' : ''}`);
    const honourText = honours.length ? honours.join(' and ') : 'a celebrated career';
    const headline = pick(
      [
        `End of an era: ${handle} retires`,
        `${handle} calls time on a storied career`,
        `A legend bows out — ${handle} retires`
      ],
      'retirement', seasonIndex, id
    );
    out.push(story('retirement', seasonIndex, headline, {
      id: `retirement-${id}`,
      playerId: id,
      tone: 'neutral',
      weight: 6 + mvps * 2 + firsts,
      blurb: `${handle} leaves the game with ${honourText}.`
    }));
  }
  return out;
}

/* -------------------------------- public -------------------------------- */

/**
 * Derive the world's storylines from the frozen history ledger (+ an optional
 * off-season report for retirement tributes). Pure & deterministic; the result
 * is newest-first then most-dramatic-first, ready for the World Feed / happenings.
 *
 * @param {Array<object>} history  state.career.history[] (oldest first, frozen)
 * @param {object} world           engine World OR ui-state world (name resolution)
 * @param {{ offseasonReport?: object|null }} [opts]
 * @returns {Story[]}
 */
export function deriveStorylines(history, world, opts = {}) {
  const hist = Array.isArray(history) ? history.filter(Boolean) : [];
  const R = resolvers(world);
  if (!hist.length && !(opts.offseasonReport && opts.offseasonReport.retired)) return [];

  const stories = [
    ...crownStories(hist, R),
    ...dynastyStories(hist, R),
    ...rivalryStories(hist, R),
    ...playerStories(hist),
    ...fortuneStories(hist, R),
    ...retirementStories(hist, opts.offseasonReport || null, R)
  ];

  // Newest era first; within a season, the most dramatic story leads. Stable
  // id tiebreak keeps the order byte-identical across renders.
  stories.sort((a, b) =>
    b.seasonIndex - a.seasonIndex ||
    b.weight - a.weight ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  return stories;
}

/** Category → coarse feed GROUP (the World Feed's filter chips). */
export const STORY_GROUP = Object.freeze({
  crown: 'titles',
  dynasty: 'titles',
  rivalry: 'rivalries',
  breakout: 'stars',
  milestone: 'stars',
  upset: 'drama',
  comeback: 'drama',
  decline: 'drama',
  retirement: 'farewells'
});

/** Category → Icon name (see ui/components/Icon.js). */
export const STORY_ICON = Object.freeze({
  crown: 'trophy',
  dynasty: 'crown',
  rivalry: 'swords',
  breakout: 'flame',
  milestone: 'medal',
  upset: 'bolt',
  comeback: 'flame',
  decline: 'decline',
  retirement: 'star'
});
