/**
 * data/seed/china.js — VCT China league seed fixture (CONTRACTS-SEASON §1).
 *
 * NOTE: These rosters are editable approximations assembled for engine testing
 * only. Handles, roles, nationalities and attribute spreads are best-known /
 * plausible values — NOT an authoritative 2026 roster — and are meant to be
 * refined later. Stars sit ~80-90, role players ~70-80; IGLs carry elevated
 * gameSense + igl. Numbers are varied per player to keep the spread realistic
 * rather than uniform; region strength is non-uniform (EDG/BLG/TES run hotter,
 * smaller orgs sit a touch lower).
 *
 * Shape (CONTRACTS-SEASON §1): CHINA_SEED = { league, teams:[12], players:[60] }.
 *  - `league`  : a partial League ({ id, name, region, teamIds }).
 *  - `teams`   : partial Team objects ({ id, name, tag, leagueId, roster:[playerId] }).
 *  - `players` : partial Player objects ({ id, name, handle, nationality, age,
 *                role, attributes, contract:{ teamId } }).
 * Every partial normalizes cleanly through createTeam / createPlayer from domain.
 *
 * Ids are globally unique across regions via the `cn-` prefix (e.g. cn-edg,
 * cn-blg); players namespace under their team id (e.g. cn-edg-zmjjkk).
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
 *  TEAMS  (id, name, tag) — VCT China partner roster
 * ------------------------------------------------------------------ */

/** @type {{ id:string, name:string, tag:string }[]} */
const TEAM_META = [
  { id: 'cn-edg', name: 'EDward Gaming', tag: 'EDG' },
  { id: 'cn-blg', name: 'Bilibili Gaming', tag: 'BLG' },
  { id: 'cn-fpx', name: 'FunPlus Phoenix', tag: 'FPX' },
  { id: 'cn-te', name: 'Trace Esports', tag: 'TE' },
  { id: 'cn-wolves', name: 'Wolves Esports', tag: 'WOL' },
  { id: 'cn-drg', name: 'Dragon Ranger Gaming', tag: 'DRG' },
  { id: 'cn-nova', name: 'Nova Esports', tag: 'NOVA' },
  { id: 'cn-tec', name: 'Titan Esports Club', tag: 'TEC' },
  { id: 'cn-xlg', name: 'Xi Lai Gaming', tag: 'XLG' },
  { id: 'cn-ag', name: 'All Gamers', tag: 'AG' },
  { id: 'cn-tyloo', name: 'TYLOO', tag: 'TYL' },
  { id: 'cn-jdg', name: 'JD Gaming', tag: 'JDG' }
];

/* ------------------------------------------------------------------ *
 *  PLAYERS  (5 per team)
 *  attr(aim, movement, reaction, composure, consistency, gameSense, utility, trading, igl)
 * ------------------------------------------------------------------ */

