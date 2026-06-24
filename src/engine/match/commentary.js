/**
 * engine/match/commentary.js — casted-style play-by-play (P12.7).
 *
 * PURE functions that turn the per-round / per-kill data the match engine ALREADY
 * logs (RoundLog.events: DuelEvent[], endCondition, economy, clutchPlayerId,
 * aliveEnd, planted) into human commentary lines + a momentum series for the
 * spectator view. No engine outcomes are touched — this only narrates what was
 * already simulated, so it is deterministic and breaks no match test.
 *
 * Template variety is chosen by a stable index over (roundN, eventIndex) — no rng,
 * fully reproducible. Names are player handles; team labels come from teamsById.
 *
 * @typedef {import('./boxScore.js').RoundLog} RoundLog
 * @typedef {{text:string, tone:string, team?:('A'|'B'|null)}} CommentaryLine
 */

/** Kill-line templates by kind. `{k}` = killer handle, `{v}` = victim handle. */
const TEMPLATES = Object.freeze({
  first: ['{k} draws first blood on {v}', '{k} opens the round, {v} down', 'First pick — {k} tags {v}'],
  kill: ['{k} drops {v}', '{k} frags {v}', '{k} takes the duel vs {v}', '{k} clips {v}'],
  trade: ['{k} trades it straight back — {v} punished', '{k} answers, {v} falls', 'Instant trade, {k} gets {v}'],
  clutchKill: ['{k} stands tall and drops {v}!', 'Ice cold — {k} deletes {v}', '{k} keeps it alive, {v} gone']
});

/** Resolve a player's display handle (falls back to name, then id). */
function handleOf(players, id) {
  const p = players && players[id];
  return (p && (p.handle || p.name)) || id || '?';
}

/** Resolve a team's short label for a side letter from ctx. */
function teamLabel(ctx, teamLetter) {
  const id = teamLetter === 'A' ? ctx.teamAId : ctx.teamBId;
  const t = id && ctx.teamsById ? ctx.teamsById[id] : null;
  return (t && (t.tag || t.name)) || id || `Team ${teamLetter}`;
}

/** Deterministic template pick (no rng). */
function pickTemplate(list, salt) {
  return list[((salt % list.length) + list.length) % list.length];
}

function fill(tpl, k, v) {
  return tpl.replace('{k}', k).replace('{v}', v);
}

/**
 * Build the ordered commentary lines for a single round.
 *
 * @param {RoundLog} roundLog
 * @param {{players:Record<string,object>, teamsById:Record<string,object>, teamAId:string, teamBId:string}} ctx
 * @returns {CommentaryLine[]}
 */
export function roundCommentary(roundLog, ctx) {
  if (!roundLog) return [];
  const c = ctx || {};
  const players = c.players || {};
  const events = Array.isArray(roundLog.events) ? roundLog.events : [];
  /** @type {CommentaryLine[]} */
  const lines = [];

  // Per-round ace bookkeeping: count kills per killer (a 5K clears a side).
  const killCount = new Map();

  events.forEach((ev, i) => {
    if (!ev || typeof ev.killerId !== 'string') return;
    const k = handleOf(players, ev.killerId);
    const v = handleOf(players, ev.victimId);
    killCount.set(ev.killerId, (killCount.get(ev.killerId) || 0) + 1);
    let kind = 'kill';
    let tone = 'kill';
    if (ev.isClutchKill) { kind = 'clutchKill'; tone = 'clutch'; }
    else if (ev.isFirstBlood) { kind = 'first'; tone = 'first'; }
    else if (ev.isTrade) { kind = 'trade'; tone = 'trade'; }
    lines.push({ text: fill(pickTemplate(TEMPLATES[kind], roundLog.n + i), k, v), tone });
  });

  // ACE: any killer with 5 kills cleared the enemy side.
  for (const [id, n] of killCount) {
    if (n >= 5) {
      lines.push({ text: `ACE! ${handleOf(players, id)} clears the entire side (5K)!`, tone: 'ace' });
      break;
    }
  }

  // Clutch callout (winning a round while last-alive vs ≥1 enemy).
  if (typeof roundLog.clutchPlayerId === 'string' && !lines.some((l) => l.tone === 'ace')) {
    const alive = roundLog.aliveEnd || {};
    const who = handleOf(players, roundLog.clutchPlayerId);
    lines.push({ text: `CLUTCH! ${who} wins it on the last life!`, tone: 'clutch' });
    void alive;
  }

  // Round result line, tinted by the winning team, with an eco-upset note.
  const wt = roundLog.winnerTeam === 'A' || roundLog.winnerTeam === 'B' ? roundLog.winnerTeam : null;
  if (wt) {
    const team = teamLabel(c, wt);
    const end = roundLog.endCondition;
    let text;
    if (end === 'spike') text = `Spike detonates — round to ${team}.`;
    else if (end === 'defuse') text = `${team} defuse in time!`;
    else if (end === 'time') text = `Time expires — ${team} hold on.`;
    else text = `${team} take the firefight.`;
    // Eco upset: winner bought down while the loser was on a full buy.
    const econ = roundLog.economy || {};
    const winEcon = econ[wt] && econ[wt].type;
    const loseEcon = econ[wt === 'A' ? 'B' : 'A'] && econ[wt === 'A' ? 'B' : 'A'].type;
    if ((winEcon === 'eco' || winEcon === 'force') && loseEcon === 'full') {
      lines.push({ text: `${team} STEAL it on a ${winEcon === 'eco' ? 'full save' : 'force buy'}! ${text}`, tone: 'eco', team: wt });
    } else {
      lines.push({ text, tone: 'result', team: wt });
    }
  }

  return lines;
}

/**
 * Cumulative score / momentum series for a played map. Each entry is the running
 * score after round `n` plus the lead (A − B) so the UI can draw the swing.
 *
 * @param {object} mapResult  a MapResult: { rounds:RoundLog[], score:{A,B} }
 * @returns {Array<{n:number, a:number, b:number, lead:number, winnerTeam:('A'|'B'|null)}>}
 */
export function mapMomentum(mapResult) {
  const rounds = (mapResult && mapResult.rounds) || [];
  let a = 0;
  let b = 0;
  const out = [];
  for (const r of rounds) {
    const wt = r && (r.winnerTeam === 'A' || r.winnerTeam === 'B') ? r.winnerTeam : null;
    if (wt === 'A') a += 1;
    else if (wt === 'B') b += 1;
    out.push({ n: typeof r.n === 'number' ? r.n : out.length + 1, a, b, lead: a - b, winnerTeam: wt });
  }
  return out;
}
