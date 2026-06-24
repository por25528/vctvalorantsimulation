/**
 * engine/career/rating.js — an HLTV-Rating-2.0-style player performance rating
 * derived from the engine's box scores. PURE + deterministic (no rng / Date / DOM).
 *
 * The well-known Rating 2.0 linear model combines per-round impact stats:
 *   Impact = 2.13·KPR + 0.42·APR − 0.41
 *   Rating = 0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact
 *            + 0.0032·ADR + 0.1587
 * where KPR/DPR/APR are kills/deaths/assists PER ROUND, KAST is a percentage
 * (0–100) and ADR is average damage per round. The coefficients were fit to real
 * CS data; the sim's distributions differ slightly, so ratings won't centre
 * exactly on 1.00, but they rank players faithfully and read like an HLTV card.
 *
 * A PlayerMapStat (engine/match/boxScore.js) carries kills/deaths/assists, `kast`
 * as a 0..1 fraction, and `adr`; the map's round count is its score sum.
 */

/** Rating 2.0 linear coefficients. */
const C = Object.freeze({
  KAST: 0.0073, // KAST as 0..100
  KPR: 0.3591,
  DPR: -0.5329,
  IMPACT: 0.2372,
  ADR: 0.0032,
  BIAS: 0.1587,
  IMPACT_KPR: 2.13,
  IMPACT_APR: 0.42,
  IMPACT_BIAS: -0.41
});

/**
 * Calibration offset. The sim's rounds run hotter than CS (higher KPR/ADR), so
 * the raw Rating-2.0 model centres a league-average player near ~1.26 with a
 * realistic spread (std ~0.12). Subtracting this measured league average (then
 * re-adding 1.0) re-centres the scale so 1.00 reads as "average", exactly like an
 * HLTV/VLR rating, while preserving the natural spread between players.
 */
const LEAGUE_AVG_RAW = 1.26;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Rating 2.0 from already per-round figures.
 * @param {{kpr:number, dpr:number, apr:number, kast:number, adr:number}} pr  kast as 0..100
 * @returns {number}
 */
function ratingFromPerRound({ kpr, dpr, apr, kast, adr }) {
  const impact = C.IMPACT_KPR * kpr + C.IMPACT_APR * apr + C.IMPACT_BIAS;
  const raw =
    C.KAST * kast +
    C.KPR * kpr +
    C.DPR * dpr +
    C.IMPACT * impact +
    C.ADR * adr +
    C.BIAS;
  const r = raw - LEAGUE_AVG_RAW + 1.0; // re-centre so league-average ≈ 1.00
  return r < 0 ? 0 : Math.round(r * 100) / 100;
}

/**
 * Rating 2.0 for a single map's box-score line.
 * @param {object} stat  PlayerMapStat ({kills,deaths,assists,kast(0..1),adr,roundsPlayed})
 * @param {number} rounds  the map's total rounds (score sum); falls back to roundsPlayed
 * @returns {number}
 */
export function mapRating(stat, rounds) {
  if (!stat) return 0;
  const r = rounds > 0 ? rounds : num(stat.roundsPlayed) || 1;
  return ratingFromPerRound({
    kpr: num(stat.kills) / r,
    dpr: num(stat.deaths) / r,
    apr: num(stat.assists) / r,
    kast: num(stat.kast) * 100, // stat.kast is a 0..1 fraction
    adr: num(stat.adr)
  });
}

/**
 * Rounds-weighted aggregate Rating 2.0 across many maps for one player.
 * @param {Array<{stat:object, rounds:number}>} maps
 * @returns {{rating:number, maps:number, rounds:number, kills:number, deaths:number, assists:number, kpr:number, dpr:number, kast:number, adr:number}}
 */
export function aggregateRating(maps) {
  let k = 0;
  let d = 0;
  let a = 0;
  let rounds = 0;
  let kastW = 0;
  let adrW = 0;
  let n = 0;
  for (const m of maps || []) {
    const stat = m && m.stat;
    if (!stat) continue;
    const r = m.rounds > 0 ? m.rounds : num(stat.roundsPlayed);
    if (r <= 0) continue;
    k += num(stat.kills);
    d += num(stat.deaths);
    a += num(stat.assists);
    rounds += r;
    kastW += num(stat.kast) * r; // weight the 0..1 fraction by rounds
    adrW += num(stat.adr) * r;
    n += 1;
  }
  if (rounds <= 0) {
    return { rating: 0, maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, kpr: 0, dpr: 0, kast: 0, adr: 0 };
  }
  const kpr = k / rounds;
  const dpr = d / rounds;
  const apr = a / rounds;
  const kastFrac = kastW / rounds; // 0..1
  const adr = adrW / rounds;
  return {
    rating: ratingFromPerRound({ kpr, dpr, apr, kast: kastFrac * 100, adr }),
    maps: n,
    rounds,
    kills: k,
    deaths: d,
    assists: a,
    kpr: Math.round(kpr * 100) / 100,
    dpr: Math.round(dpr * 100) / 100,
    kast: Math.round(kastFrac * 1000) / 1000,
    adr: Math.round(adr * 10) / 10
  };
}

/**
 * Aggregate Rating 2.0 for every player across an event's (or any) series list.
 * @param {Array<object>} series  SeriesRef[] (each with maps[].boxScore + maps[].score)
 * @returns {Map<string, ReturnType<typeof aggregateRating>>} playerId -> rating bundle
 */
export function ratePlayersOverSeries(series) {
  /** @type {Map<string, Array<{stat:object, rounds:number}>>} */
  const byPlayer = new Map();
  for (const s of series || []) {
    for (const m of (s && s.maps) || []) {
      const box = m && m.boxScore;
      if (!box) continue;
      const rounds = (m.score && (num(m.score.A) + num(m.score.B))) || 0;
      for (const pid of Object.keys(box)) {
        if (!byPlayer.has(pid)) byPlayer.set(pid, []);
        byPlayer.get(pid).push({ stat: box[pid], rounds });
      }
    }
  }
  const out = new Map();
  for (const [pid, maps] of byPlayer) out.set(pid, aggregateRating(maps));
  return out;
}