/** @type {object[]} */
const PLAYERS = [
  // --- EDward Gaming (CN) — top tier --------------------------------
  player('cn-edg', 'cn-edg-zmjjkk', 'ZmjjKK', 'CN', 23, 'Duelist', attr(91, 89, 87, 81, 84, 80, 71, 86, 40), 'Zheng Yongkang'),
  player('cn-edg', 'cn-edg-cherryzong', 'CHICHOO', 'CN', 24, 'Initiator', attr(84, 82, 83, 83, 83, 86, 84, 82, 66), 'Zhang Zhao'),
  player('cn-edg', 'cn-edg-haodong', 'Haodong', 'CN', 24, 'Controller', attr(82, 80, 81, 84, 84, 87, 86, 80, 78), 'Guo Haodong'),
  player('cn-edg', 'cn-edg-nobody', 'nobody', 'CN', 22, 'Sentinel', attr(83, 80, 82, 82, 83, 84, 84, 80, 50), 'Wang Senxu'),
  player('cn-edg', 'cn-edg-smoggy', 'Smoggy', 'CN', 23, 'Initiator', attr(85, 83, 83, 79, 81, 81, 82, 83, 44), 'Zhang Zhihao'),

  // --- Bilibili Gaming (CN) — top tier ------------------------------
  player('cn-blg', 'cn-blg-whzy', 'whzy', 'CN', 22, 'Duelist', attr(90, 88, 86, 80, 82, 78, 70, 85, 38), 'Wang Haozhe'),
  player('cn-blg', 'cn-blg-aoli', 'aoli', 'CN', 23, 'Initiator', attr(84, 82, 82, 82, 82, 84, 83, 82, 60), 'Ao Li'),
  player('cn-blg', 'cn-blg-biank', 'BiaNK', 'CN', 24, 'Controller', attr(81, 79, 80, 84, 83, 86, 85, 79, 74), 'Lu Bochuan'),
  player('cn-blg', 'cn-blg-elISa', 'elISa', 'CN', 23, 'Sentinel', attr(82, 80, 81, 83, 82, 85, 83, 79, 70), 'Zhang Yuhang'),
  player('cn-blg', 'cn-blg-yueyue', 'Yueyue', 'CN', 22, 'Duelist', attr(87, 85, 84, 79, 80, 78, 71, 83, 40), 'Yang Yue'),

  // --- FunPlus Phoenix (CN) — top tier ------------------------------
  player('cn-fpx', 'cn-fpx-bestone', 'BerLIN', 'CN', 23, 'Duelist', attr(89, 87, 85, 80, 81, 79, 70, 84, 40), 'Li Boqing'),
  player('cn-fpx', 'cn-fpx-life', 'Life', 'CN', 24, 'Initiator', attr(84, 82, 82, 82, 82, 85, 83, 81, 64), 'Zhang Yingjie'),
  player('cn-fpx', 'cn-fpx-doggg', 'Doggg', 'CN', 23, 'Controller', attr(82, 80, 81, 84, 83, 86, 85, 80, 72), 'Sun Junhao'),
  player('cn-fpx', 'cn-fpx-zhang', 'whz', 'CN', 22, 'Sentinel', attr(83, 80, 81, 82, 82, 84, 83, 79, 52), 'Wu Hongzhe'),
  player('cn-fpx', 'cn-fpx-cae', 'Cae', 'CN', 23, 'Initiator', attr(85, 83, 83, 79, 80, 80, 81, 82, 46), 'Chen Aoen'),

  // --- Trace Esports (CN) -------------------------------------------
  player('cn-te', 'cn-te-yog', 'YoG', 'CN', 23, 'Duelist', attr(88, 86, 84, 79, 80, 78, 70, 83, 40), 'Yu Guangrui'),
  player('cn-te', 'cn-te-cw', 'CW', 'CN', 24, 'Initiator', attr(83, 81, 81, 81, 81, 84, 82, 80, 62), 'Chen Wei'),
  player('cn-te', 'cn-te-lysoar', 'Lysoar', 'CN', 23, 'Controller', attr(81, 79, 80, 83, 82, 85, 84, 79, 70), 'Liu Yang'),
  player('cn-te', 'cn-te-chao', 'Chao', 'CN', 22, 'Sentinel', attr(82, 79, 80, 82, 81, 83, 83, 78, 50), 'Chao Junjie'),
  player('cn-te', 'cn-te-91', '91', 'CN', 23, 'Initiator', attr(84, 82, 82, 78, 79, 79, 80, 81, 44), 'Li Jiawei'),

  // --- Wolves Esports (CN) ------------------------------------------
  player('cn-wolves', 'cn-wolves-suei', 'Suei', 'CN', 24, 'Duelist', attr(87, 85, 84, 79, 80, 78, 70, 82, 40), 'Sun Wei'),
  player('cn-wolves', 'cn-wolves-cwzeNN', 'cwzeNN', 'CN', 23, 'Initiator', attr(83, 81, 81, 81, 81, 83, 82, 80, 60), 'Cao Wenzhi'),
  player('cn-wolves', 'cn-wolves-paperr', 'PaperR', 'CN', 22, 'Controller', attr(81, 79, 80, 83, 82, 84, 84, 79, 66), 'Pan Yu'),
  player('cn-wolves', 'cn-wolves-iso', 'iso', 'CN', 23, 'Sentinel', attr(82, 79, 80, 82, 81, 83, 82, 78, 48), 'Yang Yuhao'),
  player('cn-wolves', 'cn-wolves-zix111', 'ZIXIN', 'CN', 22, 'Initiator', attr(84, 82, 82, 78, 79, 78, 80, 81, 44), 'Wang Zixin'),

  // --- Dragon Ranger Gaming (CN) ------------------------------------
  player('cn-drg', 'cn-drg-leaves', 'Lev', 'CN', 23, 'Duelist', attr(87, 85, 84, 78, 79, 77, 69, 82, 38), 'Liu Hongwei'),
  player('cn-drg', 'cn-drg-vc', 'V', 'CN', 24, 'Initiator', attr(82, 80, 81, 81, 81, 83, 82, 80, 62), 'Wang Bingchen'),
  player('cn-drg', 'cn-drg-akng', 'akng', 'CN', 23, 'Controller', attr(81, 79, 80, 82, 82, 84, 84, 79, 64), 'Ao Kang'),
  player('cn-drg', 'cn-drg-burton', 'Burton', 'CN', 22, 'Sentinel', attr(81, 78, 80, 82, 81, 83, 82, 78, 50), 'Bu Tao'),
  player('cn-drg', 'cn-drg-gondol', 'Gondol', 'CN', 23, 'Initiator', attr(83, 81, 81, 78, 79, 78, 80, 80, 42), 'Gong Dong'),

  // --- Nova Esports (CN) --------------------------------------------
  player('cn-nova', 'cn-nova-pingg', 'Pingg', 'CN', 23, 'Duelist', attr(86, 84, 83, 78, 79, 77, 69, 81, 38), 'Ping Guo'),
  player('cn-nova', 'cn-nova-cao', 'Caodd', 'CN', 24, 'Initiator', attr(82, 80, 80, 81, 80, 83, 81, 79, 60), 'Cao Dada'),
  player('cn-nova', 'cn-nova-rea', 'ReaL', 'CN', 23, 'Controller', attr(80, 78, 79, 82, 81, 83, 83, 78, 62), 'Ren Lei'),
  player('cn-nova', 'cn-nova-marshall', 'Marshall', 'CN', 22, 'Sentinel', attr(81, 78, 79, 81, 80, 82, 82, 78, 48), 'Ma Xiaoshan'),
  player('cn-nova', 'cn-nova-lihao', 'lihao', 'CN', 23, 'Initiator', attr(83, 81, 81, 77, 78, 77, 79, 80, 42), 'Li Hao'),

  // --- Titan Esports Club (CN) --------------------------------------
  player('cn-tec', 'cn-tec-bushy', 'Bushy', 'CN', 23, 'Duelist', attr(86, 84, 83, 78, 80, 78, 70, 82, 40), 'Bu Shengyuan'),
  player('cn-tec', 'cn-tec-jiaoz', 'JiaoZ', 'CN', 24, 'Initiator', attr(82, 80, 81, 81, 81, 83, 82, 80, 62), 'Jiao Zhi'),
  player('cn-tec', 'cn-tec-ann', 'ANN', 'CN', 23, 'Controller', attr(81, 79, 80, 82, 82, 84, 84, 79, 64), 'An Nan'),
  player('cn-tec', 'cn-tec-zer0', 'zer0', 'CN', 22, 'Sentinel', attr(81, 78, 80, 82, 81, 83, 82, 78, 48), 'Zhao Yuhao'),
  player('cn-tec', 'cn-tec-quan', 'Quan', 'CN', 23, 'Initiator', attr(83, 81, 81, 77, 78, 78, 80, 80, 44), 'Quan Lei'),

  // --- Xi Lai Gaming (CN) -------------------------------------------
  player('cn-xlg', 'cn-xlg-kangkang', 'KangKang', 'CN', 23, 'Duelist', attr(86, 84, 83, 78, 79, 77, 69, 81, 38), 'Wang Kang'),
  player('cn-xlg', 'cn-xlg-saber', 'Saber', 'CN', 24, 'Initiator', attr(82, 80, 80, 81, 80, 83, 81, 79, 60), 'Shi Bo'),
  player('cn-xlg', 'cn-xlg-juepao', 'JuePao', 'CN', 23, 'Controller', attr(80, 78, 79, 82, 81, 83, 83, 78, 62), 'Jue Pao'),
  player('cn-xlg', 'cn-xlg-bemce', 'Bemce', 'CN', 22, 'Sentinel', attr(81, 78, 79, 81, 80, 82, 82, 78, 48), 'Bai Mengce'),
  player('cn-xlg', 'cn-xlg-lone', 'Lone', 'CN', 23, 'Initiator', attr(83, 81, 81, 77, 78, 77, 79, 80, 42), 'Long En'),

  // --- All Gamers (CN) ----------------------------------------------
  player('cn-ag', 'cn-ag-w1ndy', 'w1ndy', 'CN', 23, 'Duelist', attr(85, 83, 82, 78, 79, 77, 69, 81, 38), 'Wen Di'),
  player('cn-ag', 'cn-ag-eros', 'Eros', 'CN', 24, 'Initiator', attr(82, 80, 80, 81, 80, 83, 81, 79, 60), 'Er Le'),
  player('cn-ag', 'cn-ag-haku', 'Haku', 'CN', 23, 'Controller', attr(80, 78, 79, 82, 81, 83, 83, 78, 62), 'He Ku'),
  player('cn-ag', 'cn-ag-attacker', 'Attacker', 'CN', 22, 'Sentinel', attr(81, 78, 79, 81, 80, 82, 82, 78, 48), 'A Tai'),
  player('cn-ag', 'cn-ag-cest', 'CEST', 'CN', 23, 'Initiator', attr(82, 80, 81, 77, 78, 77, 79, 80, 42), 'Chen Sheng'),

  // --- TYLOO (CN) ---------------------------------------------------
  player('cn-tyloo', 'cn-tyloo-shion', 'Shion', 'CN', 24, 'Duelist', attr(86, 84, 83, 79, 80, 78, 70, 82, 40), 'Shi Ang'),
  player('cn-tyloo', 'cn-tyloo-autumn', 'autumn', 'CN', 23, 'Initiator', attr(82, 80, 81, 81, 81, 83, 82, 80, 60), 'Qiu Tian'),
  player('cn-tyloo', 'cn-tyloo-summer', 'summ', 'CN', 23, 'Controller', attr(81, 79, 80, 82, 82, 84, 84, 79, 64), 'Xia Yang'),
  player('cn-tyloo', 'cn-tyloo-bigboss', 'BigBoss', 'CN', 25, 'Sentinel', attr(81, 78, 80, 83, 82, 85, 82, 78, 72), 'Bo Si'),
  player('cn-tyloo', 'cn-tyloo-junior', 'Junior', 'CN', 21, 'Initiator', attr(84, 82, 82, 77, 78, 77, 79, 81, 40), 'Jun Ri'),

  // --- JD Gaming (CN) -----------------------------------------------
  player('cn-jdg', 'cn-jdg-vincent', 'Vincent', 'CN', 23, 'Duelist', attr(86, 84, 83, 78, 79, 77, 69, 81, 38), 'Wen Sen'),
  player('cn-jdg', 'cn-jdg-roya', 'Roya', 'CN', 24, 'Initiator', attr(82, 80, 80, 81, 80, 83, 81, 79, 60), 'Ruo Ya'),
  player('cn-jdg', 'cn-jdg-luo', 'Luo', 'CN', 23, 'Controller', attr(80, 78, 79, 82, 81, 83, 83, 78, 62), 'Luo Han'),
  player('cn-jdg', 'cn-jdg-kait', 'Kait', 'CN', 22, 'Sentinel', attr(81, 78, 79, 81, 80, 82, 82, 78, 48), 'Kai Te'),
  player('cn-jdg', 'cn-jdg-feb', 'Feb', 'CN', 23, 'Initiator', attr(82, 80, 81, 77, 78, 77, 79, 80, 42), 'Fei Bo')
];

/* ------------------------------------------------------------------ *
 *  Assemble teams (roster = ids of that team's 5 players, in listed order)
 * ------------------------------------------------------------------ */

/** @type {object[]} */
const TEAMS = TEAM_META.map((meta) => ({
  id: meta.id,
  name: meta.name,
  tag: meta.tag,
  leagueId: 'china',
  roster: PLAYERS.filter((p) => p.contract.teamId === meta.id).map((p) => p.id)
}));

/** @type {object} */
const LEAGUE = {
  id: 'china',
  name: 'VCT China',
  region: 'china',
  teamIds: TEAM_META.map((t) => t.id)
};

/**
 * CHINA_SEED — VCT China league seed fixture (CONTRACTS-SEASON §1).
 * @type {{ league: object, teams: object[], players: object[] }}
 */
export const CHINA_SEED = {
  league: LEAGUE,
  teams: TEAMS,
  players: PLAYERS
};
