/**
 * data/seed/pacific.js — VCT Pacific league seed fixture (Phase 1 test fixture).
 *
 * NOTE: These rosters are editable approximations assembled for engine testing
 * only. Handles, roles, nationalities and attribute spreads are best-known /
 * plausible values — NOT an authoritative 2026 roster — and are meant to be
 * refined later (Phase 4 fills the full, verified data). Stars sit ~80-90,
 * role players ~70-80; IGLs carry elevated gameSense + igl. Numbers are varied
 * per player to keep the spread realistic rather than uniform.
 *
 * Shape (CONTRACTS §13): PACIFIC_SEED = { league, teams:[...], players:[...] }.
 *  - `league`  : a partial League ({ id, name, region, teamIds }).
 *  - `teams`   : partial Team objects ({ id, name, tag, leagueId, roster:[playerId] }).
 *  - `players` : partial Player objects ({ id, name, handle, nationality, age,
 *                role, attributes, contract:{ teamId } }).
 * Every partial normalizes cleanly through createTeam / createPlayer from domain.
 *
 * Roles use the four agent role buckets plus a coarse on-server job:
 *  Duelist | Initiator | Controller | Sentinel  (matches AGENTS roles).
 * IGL is captured via attributes.igl (an IGL also has a role above).
 */

/**
 * Build a partial Player. Terse on purpose — createPlayer fills the rest.
 * @param {string} teamId
 * @param {string} id
 * @param {string} handle
 * @param {string} nationality  ISO-ish country label
 * @param {number} age
 * @param {'Duelist'|'Initiator'|'Controller'|'Sentinel'} role
 * @param {import('../../domain/player.js').Attributes} attributes
 * @param {string} [name]  real name when known
 * @returns {object}
 */
function player(teamId, id, handle, nationality, age, role, attributes, name = handle) {
  return {
    id,
    name,
    handle,
    nationality,
    age,
    role,
    attributes,
    contract: { teamId }
  };
}

/**
 * Attribute helper: spells out the nine attributes positionally to keep the
 * roster table compact and readable.
 * @returns {import('../../domain/player.js').Attributes}
 */
function attr(aim, movement, reaction, composure, consistency, gameSense, utility, trading, igl) {
  return { aim, movement, reaction, composure, consistency, gameSense, utility, trading, igl };
}

/* ------------------------------------------------------------------ *
 *  TEAMS  (id, name, tag) — VCT Pacific partner roster
 * ------------------------------------------------------------------ */

/** @type {{ id:string, name:string, tag:string }[]} */
const TEAM_META = [
  { id: 'drx', name: 'DRX', tag: 'DRX' },
  { id: 'geng', name: 'Gen.G', tag: 'GENG' },
  { id: 'prx', name: 'Paper Rex', tag: 'PRX' },
  { id: 't1', name: 'T1', tag: 'T1' },
  { id: 'ts', name: 'Team Secret', tag: 'TS' },
  { id: 'rrq', name: 'Rex Regum Qeon', tag: 'RRQ' },
  { id: 'ge', name: 'Global Esports', tag: 'GE' },
  { id: 'talon', name: 'Talon Esports', tag: 'TLN' },
  { id: 'zeta', name: 'ZETA DIVISION', tag: 'ZETA' },
  { id: 'dfm', name: 'DetonatioN FocusMe', tag: 'DFM' },
  { id: 'ns', name: 'Nongshim RedForce', tag: 'NS' },
  { id: 'bleed', name: 'BLEED', tag: 'BLD' }
];

/* ------------------------------------------------------------------ *
 *  PLAYERS  (5 per team)
 *  attr(aim, movement, reaction, composure, consistency, gameSense, utility, trading, igl)
 * ------------------------------------------------------------------ */

