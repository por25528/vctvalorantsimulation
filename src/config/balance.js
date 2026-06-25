/**
 * config/balance.js — single source of truth for all engine tuning constants.
 * Engine modules import constants from here; never hardcode magic numbers.
 * Values are starting defaults (CONTRACTS §8). The object is deeply frozen so
 * accidental mutation throws in strict mode (all engine outputs stay immutable).
 */

/**
 * Recursively freeze an object and all nested plain objects so no tuning value
 * can be mutated at runtime.
 * @template T
 * @param {T} obj
 * @returns {Readonly<T>}
 */
function deepFreeze(obj) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}

/**
 * @typedef {object} Balance
 * Frozen tuning table. See CONTRACTS §8 for the authoritative key list.
 */

/** @type {Readonly<Balance>} */
export const BALANCE = deepFreeze({
  DUEL_SCALE: 11, // logistic scale for duel rating diff (lower = skill matters more; was 14)
  ROUND_SCALE: 80, // logistic scale for team round-strength diff (tiebreak/spike)
  // duel rating weights (sum ~1.0) over Attributes used in a gunfight
  DUEL_WEIGHTS: { aim: 0.5, reaction: 0.2, movement: 0.18, gameSense: 0.12 },
  // team round-strength contribution weights
  ROUND_WEIGHTS: { duel: 0.7, utility: 0.18, trading: 0.12 },
  IGL_TEAM_BONUS: 0.06, // *(igl/100) added as multiplier to team round strength
  // dynamics — these PERTURB base skill (form lifts, fatigue drags, morale nudges).
  // Kept modest so a team's underlying skill ordering stays stable across a season
  // (rosters cluster within a few overall points; large swings here would flip the
  // regional favourite every event and erase any dynasty). Tunable knobs.
  FORM_WEIGHT: 0.06,
  FATIGUE_WEIGHT: 0.045,
  MORALE_WEIGHT: 0.025,
  // economy factors applied to duel rating
  ECON_FACTOR: { full: 1.0, force: 0.92, eco: 0.8, pistol: 0.95 },
  PISTOL_AIM_DAMPEN: 0.85, // compresses rating spread on pistol rounds
  // economy credits (Valorant-like)
  CREDIT_START: 800,
  CREDIT_MAX: 9000,
  WIN_REWARD: 3000,
  LOSS_BASE: 1900,
  LOSS_BONUS_STEP: 500,
  LOSS_BONUS_MAX: 2900,
  KILL_REWARD: 200,
  PLANT_BONUS: 300,
  BUY_FULL_MIN: 3900,
  BUY_FORCE_MIN: 2000, // credit thresholds
  // round flow
  TRADE_BASE: 0.55, // *(avg trading/100) chance a kill is traded
  CLUTCH_WEIGHT: 0.18, // last-alive Composure bonus to duel rating: ((composure-50)/100)*scale
  PLANT_BASE_CHANCE: 0.45, // attacker plant likelihood when reaching man-advantage
  ENGAGEMENT_CAP: 14, // safety cap on engagements/round
  // map score
  ROUNDS_TO_WIN: 13,
  OT_WIN_BY: 2,
  // box score
  ACS_KILL: 150,
  ACS_ASSIST: 35,
  ACS_PER_DUEL_BONUS: 12,
  // assist attribution (boxScore): assists are RARE per kill (real Valorant is
  // ~3-12 assists per player per map; team assists run ~30-70% of team kills).
  // A kill grants AT MOST ASSIST_MAX_PER_KILL assists. The FIRST assist fires
  // with probability ASSIST_CHANCE_BASE, lifted toward ASSIST_CHANCE_UTILITY_MAX
  // by the best alive teammate's utility. The (rare) SECOND assist fires with
  // ASSIST_CHANCE_SECOND. WHO is credited is utility-weighted among candidates.
  ASSIST_MAX_PER_KILL: 2,
  ASSIST_CHANCE_BASE: 0.32, // baseline P(at least one assist) at neutral utility
  ASSIST_CHANCE_UTILITY: 0.2, // *(bestUtility/100) added to the first-assist chance
  ASSIST_CHANCE_SECOND: 0.1, // P(a second, distinct assist) given the first landed
  ASSIST_WEIGHT_BASE: 0.25, // floor weight so any teammate can be the assister
  ASSIST_WEIGHT_UTILITY: 0.75, // *(utility/100) added to a candidate's pick weight

  // ============================ CAREER (Phase 6) ============================
  // All career-dynamics tuning. The match/format/season engines stay pure over a
  // fixed world; these knobs drive the NEW career layer (CONTRACTS-CAREER).
  CAREER: {
    // ---- in-season dynamics evolution (engine/career/dynamics.js) ----
    DYNAMICS: {
      PERF_BASELINE: 1.0, // performance rating that counts as "league average"
      FORM_PERF_K: 22, // form delta per unit of (performance-baseline), *100
      FORM_WIN: 4, // flat form kick for a win (negative for a loss: FORM_LOSS)
      FORM_LOSS: 5,
      FORM_DECAY: 0.6, // between events, form *= this (mean-reverts toward 0)
      MORALE_WIN: 5,
      MORALE_LOSS: 6,
      MORALE_PERF_K: 9, // morale delta per unit of (performance-baseline), *100
      MORALE_BASE: 60, // neutral morale that recovery reverts toward
      MORALE_REVERT: 0.25, // between events, morale += this*(BASE-morale)
      FATIGUE_PER_MAP: 6, // fatigue accrued per map played
      FATIGUE_RECOVERY: 24, // fatigue shed between events (flat, floored at 0)
      OFFSEASON_MORALE_REVERT: 0.4, // over the long break, morale += this*(BASE-morale); form/fatigue reset to 0
      PERF_ACS_MIN: 0.4, // clamp on per-slot performance (avgACS / slot-mean-ACS)
      PERF_ACS_MAX: 1.8
    },
    // ---- aging & development (offseason/development.js) — P12.1 rewrite ----
    // SHAPE-PRESERVING logistic growth: a player climbs toward `potential` (an
    // OVERALL ceiling) fastest when young, the rate fading via a logistic on
    // (age - peak) so they ARRIVE inside their prime instead of decades later.
    // Growth adds (roughly) the same overall step to every attribute, so role
    // slants (a duelist's high aim / low igl) persist. Decline is per-attribute
    // (physical fades fast, mental slow) so a fading star reshapes realistically.
    AGING: {
      GROWTH_HEADROOM_K: 2.2, // overall step ∝ K * (potential - overall)/10 (set so youth reach ~95% of potential by peak)
      GROWTH_RATE_BASE: 0.42, // logistic steepness of the age-falloff: 1/(1+exp((age-peak)*this))
      GROWTH_NOISE: 1.1, // gaussian stdev added per attribute (mild shape jitter)
      PEAK_PLATEAU_NOISE: 0.8, // zero-mean attribute jitter during the prime plateau
      DECLINE_K: 0.8, // base decline per year past declineAge
      DECLINE_NOISE: 1.0,
      PHYSICAL: ['aim', 'movement', 'reaction'], // decline fast (aim-reliant duelists fade early)
      MENTAL: ['gameSense', 'igl', 'composure'], // decline slow / grow late (vets get smarter)
      PHYSICAL_DECLINE_MULT: 1.7,
      MENTAL_DECLINE_MULT: 0.3,
      MENTAL_LATE_GROWTH: 0.45, // veterans still tick mental attrs up a touch
      // Game-sense longevity: high-IGL players peak later and decline softer, so
      // veteran leaders stay competitive into their 30s (user ask).
      IGL_PEAK_SHIFT_K: 0.04, // + peak/decline years per igl point over 60 …
      IGL_PEAK_SHIFT_MAX: 4, // … capped at +4 years
      IGL_DECLINE_SOFTEN_K: 0.006, // decline *= (1 - this*(igl-60)) …
      IGL_DECLINE_SOFTEN_MAX: 0.5, // … capped at a 50% softer fade
      // Development archetypes (assigned at newgen): growth-rate multipliers and
      // a late-bloomer peak shift. Wonderkids climb fast & high; busts stall.
      WONDERKID_GROWTH_MULT: 1.6,
      BUST_GROWTH_MULT: 0.45,
      LATEBLOOMER_GROWTH_MULT: 0.7, // slower early …
      LATEBLOOMER_PEAK_SHIFT: 3 // … but peak/decline pushed later (a long, late arc)
    },
    // ---- retirement (offseason/retirement.js) ----
    RETIRE: {
      MIN_AGE: 26, // no retirement chance below this
      BASE: 0.03, // baseline annual hazard at MIN_AGE
      AGE_K: 0.05, // + per year over MIN_AGE
      MORALE_PIVOT: 40, // morale below this lifts the chance
      LOW_MORALE_K: 0.005, // + per morale point below the pivot
      DECLINE_OVERALL_PIVOT: 62, // overall below this (a faded vet) lifts the chance
      DECLINE_K: 0.006, // + per overall point below the pivot
      FORCE_AGE: 38 // certain retirement at/above this age
    },
    // ---- newgen youth (offseason/newgen.js) ----
    NEWGEN: {
      AGE_MIN: 16,
      AGE_MAX: 19,
      // Prospect potential is a gaussian → a believable talent pyramid: most
      // intake is journeyman/role-player grade, a solid-pro middle, and a thin
      // elite tail (wonderkids lift the ceiling further, below). MEAN/MAX are
      // calibrated against the SEED world (T1 overall ≈ 79, ceiling ≈ 85) so the
      // best newgens REFILL the T1 pool without deflating its average or
      // inflating its ceiling into 95-overall gods. See scripts/probe-newgen.mjs.
      POT_MEAN: 74,
      POT_STD: 8.5,
      POT_MIN: 48,
      POT_MAX: 90,
      HEADROOM_MIN: 8, // current overall sits this far below potential …
      HEADROOM_MAX: 20, // … up to this far (a raw 16-yo). Prospects who reach the
      // T1 free-agent pool are talented-but-unfinished, not total amateurs, so the
      // gap is moderate — enough for a visible growth arc without rosters filling
      // with overall-50 raws that crater the league average.
      ATTR_NOISE: 4, // per-attribute gaussian spread around the base
      // Per-role share of the intake (weights, normalized). Matches realistic VCT
      // team composition (duelist/initiator slightly more common than the
      // dedicated controller/sentinel) so rosters never drift into a role drought.
      ROLE_WEIGHTS: { Duelist: 0.29, Initiator: 0.28, Controller: 0.22, Sentinel: 0.21 },
      // P12.1 — peak/decline draw bands (pushed later than the old 23-25 / 27-29)
      PEAK_AGE_MIN: 24, PEAK_AGE_SPAN: 4, // peakAge = 24..27
      DECLINE_AGE_MIN: 28, DECLINE_AGE_SPAN: 4, // declineAge = 28..31
      // P12.1 — per-newgen growthRate variance (some learn faster than others)
      GROWTH_RATE_MEAN: 1.0, GROWTH_RATE_STD: 0.18, GROWTH_RATE_MIN: 0.5, GROWTH_RATE_MAX: 1.6,
      // P12.1 — development archetype assignment probabilities (else 'normal')
      WONDERKID_PROB: 0.06, // rare, fast-rising & high-ceiling
      BUST_PROB: 0.12, // never reach their hype
      LATEBLOOMER_PROB: 0.12, // slow start, long late-career arc
      WONDERKID_POT_BOOST: 4 // wonderkids carry a higher potential ceiling (kept modest so the elite tail stays believable, not 95-overall gods)
    },
    // ---- contracts (offseason/contracts.js) ----
    CONTRACT: {
      LENGTH_MIN: 1,
      LENGTH_MAX: 3, // renewal length in seasons
      // Age-aware contract length (M7): clubs hand young/prime players longer deals
      // and only tie aging players down for a season or two — realistic term length.
      // Stays within [LENGTH_MIN, LENGTH_MAX]; still one rng draw (determinism intact).
      LENGTH_AGE_MID: 30, // at/above this age the max term drops to LENGTH_MAX−1
      LENGTH_AGE_VET: 33, // at/above this age only LENGTH_MIN-length deals are offered
      RENEW_BASE: 0.55, // baseline renew probability
      RENEW_MORALE_K: 0.004, // + per morale point above MORALE_BASE (60)
      RENEW_VALUE_K: 0.004, // + per (overall-70) point (good players get kept)
      RENEW_AGE_K: 0.02, // − per year of age over 28 (clubs let vets walk)
      // Salary curve (P13): a base + a steeper linear term + a PROGRESSIVE elite
      // premium so the very best players cost dramatically more (user ask). At
      // overall 70 ≈ $90k, 80 ≈ $130k, 85 ≈ $190k, 90 ≈ $330k, 95 ≈ $550k —
      // a real star-vs-journeyman wage gap that the buy/sell market trades on.
      SALARY_BASE: 40000,
      SALARY_OVERALL_K: 4200, // * (overall-60), floored at 0 (was 3500 — steeper)
      SALARY_POT_K: 1400, // * max(0, potential-overall) (pay for upside; was 1200)
      SALARY_ELITE_PIVOT: 80, // progressive premium kicks in above this overall
      SALARY_ELITE_K: 1600, // * (overall - pivot)^SALARY_ELITE_POW (elite tax)
      SALARY_ELITE_POW: 2 // quadratic: elite wages climb fast
    },
    // ---- transfer market + off-season pipeline (offseason/transfers.js, offseason.js) ----
    MARKET: {
      MIN_ROSTER: 5, // teams are kept filled to at least this many players
      MAX_ROSTER: 7, // the user (P6d transfer market) may carry this many — first 5 start, the rest bench
      USER_SIGN_LENGTH: 3, // seasons on a user-brokered signing / extension (deterministic; no rng in the UI layer)
      NEWGEN_PER_OFFSEASON: 26, // base youth intake each off-season (sized so the best rookies + a deepening FA pool refill T1 turnover without deflation)
      NEWGEN_BUFFER: 8, // extra newgens minted beyond known holes (spare prospects)
      SIGN_WEIGHT_POW: 3, // weightedPick exponent on value^pow (better FAs usually win the bid)
      UPGRADE_MARGIN: 6, // a free agent must beat a team's worst starter by this to tempt an upgrade
      UPGRADE_CHANCE: 0.45, // and the rng must allow the swap
      REPORT_NOTABLE_TRAJECTORY: 1.0, // |overall delta| at/above which a development is "notable" in the report
      // ---- player valuation (offseason/transfers.js: playerValue) — M7 ----
      // A player's MARKET VALUE is not a single number. Ability (overall) is the base;
      // unrealized upside (potential − overall) is worth more the younger the player
      // (a teenager will realize their ceiling, a 29-yo never will); an AGE CURVE then
      // depreciates the asset past its prime (a 33-yo 80-ovr is worth far less than a
      // 24-yo 80-ovr — fewer prime years, lower resale), floored so a proven veteran
      // keeps some name value; and form/morale nudge perceived value. This stops the
      // AI overpaying transfer fees for declining 30-somethings (the M7 user ask).
      VALUE_POT_WEIGHT: 0.5, // upside weight at peak youth: value += this * upside * youthFactor
      VALUE_UPSIDE_AGE_FULL: 21, // at/below this age the FULL upside premium applies
      VALUE_UPSIDE_AGE_ZERO: 29, // at/above this age upside is worth ~nothing (prime spent)
      VALUE_AGE_DECLINE_PIVOT: 28, // value depreciates per year of age past this
      VALUE_AGE_DECLINE_K: 0.05, // − this fraction of value per year past the pivot
      VALUE_AGE_MULT_MIN: 0.5, // age alone never docks more than half (experience/name floor)
      VALUE_FORM_K: 0.06, // ± this * (form/100): an in-form player is worth a touch more
      VALUE_MORALE_K: 0.04, // ± this * ((morale−60)/40): a settled, happy player worth a touch more
      // ---- lineup-contribution value (offseason/transfers.js: lineupValue) ----
      // playerValue above is ASSET/resale worth — potential-heavy and age-depreciated,
      // which is right for pricing FEES (you don't pay a big fee for a decliner). But it
      // is the WRONG yardstick for "who improves my starting five RIGHT NOW": a proven
      // 83-overall veteran contributes 83 today, yet asset value docks them below a
      // 74-overall rookie whose ceiling inflates their resale. Using asset value for
      // squad decisions left strong veteran FREE AGENTS reading below mediocre starters
      // — so they sat unsigned for seasons while clubs paid fees for higher-"value" but
      // weaker rookies. lineupValue is OVERALL-led: potential is only a small nudge (you
      // field current ability, not a ceiling) and the age curve is mild (overall already
      // encodes skill decline). Used for upgrade/improve ranking, the makeweight drop,
      // and the fill draw — so the market judges on-field help, not resale.
      VALUE_LINEUP_POT_WEIGHT: 0.15, // upside nudge at peak youth (small: lineup ≈ current ability)
      VALUE_LINEUP_AGE_DECLINE_K: 0.02, // mild per-year dock past VALUE_AGE_DECLINE_PIVOT (overall already encodes decline)
      VALUE_LINEUP_AGE_MULT_MIN: 0.8, // a proven veteran stays a strong contributor (high floor)
      // ---- role-complete roster construction (offseason/transfers.js: fillRosters) ----
      // When filling a hole, a free agent that plugs a MISSING core role gets this
      // multiplicative boost in the value-weighted draw, so AI lineups trend toward a
      // balanced Duelist/Initiator/Controller/Sentinel five instead of stacking a role.
      ROLE_NEED_FILL_MULT: 6,
      // The fill draw picks proportional to value^pow, but over the WHOLE free pool the
      // long tail of raw newgens dilutes the strongest free agent down to a few-percent
      // chance — so a club would occasionally sign a 62-overall prospect while an
      // 85-overall free agent of the SAME role sat unsigned. Restricting the draw to the
      // top-N best-fitting candidates guarantees the club fills from its best available
      // (with a little variety among that top tier), so strong free agents get signed
      // promptly instead of being passed over for weak prospects.
      FILL_SHORTLIST: 4
    },
    // ---- awards & all-pro (P7a, engine/career/awards.js) ----
    AWARDS: {
      MIN_MAPS: 6, // a player must have played at least this many maps to qualify for any award (small-sample guard)
      ROOKIE_MAX_AGE: 20, // Rookie of the Year is the best qualified player at or below this age
      ALL_PRO_SIZE: 5 // players per All-Pro team (First = top 5 by rating, Second = next 5)
    },
    // ---- news & inbox (P7b, engine/career/news.js + state/slices/inbox.js) ----
    NEWS: {
      INBOX_CAP: 150, // the inbox keeps at most this many most-recent items (bounds save size)
      OFFSEASON_RETIREMENTS: 4, // headline at most this many retirements per off-season
      OFFSEASON_SIGNINGS: 4, // headline at most this many signings per off-season
      OFFSEASON_NEWGENS: 2 // headline at most this many newgen arrivals per off-season
    },
    // ---- sponsor economy (P7e, engine/career/economy.js) ----
    // Budget is a cash reserve. Each season-end adds prize money (by event finish)
    // and pays the wage bill (sum of rostered salaries): budget = max(0, budget +
    // prize - wages). No engine DECISION reads budget (the AI market is reputation-
    // driven), so this is pure accounting — it only constrains the USER's signings.
    ECONOMY: {
      // Purses bumped (P13) so winning is financially meaningful against the
      // steeper wage bill — title money is a real war-chest for the buy/sell market.
      PRIZE_KICKOFF: 120000, // winner's purse for a regional Kickoff
      PRIZE_STAGE: 175000, // winner's purse for a regional Stage
      PRIZE_MASTERS: 450000, // winner's purse for an international Masters
      PRIZE_CHAMPIONS: 1000000, // winner's purse for Champions
      PRIZE_DECAY: 0.65, // rank r earns purse * PRIZE_DECAY^(r-1)
      PRIZE_MIN_FRACTION: 0.05, // floor: even an early exit earns this fraction of the purse
      BUDGET_FLOOR: 300000, // a club's budget never drops below this — sponsors keep them solvent (no bankruptcies)
      // Recurring SPONSOR income each season, scaled by reputation. Bumped (P13)
      // to keep a mid-table club roughly solvent against the steeper wages, while
      // reputation now STRATIFIES budgets (a prestige club out-earns a small org by
      // ~$1M/yr). Budget is now READ by the AI market (P13), so this gradient
      // directly shapes who can afford the stars.
      SPONSOR_BASE: 600000, // baseline yearly sponsorship every club attracts
      SPONSOR_REP_K: 12000, // + this per reputation point (a rep-50 club earns BASE + 600k)
      // Reserve drag (anti-hoarding): the league's net inflow (sponsor + prize) runs
      // above the wage bill, so without a sink budgets balloon into idle millions even
      // though clubs now trade heavily (fees just CIRCULATE money buyer→seller). Each
      // season a club reinvests a fraction of any reserve above a soft cap into
      // facilities/academy/ops (money that leaves the tracked budget), so reserves
      // plateau at a sane, still-spendable level instead of growing without bound.
      // Pure & deterministic; the floor still guarantees solvency.
      RESERVE_SOFT_CAP: 3000000, // reserves above this get reinvested down ($3M)
      RESERVE_DRAG: 0.5 // fraction of the excess-above-cap reinvested each season
    },
    // ---- injuries (P7c, engine/career/injuries.js) ----
    // An injured player is NOT pulled from the roster (rosters stay >=5 and the
    // match engine still fields the first five); instead their effective fatigue
    // is pinned high while injured, so the engine's existing dynamics read makes
    // them play hurt. All rolls are seeded (hashSeed) — fully reproducible.
    INJURY: {
      BASE_CHANCE: 0.008, // per-slot base injury probability for a player who featured
      FATIGUE_K: 0.025, // + this * (fatigue/100) — tired players break down
      MAPS_K: 0.0009, // + this * maps played this slot
      AGE_K: 0.0035, // + this * max(0, age - AGE_PIVOT)
      AGE_PIVOT: 27, // injuries climb past this age
      MAX_CHANCE: 0.12, // hard cap on the per-slot probability
      MIN_WEEKS: 1, // injury duration range, in calendar slots
      MAX_WEEKS: 3,
      FATIGUE_FLOOR: 85 // effective fatigue pinned on an injured player (drives the engine debuff)
    },

    // ======================= P12 — depth & realism =========================
    // All knobs for the "Football Manager" upgrade. Each block is consumed by
    // the sub-phase named in its comment; values land here up-front so later
    // phases don't re-touch config. Determinism-safe (these only scale existing
    // weights or seed new offseason draws via hashSeed).

    // ---- language & team chemistry (P12.2, engine/career/chemistry.js) ----
    // Chemistry is a DETERMINISTIC multiplier on team strength (no rng): it
    // blends the team's stored chemistry (results history), language cohesion of
    // the starting five, roster familiarity (seasons together), and the coach.
    // Kept ≤ ±CHEM_MAX so it perturbs — never erases — the underlying skill gap.
    CHEMISTRY: {
      CHEM_MAX: 0.05, // hard cap on the chemistry multiplier (±5%)
      LANG_WEIGHT: 0.4, // share of the blend from language cohesion
      FAMILIARITY_WEIGHT: 0.35, // share from roster familiarity (time together)
      RESULTS_WEIGHT: 0.25, // share from stored team.chemistry (win/loss history)
      ENGLISH_SOFTEN: 0.55, // cohesion for a pair sharing only a non-native (English) tongue
      FAMILIARITY_K: 0.6, // familiarity = 1 - exp(-K * avgSeasonsTogether)
      CHEM_BASE: 50, // neutral team.chemistry (the 1.0 multiplier point)
      CHEM_WIN: 1.5, // team.chemistry delta per won slot (map record)
      CHEM_LOSS: 1.2, // team.chemistry delta per lost slot
      CHEM_REVERT: 0.15, // between slots, chemistry += this*(BASE - chemistry)
      NEW_SIGNING_PENALTY: 6 // a fresh signing drops team.chemistry by this on arrival
    },
    // ---- player traits & personalities (P12.3, engine/career/traits.js) ----
    TRAITS: {
      CLUTCH_BONUS: 0.06, // 'clutch': duel-rating lift when last-alive (isClutch)
      BIGGAME_BONUS: 0.05, // 'bigGame': lift in international/playoff stakes
      CHOKER_PENALTY: 0.05, // 'choker': drag in high stakes
      SLOWSTARTER_PENALTY: 0.05, // 'slowStarter': drag in the first few rounds of a map
      FASTSTARTER_BONUS: 0.04, // 'fastStarter': lift early, fades after
      CONSISTENT_NOISE_MULT: 0.6, // 'consistent': dev noise *= this (steadier growth)
      VOLATILE_NOISE_MULT: 1.5, // 'volatile': dev noise *= this (boom/bust seasons)
      WORKHORSE_DEV_MULT: 1.15, // 'workhorse': growthRate *= this
      MENTOR_CHEM: 2.5, // 'mentor': flat team chemistry bonus while rostered
      HOTHEAD_CHEM: -2.5, // 'hothead': flat team chemistry drag
      LEADER_CHEM: 2.0, // 'leader': chemistry bonus (binds a roster)
      EARLY_PEAK_SHIFT: -2, // 'earlyPeak': peak/decline ages shift earlier
      LATE_PEAK_SHIFT: 2, // 'ironLungs'/'latePeak': peak/decline shift later
      ASSIGN_CHANCE: 0.55, // P(a newgen gets at least one trait)
      ASSIGN_SECOND_CHANCE: 0.25 // P(a second, distinct trait given the first)
    },
    // ---- Tier 2 / Challengers ecosystem (engine/career/tier2/*) ----
    // A REAL, fully-simulated second division: each region fields TEAMS_PER_REGION
    // T2 clubs (sized to the regional format — two groups of 6 → an 8-team playoff)
    // that play the same Kickoff/Stage events through the format engine, in a
    // SEPARATE world.tier2 namespace so the franchised T1 league (and every existing
    // determinism/count test) stays byte-identical. Determinism flows from a fixed
    // hashSeed off the career seed — no wall-clock, no unseeded rng.
    TIER2: {
      TEAMS_PER_REGION: 12, // T2 clubs per region (matches the 12-team regional format)
      ROSTER_SIZE: 5,
      // ---- generated-roster quality / age curve (tier2World.js) ----
      // T2 sits a clear step below T1 (authored T1 overall ≈ 79, ceiling ≈ 85): a
      // generated T2 player centres well below that. Challengers is a MIX — young
      // prospects climbing toward T1 plus veteran journeymen who never made (or
      // dropped out of) the top flight — so the age band is wide and youth-skewed.
      OVR_MEAN: 66, OVR_STD: 5.5, OVR_MIN: 50, OVR_MAX: 80,
      AGE_MIN: 17, AGE_MAX: 28,
      AGE_MEAN: 20.5, AGE_STD: 3.2,
      // Upside: a young T2 player carries headroom toward a T1-capable ceiling; the
      // headroom shrinks linearly to ~0 by POT_HEADROOM_REF_AGE (a finished vet).
      POT_HEADROOM_MAX: 18, // a 17-yo's ceiling sits up to this far above current overall
      POT_HEADROOM_REF_AGE: 26, // headroom runs out by this age
      POT_MAX: 88, // a T2 prospect's ceiling never exceeds this (true elites are rare)
      ATTR_NOISE: 3.5, // per-attribute gaussian spread around the role-shaped base
      // ---- yearly T2 youth intake (tier2Offseason.js) ----
      NEWGEN_PER_OFFSEASON: 16, // fresh 16–19yo prospects minted into the T2 FA pool each off-season
      NEWGEN_BUFFER: 6, // spare prospects beyond known holes (keeps the fill pool deep)
      FADE_AGE: 23, // an UNSIGNED T2 free agent past this age has washed out of the scene and is dropped (bounds the live pool)
      // ---- promotion / relegation pipeline (tier2Offseason.js: runPromotion) ----
      // Strong T2 players rise into the T1 free-agent pool (where the T1 market signs
      // them next window); weak surplus T1 free agents fall to T2. Counts are modest
      // so the flow is a trickle of genuine talent, not a churn that destabilises T1.
      PROMOTE_PER_REGION: 2, // strongest eligible T2 players promoted to the T1 FA pool / region / yr
      PROMOTE_OVERALL_MIN: 72, // a T2 player is promotable once their overall reaches this …
      PROMOTE_POTENTIAL_MIN: 79, // … OR they carry at least this potential (a raw, high-ceiling prospect)
      RELEGATE_PER_REGION: 2, // weakest surplus T1 free agents dropped to T2 / region / yr
      RELEGATE_OVERALL_MAX: 67 // only unrostered T1 free agents at/below this overall relegate
    },
    // ---- coaches & staff (P12.5 + P13 transfer-coach, engine/career/staff.js) ----
    STAFF: {
      DEV_MIN: 0.0, DEV_MAX: 0.12, // coach development bonus range (×growth)
      CHEM_MIN: 0.0, CHEM_MAX: 6, // coach flat chemistry bonus range
      PREP_MIN: 0.0, PREP_MAX: 0.04, // coach match-prep bonus range (×team strength via chemistry)
      RATING_MEAN: 60, RATING_STD: 14, // coach rating draws (0..100)
      SALARY_BASE: 60000, SALARY_RATING_K: 2200, // coach wage = BASE + K*meanRating
      HIRE_CHANCE: 0.55, // P(a coachless, solvent club hires in an off-season)
      // P13 — the transfer-focused coach. `negotiation` (0..100) is the coach's
      // dealmaking skill: a top GM prises stars away cheaper, talks wages down, and
      // identifies better targets. A small chemistry bump models their man-management.
      NEGO_MEAN: 60, NEGO_STD: 16, // negotiation rating draws (0..100)
      NEGO_FEE_K: 0.0030, // transfer fee *= (1 - NEGO_FEE_K*(nego-50)), capped
      NEGO_FEE_MAX: 0.30, // a great GM saves at most 30% on a fee
      NEGO_WAGE_K: 0.0018, // wage demand *= (1 - NEGO_WAGE_K*(nego-50)), capped
      NEGO_WAGE_MAX: 0.18, // …at most 18% off the wage
      NEGO_TARGET_K: 0.05, // effective-bid boost per nego point over 50 (better scouting of targets)
      CHEM_BUMP_K: 0.10, // off-season team.chemistry += CHEM_BUMP_K*(rating-50), clamped
      CHEM_BUMP_MAX: 8, // …capped at +8 chemistry
      HIRE_RATING_REP_K: 0.5 // a club's coach hires scale with reputation (better orgs land better staff)
    },
    // ---- bootcamps (P12.5, engine/career/bootcamp.js) ----
    // Auto, pre-international-event. Lifts chemistry/familiarity & a tiny dev tick,
    // scaled by coach prep + budget. Surfaced in news; never micro-managed.
    BOOTCAMP: {
      CHEM_GAIN: 4, // team.chemistry gained from a bootcamp
      FAMILIARITY_GAIN: 0.25, // bonus seasons-together credited (gels a roster faster)
      DEV_TICK: 0.4, // tiny attribute bump to attendees (× coach prep)
      BUDGET_COST: 40000, // bootcamp cost (only run if affordable above floor)
      INTERNATIONAL_ONLY: true // bootcamps fire before Masters/Champions only
    },
    // ---- scouting & hidden potential (P12.6, engine/career/scouting.js) ----
    SCOUTING: {
      BASE_KNOWLEDGE_GAIN: 18, // knowledge gained per off-season for a watched player
      COACH_PREP_K: 30, // + this * coach.prep (better staff scout better)
      HYPE_BAND_MIN: 86, // a revealed potentialHigh ≥ this triggers wonderkid hype
      HYPE_KNOWLEDGE_MIN: 45 // …once knowledge crosses this (enough confidence)
    },
    // ---- storylines & rivalries (P12.6, engine/career/storylines.js) ----
    STORYLINES: {
      BREAKOUT_TRAJECTORY: 3.0, // |Δoverall| over an off-season that reads as a breakout
      HOT_STREAK_SLOTS: 3, // consecutive strong showings → "hot streak"
      SLUMP_FORM: -25, // form at/below this → "slump"
      RIVALRY_MEETINGS: 2, // finals meetings within the window to coin a rivalry
      RIVALRY_WINDOW: 3, // seasons the rivalry window spans
      DYNASTY_TITLES: 2, // repeat championships → "dynasty"
      MAX_PER_OFFSEASON: 6 // cap storyline news items per off-season
    },

    // ======================= P13 — living reputation, attractiveness & the
    // full buy/sell transfer market. These knobs make reputation MOVE with
    // results, turn it (plus money & success) into a pull that good players weigh
    // when choosing clubs, and price the transfer fees for buying contracted
    // players. The match/season engines stay pure; all of this lives in the
    // career/off-season layer and is seeded via hashSeed (fully deterministic).

    // ---- dynamic reputation (engine/career/reputation.js) ----
    // Reputation rises with titles & deep runs and mean-reverts toward BASE, so a
    // winning org climbs into prestige (≈85-95) but a club that stops winning
    // slides back toward the middle — real esports dynasties that still end.
    REPUTATION: {
      BASE: 50, // mean-reversion target
      REVERT: 0.10, // each off-season rep += REVERT*(BASE - rep) (slow decay toward mean)
      TITLE_CHAMPIONS: 9, // rep for winning the world Champions
      TITLE_MASTERS: 6, // rep for winning an international Masters
      TITLE_STAGE: 3, // rep for winning a regional Stage playoff
      TITLE_KICKOFF: 3, // rep for winning a regional Kickoff
      PLACEMENT_K: 4, // deep-run credit: tier weight × PLACEMENT_DECAY^(rank-1)
      PLACEMENT_DECAY: 0.55, // placement credit fades by finish
      CP_RANK_K: 5, // up to this for topping the season's cumulative CP standings
      MIN: 20, MAX: 99, // dynamic reputation bounds (never a flat 0 or 100)
      // Initial prestige is seeded from roster strength (top-5 overall) so day-one
      // clubs already differ in pull — a stacked super-roster starts prestigious,
      // a weak side humble — then reputation diverges further with results.
      SEED_MIN: 38, SEED_MAX: 84
    },

    // ---- team attractiveness & player signing preference (engine/career/attractiveness.js) ----
    // A team's pull on talent (0..100) blends prestige (reputation), recent
    // success, and money. A free agent / transfer target then ranks its suitors by
    // signingDesirability: pull + the wage on offer + playing time + home comfort.
    ATTRACT: {
      REP_W: 0.55, // reputation share of base attractiveness
      SUCCESS_W: 0.27, // recent on-stage success share (0..1 success score)
      MONEY_W: 0.18, // financial-muscle share (budget vs MONEY_REF)
      MONEY_REF: 3000000, // budget that reads as fully "rich" when normalizing
      // signingDesirability weights (a player choosing among suitors):
      PULL_W: 0.55, // team attractiveness share
      WAGE_W: 0.30, // wage offered vs the player's market wage (capped ratio)
      PLAYTIME_W: 0.15, // would the player crack the starting five
      WAGE_RATIO_CAP: 1.6, // a huge overpay can't buy more than this much desire
      HOME_BONUS: 7, // same-region comfort bonus (familiar league/lang)
      STARTER_BONUS: 14, // bonus when the player would start (first five)
      AMBITION_K: 0.25 // better players weigh prestige/success more (status-driven)
    },

    // ---- transfer fees for buying contracted players (engine/career/offseason/transfers.js) ----
    // Buying a player still under contract costs a FEE (cash from the buyer to the
    // seller), priced off the player's value, remaining years, and the seller's
    // prestige. Free agents still cost no fee. Fees flow through team budgets — so
    // a rich/winning club can assemble talent the small org simply can't bid for.
    TRANSFER: {
      FEE_VALUE_PIVOT: 60, // fee scales with max(0, value - pivot)
      FEE_VALUE_K: 14000, // base fee ≈ K * (value-pivot)^POW
      FEE_VALUE_POW: 1.6, // progressive: prising a star away costs a steep premium
      FEE_YEARS_K: 0.30, // fee *= (1 + FEE_YEARS_K*(yearsLeft-1)) (locked-up players cost more)
      FEE_REP_K: 0.005, // fee *= (1 + FEE_REP_K*(sellerRep-50)) (prestige tax)
      FEE_MIN: 30000, // a contracted player never moves for less than this
      RELEASE_CLAUSE_MULT: 2.4, // some contracts carry a clause: fee capped at base*this
      WILLING_SELL_VALUE: 8, // a club will entertain selling a starter only if the buyer's target-need margin clears this
      UPGRADE_MARGIN: 5, // a target must beat the buyer's worst starter by this (value) to pursue
      MAX_BUY_PASSES: 3, // bounded buy/sell upgrade passes (deterministic, terminates)
      WAGE_DEMAND_BASE: 1.0, // wage demand = marketWage * BASE …
      WAGE_AMBITION_K: 0.12, // … * (1 + AMBITION_K*(value-70)/30) (stars want a premium)
      WAGE_SUITOR_K: 0.10, // an attractive suitor talks the demand down a touch; a weak one pays over
      BUY_BUDGET_FRACTION: 0.55, // a club will spend at most this fraction of its budget on a single fee
      ROLE_NEED_BONUS: 6, // value points added to a target that fills a missing role (smarter AI roster-building)
      PREFER_MARGIN: 4, // a player only forces a move if a suitor is this much more desirable than their current club

      // ---- free-agency-first buying (offseason/transfers.js: bestUpgradeBid) ----
      // A free agent costs no fee and no roster makeweight, so the AI must exhaust the
      // free pool before spending. These knobs encode "sign value for free before paying
      // for it": (1) a CONTRACTED target must beat the best free-agent upgrade by
      // FA_PREFER_MARGIN lineup-value points to justify a fee — otherwise take the free
      // agent; (2) clubs pay a fee only for players UNDER FEE_MAX_AGE (youth/prime
      // assets, never decliners — a veteran still signs FREE, this gates only paid buys);
      // (3) when the best target is a free agent the pull-the-trigger chance is lifted by
      // FREE_SIGN_TRIGGER_BONUS so a strong free agent who fills a need is signed PROMPTLY,
      // not stranded for seasons.
      FA_PREFER_MARGIN: 4, // contracted (fee) target must beat the best free-agent upgrade by this to be worth a fee
      FEE_MAX_AGE: 31, // clubs pay a transfer FEE only for players under this age (no fees for decliners)
      FREE_SIGN_TRIGGER_BONUS: 0.4, // + this to the trigger chance when the best target is a free agent (prompt signings)

      // ---- war-chest spending (anti-hoarding) ----
      // Problem: strong clubs almost never clear UPGRADE_MARGIN (their worst starter
      // already beats most targets) and budget barely feeds any decision, so prize +
      // sponsor surplus balloons into idle millions. spendPressure(team) = clamp(
      // (budget - WARCHEST_REF) / WARCHEST_SPAN, 0, 1) makes a CASH-RICH club deploy
      // its reserve: it chases smaller upgrades, pulls the trigger more often, spends a
      // bigger share on a fee, runs extra passes, and OVERPAYS wages to win bidding
      // wars (a conserved future sink — applySeasonEconomy then drains the heavier wage
      // bill, so surplus self-corrects). Fees still flow full buyer→seller (no minting).
      WARCHEST_REF: 2500000, // budget above which spend-pressure starts ramping ($2.5M)
      WARCHEST_SPAN: 4000000, // pressure reaches 1.0 this far above the ref ($6.5M budget)
      WARCHEST_MARGIN_RELIEF: 4, // at full pressure, effective UPGRADE_MARGIN drops by this many value pts
      WARCHEST_TRIGGER_BONUS: 0.35, // + this * pressure to the pull-the-trigger chance
      WARCHEST_FRACTION_BONUS: 0.30, // + this * pressure to BUY_BUDGET_FRACTION (flush clubs commit more per fee)
      WARCHEST_PASSES_BONUS: 2, // + round(this * pressure) extra buy passes for a flush club
      OVERPAY_MAX: 1.45 // a flush club offers up to this * marketWage to out-bid rivals (≤ ATTRACT.WAGE_RATIO_CAP)
    }
  }
});