/** @type {object[]} */
const PLAYERS = [
  // --- DRX (KR) -----------------------------------------------------
  player('drx', 'drx_buzz', 'BuZz', 'KR', 24, 'Duelist', attr(89, 86, 85, 80, 82, 78, 70, 84, 40), 'Yu Byung-chul'),
  player('drx', 'drx_mako', 'MaKo', 'KR', 24, 'Controller', attr(80, 78, 80, 84, 83, 88, 86, 79, 78), 'Kim Myeong-kwan'),
  player('drx', 'drx_zest', 'Zest', 'KR', 26, 'Initiator', attr(81, 79, 82, 86, 85, 90, 84, 80, 88), 'Kim Gi-seok'),
  player('drx', 'drx_flashback', 'Flashback', 'KR', 23, 'Sentinel', attr(82, 78, 81, 80, 80, 80, 83, 78, 45), 'Lee Myeong-gi'),
  player('drx', 'drx_hyeon', 'HYEON', 'KR', 21, 'Initiator', attr(85, 84, 84, 76, 78, 76, 79, 81, 38), 'Yu Hyeon'),

  // --- Gen.G (KR) ---------------------------------------------------
  player('geng', 'geng_meteor', 'Meteor', 'KR', 22, 'Duelist', attr(90, 88, 86, 79, 83, 77, 70, 85, 36), 'Kim Tae-O'),
  player('geng', 'geng_lakia', 'Lakia', 'KR', 25, 'Initiator', attr(84, 81, 83, 82, 82, 84, 83, 82, 60), 'Kim Jong-min'),
  player('geng', 'geng_t3xture', 't3xture', 'KR', 22, 'Duelist', attr(88, 85, 85, 80, 81, 79, 72, 83, 42), 'Kim Na-ra'),
  player('geng', 'geng_karon', 'Karon', 'KR', 22, 'Controller', attr(80, 79, 80, 83, 82, 85, 85, 79, 70), 'Kim Won-tae'),
  player('geng', 'geng_munchkin', 'Munchkin', 'KR', 28, 'Sentinel', attr(82, 76, 80, 85, 84, 87, 82, 78, 84), 'Byeon Sang-beom'),

  // --- Paper Rex (SG/ID/MY) ----------------------------------------
  player('prx', 'prx_f0rsaken', 'f0rsakeN', 'SG', 23, 'Duelist', attr(90, 89, 87, 81, 82, 80, 72, 86, 44), 'Jason Susanto'),
  player('prx', 'prx_something', 'something', 'MY', 23, 'Duelist', attr(91, 90, 86, 78, 79, 75, 68, 84, 35), 'Ilya Petrov'),
  player('prx', 'prx_d4v41', 'd4v41', 'ID', 22, 'Sentinel', attr(84, 82, 82, 80, 81, 82, 83, 80, 50), 'Khalish Rusyaidee'),
  player('prx', 'prx_jinggg', 'Jinggg', 'MY', 22, 'Duelist', attr(89, 88, 85, 79, 80, 76, 70, 83, 38), 'Wang Jing Jie'),
  player('prx', 'prx_mindfreak', 'mindfreak', 'ID', 24, 'Controller', attr(80, 78, 79, 84, 83, 87, 86, 78, 80), 'Aaron Leonardo'),

  // --- T1 (KR/intl) ------------------------------------------------
  player('t1', 't1_sayaplayer', 'Sayaplayer', 'KR', 27, 'Duelist', attr(87, 84, 84, 80, 80, 79, 71, 82, 40), 'Ha Jeong-woo'),
  player('t1', 't1_meteor', 'Carpe', 'KR', 28, 'Initiator', attr(84, 81, 83, 83, 83, 85, 82, 81, 62), 'Lee Jae-hyeok'),
  player('t1', 't1_iztacx', 'iZu', 'KR', 24, 'Controller', attr(80, 78, 80, 83, 82, 84, 85, 78, 66), 'Yoon Joon'),
  player('t1', 't1_sylvan', 'Sylvan', 'KR', 23, 'Initiator', attr(83, 81, 82, 79, 80, 80, 81, 80, 44), 'Kim Joon-hyung'),
  player('t1', 't1_xand', 'xand', 'BR', 25, 'Sentinel', attr(82, 78, 80, 82, 81, 83, 82, 78, 70), 'Alexandre Zizou'),

  // --- Team Secret (PH) --------------------------------------------
  player('ts', 'ts_jremy', 'JessieVash', 'PH', 27, 'Duelist', attr(86, 84, 83, 80, 80, 80, 71, 81, 48), 'Jim Nigel Gunnell'),
  player('ts', 'ts_dubsteff', 'DubsteP', 'PH', 26, 'Initiator', attr(82, 80, 81, 84, 82, 86, 83, 80, 82), 'Jayvee Paguirigan'),
  player('ts', 'ts_invy', 'Invy', 'PH', 24, 'Controller', attr(81, 79, 80, 82, 81, 83, 84, 79, 60), 'Emmanuel Sard'),
  player('ts', 'ts_borkum', 'BORKUM', 'PH', 23, 'Sentinel', attr(83, 80, 81, 79, 80, 80, 82, 79, 46), 'Adrian Castillo'),
  player('ts', 'ts_witz', 'Witz', 'PH', 24, 'Initiator', attr(84, 82, 82, 78, 79, 78, 80, 81, 40), 'Jayvin Aldovino'),

  // --- Rex Regum Qeon (ID) -----------------------------------------
  player('rrq', 'rrq_estrella', 'Esterа', 'ID', 23, 'Duelist', attr(86, 85, 84, 79, 80, 78, 70, 82, 42), 'Adrianus Bagas'),
  player('rrq', 'rrq_2ge', 'xffero', 'ID', 24, 'Initiator', attr(83, 81, 82, 82, 82, 84, 82, 81, 64), 'Muhammad Gymnastiar'),
  player('rrq', 'rrq_jemkin', 'Jemkin', 'ID', 22, 'Duelist', attr(85, 84, 83, 78, 79, 77, 71, 81, 38), 'Made Bagas'),
  player('rrq', 'rrq_lmemore', 'Lmemore', 'ID', 23, 'Controller', attr(80, 78, 80, 83, 82, 85, 85, 78, 72), 'Saibani Rahmad'),
  player('rrq', 'rrq_demonkite', 'DG', 'ID', 25, 'Sentinel', attr(81, 78, 80, 84, 82, 86, 83, 78, 80), 'David Monangin'),

  // --- Global Esports (IN/intl) ------------------------------------
  player('ge', 'ge_monyet', 'Monyet', 'ID', 22, 'Duelist', attr(85, 84, 83, 77, 78, 75, 69, 80, 36), 'Habib Hidayat'),
  player('ge', 'ge_skrossi', 'SkRossi', 'IN', 26, 'Duelist', attr(86, 83, 84, 80, 80, 80, 71, 81, 50), 'Ganesh Gangadhar'),
  player('ge', 'ge_zenitsu', 'Zenitsu', 'IN', 23, 'Initiator', attr(81, 79, 80, 81, 80, 82, 81, 79, 58), 'Akshay Sawant'),
  player('ge', 'ge_t3xx', 'Surya', 'IN', 22, 'Controller', attr(78, 77, 78, 81, 80, 82, 83, 77, 62), 'Surya Prakash'),
  player('ge', 'ge_lightningfast', 'Lightningfast', 'IN', 23, 'Sentinel', attr(80, 77, 79, 80, 79, 81, 81, 77, 55), 'Abhirup Choudhury'),

  // --- Talon Esports (TH/intl) -------------------------------------
  player('talon', 'talon_jitboys', 'JitboyS', 'TH', 24, 'Duelist', attr(86, 85, 84, 79, 80, 78, 70, 82, 40), 'Itthirit Ngamsaard'),
  player('talon', 'talon_garnett', 'Garnett', 'AU', 23, 'Initiator', attr(83, 81, 82, 81, 81, 83, 82, 80, 56), 'Patrick Praphan'),
  player('talon', 'talon_crws', 'crws', 'TH', 26, 'Controller', attr(81, 79, 80, 84, 83, 86, 85, 79, 84), 'Nutchaphon Matarat'),
  player('talon', 'talon_sushiboys', 'sushiboys', 'TH', 23, 'Sentinel', attr(82, 79, 81, 80, 80, 81, 82, 79, 46), 'Pongsakorn Atimakul'),
  player('talon', 'talon_patiphan', 'Patiphan', 'TH', 23, 'Duelist', attr(88, 86, 85, 79, 80, 79, 71, 83, 42), 'Patiphan Posri'),

  // --- ZETA DIVISION (JP) ------------------------------------------
  player('zeta', 'zeta_dep', 'Dep', 'JP', 24, 'Duelist', attr(88, 86, 85, 80, 81, 79, 71, 83, 42), 'Yuma Hashimoto'),
  player('zeta', 'zeta_laz', 'Laz', 'JP', 28, 'Sentinel', attr(82, 78, 81, 86, 85, 89, 83, 79, 90), 'Koji Ushida'),
  player('zeta', 'zeta_crow', 'crow', 'JP', 25, 'Controller', attr(81, 79, 80, 84, 83, 86, 85, 79, 74), 'Tenta Asai'),
  player('zeta', 'zeta_sugarz3ro', 'SugarZ3ro', 'JP', 23, 'Initiator', attr(83, 81, 82, 80, 81, 81, 82, 80, 50), 'Shota Watanabe'),
  player('zeta', 'zeta_tonbo', 'TONBO', 'JP', 23, 'Initiator', attr(82, 80, 81, 79, 80, 80, 81, 80, 44), 'Naoto Hattori'),

  // --- DetonatioN FocusMe (JP) -------------------------------------
  player('dfm', 'dfm_anchovy', 'Anchovy', 'JP', 24, 'Duelist', attr(84, 83, 82, 78, 78, 77, 69, 80, 38), 'Yota Aoki'),
  player('dfm', 'dfm_meiy', 'Meiy', 'BR', 25, 'Initiator', attr(82, 80, 81, 81, 81, 83, 82, 80, 66), 'Felipe Olivieri'),
  player('dfm', 'dfm_suzu', 'Suzu', 'JP', 22, 'Duelist', attr(85, 84, 83, 77, 78, 76, 70, 80, 36), 'Suzuki Kaito'),
  player('dfm', 'dfm_reita', 'Reita', 'JP', 26, 'Sentinel', attr(80, 77, 79, 83, 82, 85, 82, 77, 78), 'Koyama Yuhi'),
  player('dfm', 'dfm_xnfri', 'xnfri', 'NO', 24, 'Controller', attr(80, 78, 79, 82, 81, 83, 84, 78, 60), 'Andreas Frijhon'),

  // --- Nongshim RedForce (KR) --------------------------------------
  player('ns', 'ns_allow', 'Allow', 'KR', 22, 'Duelist', attr(85, 84, 83, 78, 79, 77, 70, 80, 38), 'Park Sang-wook'),
  player('ns', 'ns_jereuni', 'JEREUNI', 'KR', 23, 'Initiator', attr(82, 80, 81, 81, 81, 83, 82, 80, 62), 'Jeong Won-tae'),
  player('ns', 'ns_lewn', 'Lewn', 'KR', 22, 'Controller', attr(81, 79, 80, 82, 81, 83, 84, 79, 58), 'Park Jeong-hwan'),
  player('ns', 'ns_peri', 'peri', 'KR', 24, 'Sentinel', attr(82, 79, 80, 83, 82, 85, 82, 78, 80), 'Kim Hyeong-jun'),
  player('ns', 'ns_ymre', 'YMre', 'KR', 21, 'Initiator', attr(84, 82, 82, 77, 78, 77, 80, 81, 40), 'Choi Yong-min'),

  // --- BLEED (SG/intl) ---------------------------------------------
  player('bleed', 'bleed_deryeon', 'Deryeon', 'KR', 23, 'Duelist', attr(85, 84, 83, 78, 79, 77, 70, 80, 38), 'Kang Min-gyu'),
  player('bleed', 'bleed_juicy', 'Juicy', 'SG', 24, 'Initiator', attr(82, 80, 81, 81, 81, 83, 82, 80, 64), 'Daryl Koh'),
  player('bleed', 'bleed_yume', 'yMe', 'KR', 22, 'Controller', attr(81, 79, 80, 82, 81, 83, 84, 79, 56), 'Kim Tae-yeop'),
  player('bleed', 'bleed_sayonara', 'sayonara', 'KR', 25, 'Sentinel', attr(82, 79, 80, 83, 82, 85, 82, 78, 78), 'Han Gyeong-min'),
  player('bleed', 'bleed_retla', 'Retla', 'ID', 23, 'Duelist', attr(86, 85, 84, 78, 79, 77, 70, 81, 36), 'Reza Pratama')
];

/* ------------------------------------------------------------------ *
 *  Assemble teams (roster = ids of that team's 5 players, in listed order)
 * ------------------------------------------------------------------ */

/** @type {object[]} */
const TEAMS = TEAM_META.map((meta) => ({
  id: meta.id,
  name: meta.name,
  tag: meta.tag,
  leagueId: 'pacific',
  roster: PLAYERS.filter((p) => p.contract.teamId === meta.id).map((p) => p.id)
}));

/** @type {object} */
const LEAGUE = {
  id: 'pacific',
  name: 'VCT Pacific',
  region: 'pacific',
  teamIds: TEAM_META.map((t) => t.id)
};

/**
 * PACIFIC_SEED — Phase 1 test fixture (CONTRACTS §13).
 * @type {{ league: object, teams: object[], players: object[] }}
 */
export const PACIFIC_SEED = {
  league: LEAGUE,
  teams: TEAMS,
  players: PLAYERS
};
