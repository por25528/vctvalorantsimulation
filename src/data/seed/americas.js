/**
 * data/seed/americas.js — VCT Americas league seed fixture (CONTRACTS-SEASON §1).
 *
 * NOTE: These rosters are editable approximations assembled for engine testing
 * only. Handles, roles, nationalities and attribute spreads are best-known /
 * plausible values — NOT an authoritative 2026 roster — and are meant to be
 * refined later. Stars sit ~82-90, role players ~70-80; IGLs carry elevated
 * gameSense + igl. Numbers are varied per player to keep the spread realistic
 * rather than uniform. Americas is tuned as a STRONG region overall.
 *
 * Shape (CONTRACTS-SEASON §1): AMERICAS_SEED = { league, teams:[12], players:[60] }.
 *  - `league`  : a partial League ({ id, name, region, teamIds }).
 *  - `teams`   : partial Team objects ({ id, name, tag, leagueId, roster:[playerId] }).
 *  - `players` : partial Player objects ({ id, name, handle, nationality, age,
 *                role, attributes, contract:{ teamId } }).
 * Every partial normalizes cleanly through createTeam / createPlayer from domain.
 *
 * Team ids are globally unique via the `na-` prefix (e.g. na-sen, na-nrg).
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
 *  TEAMS  (id, name, tag) — VCT Americas partner roster
 * ------------------------------------------------------------------ */

/** @type {{ id:string, name:string, tag:string }[]} */
const TEAM_META = [
  { id: 'na-sen', name: 'Sentinels', tag: 'SEN' },
  { id: 'na-nrg', name: 'NRG', tag: 'NRG' },
  { id: 'na-loud', name: 'LOUD', tag: 'LOUD' },
  { id: 'na-100t', name: '100 Thieves', tag: '100T' },
  { id: 'na-c9', name: 'Cloud9', tag: 'C9' },
  { id: 'na-eg', name: 'Evil Geniuses', tag: 'EG' },
  { id: 'na-lev', name: 'Leviatán', tag: 'LEV' },
  { id: 'na-kru', name: 'KRÜ Esports', tag: 'KRU' },
  { id: 'na-mibr', name: 'MIBR', tag: 'MIBR' },
  { id: 'na-fur', name: 'FURIA', tag: 'FUR' },
  { id: 'na-g2', name: 'G2 Esports', tag: 'G2' },
  { id: 'na-2g', name: '2Game Esports', tag: '2G' }
];

/* ------------------------------------------------------------------ *
 *  PLAYERS  (5 per team)
 *  attr(aim, movement, reaction, composure, consistency, gameSense, utility, trading, igl)
 * ------------------------------------------------------------------ */

/** @type {object[]} */
const PLAYERS = [
  // --- Sentinels (NA/BR) -------------------------------------------
  player('na-sen', 'na-sen_tenz', 'TenZ', 'CA', 25, 'Duelist', attr(92, 90, 88, 81, 84, 80, 71, 86, 42), 'Tyson Ngo'),
  player('na-sen', 'na-sen_zekken', 'zekken', 'US', 21, 'Duelist', attr(90, 89, 87, 79, 82, 78, 72, 85, 40), 'Zachary Patrone'),
  player('na-sen', 'na-sen_johnqt', 'johnqt', 'MA', 24, 'Initiator', attr(83, 81, 82, 85, 84, 88, 84, 81, 86), 'Saif Jibraeel'),
  player('na-sen', 'na-sen_zellsis', 'Zellsis', 'US', 27, 'Initiator', attr(85, 83, 83, 82, 83, 84, 83, 84, 58), 'Jordan Montemurro'),
  player('na-sen', 'na-sen_narrate', 'N4RRATE', 'US', 22, 'Controller', attr(82, 80, 81, 83, 82, 85, 86, 80, 60), 'Nolan Pham'),

  // --- NRG (NA/intl) -----------------------------------------------
  player('na-nrg', 'na-nrg_ethan', 'Ethan', 'US', 26, 'Initiator', attr(85, 82, 83, 84, 84, 87, 84, 83, 84), 'Ethan Arnold'),
  player('na-nrg', 'na-nrg_crashies', 'crashies', 'US', 26, 'Initiator', attr(84, 82, 83, 83, 83, 85, 85, 82, 62), 'Austin Roberts'),
  player('na-nrg', 'na-nrg_ardiis', 'ardiis', 'LV', 26, 'Duelist', attr(89, 86, 86, 80, 82, 80, 71, 84, 44), 'Ardis Svarenieks'),
  player('na-nrg', 'na-nrg_brawk', 'brawk', 'US', 23, 'Controller', attr(82, 80, 81, 82, 82, 84, 86, 80, 56), 'Brock Somerhalder'),
  player('na-nrg', 'na-nrg_mada', 'mada', 'US', 21, 'Duelist', attr(88, 87, 85, 78, 80, 77, 70, 83, 38), 'Maxim Aleksandrov'),

  // --- LOUD (BR) ---------------------------------------------------
  player('na-loud', 'na-loud_aspas', 'aspas', 'BR', 22, 'Duelist', attr(93, 91, 89, 81, 85, 81, 72, 87, 46), 'Erick Santos'),
  player('na-loud', 'na-loud_saadhak', 'Saadhak', 'AR', 27, 'Initiator', attr(83, 81, 82, 86, 85, 89, 85, 82, 90), 'Matias Delipetro'),
  player('na-loud', 'na-loud_tuyz', 'tuyz', 'BR', 22, 'Controller', attr(83, 81, 82, 83, 83, 85, 86, 81, 62), 'Arthur Vieira'),
  player('na-loud', 'na-loud_qck', 'qck', 'BR', 21, 'Sentinel', attr(85, 83, 83, 81, 82, 82, 84, 82, 48), 'Felipe Marques'),
  player('na-loud', 'na-loud_cauanzin', 'cauanzin', 'BR', 21, 'Initiator', attr(86, 84, 84, 79, 81, 80, 82, 83, 44), 'Cauan Pereira'),

  // --- 100 Thieves (NA) --------------------------------------------
  player('na-100t', 'na-100t_cryo', 'Cryocells', 'US', 23, 'Duelist', attr(91, 89, 88, 80, 83, 79, 71, 85, 40), 'Matthew Panganiban'),
  player('na-100t', 'na-100t_asuna', 'Asuna', 'US', 23, 'Duelist', attr(88, 87, 85, 79, 81, 78, 71, 83, 42), 'Peter Mazuryk'),
  player('na-100t', 'na-100t_bang', 'bang', 'US', 24, 'Initiator', attr(84, 82, 82, 83, 83, 85, 84, 82, 80), 'Sean Bezerra'),
  player('na-100t', 'na-100t_eeiu', 'eeiu', 'US', 22, 'Sentinel', attr(84, 81, 82, 82, 82, 84, 84, 81, 54), 'Daniel Vucenovic'),
  player('na-100t', 'na-100t_zander', 'Zander', 'US', 22, 'Controller', attr(81, 79, 80, 82, 81, 84, 85, 80, 58), 'Alexander Dituri'),

  // --- Cloud9 (NA/KR) ----------------------------------------------
  player('na-c9', 'na-c9_oxy', 'OXY', 'US', 21, 'Duelist', attr(90, 88, 87, 79, 82, 78, 71, 84, 40), 'Mason Williams'),
  player('na-c9', 'na-c9_runi', 'runi', 'CA', 22, 'Controller', attr(82, 80, 81, 82, 82, 84, 86, 80, 56), 'Daniel Ariza'),
  player('na-c9', 'na-c9_vanity', 'vanity', 'US', 28, 'Initiator', attr(82, 80, 81, 85, 84, 88, 84, 81, 88), 'Anthony Malaspina'),
  player('na-c9', 'na-c9_immi', 'immi', 'KR', 24, 'Sentinel', attr(83, 80, 81, 83, 82, 85, 83, 80, 62), 'Daniel Cho'),
  player('na-c9', 'na-c9_moe', 'moe40', 'US', 22, 'Initiator', attr(85, 83, 83, 80, 81, 81, 82, 82, 46), 'Mohamed Hassan'),

  // --- Evil Geniuses (NA/BR) ---------------------------------------
  player('na-eg', 'na-eg_corey', 'Corey', 'US', 24, 'Duelist', attr(88, 86, 85, 79, 81, 79, 71, 83, 44), 'Corey Nigra'),
  player('na-eg', 'na-eg_supamen', 'supamen', 'US', 27, 'Initiator', attr(82, 80, 81, 83, 82, 85, 84, 81, 70), 'Michael Lan'),
  player('na-eg', 'na-eg_ellis', 'Ellis', 'US', 21, 'Sentinel', attr(84, 81, 82, 81, 81, 82, 83, 80, 48), 'Brandon Maddix'),
  player('na-eg', 'na-eg_jawgemo', 'jawgemo', 'US', 23, 'Duelist', attr(89, 87, 86, 78, 81, 78, 70, 83, 38), 'Alexander Mor'),
  player('na-eg', 'na-eg_c0m', 'C0M', 'US', 24, 'Controller', attr(81, 79, 80, 83, 82, 85, 85, 80, 64), 'Cohen Skidmore'),

  // --- Leviatán (LATAM) --------------------------------------------
  player('na-lev', 'na-lev_kingg', 'kiNgg', 'BR', 25, 'Duelist', attr(89, 87, 86, 80, 82, 80, 71, 84, 50), 'Francisco Antunes'),
  player('na-lev', 'na-lev_mazino', 'Mazino', 'CL', 24, 'Sentinel', attr(84, 81, 82, 84, 83, 86, 84, 81, 72), 'Roberto Rivas'),
  player('na-lev', 'na-lev_tex', 'tex', 'US', 25, 'Initiator', attr(85, 83, 83, 82, 83, 84, 84, 83, 60), 'Ian Botsch'),
  player('na-lev', 'na-lev_aspas2', 'C4LLM3SU3', 'BR', 22, 'Initiator', attr(84, 82, 82, 81, 82, 83, 84, 82, 52), 'Pedro Henrique'),
  player('na-lev', 'na-lev_kaajak', 'kaajak', 'AR', 23, 'Controller', attr(82, 80, 81, 82, 82, 84, 85, 80, 58), 'Nicolás Kanedo'),

  // --- KRÜ Esports (LATAM) -----------------------------------------
  player('na-kru', 'na-kru_klaus', 'Klaus', 'AR', 25, 'Duelist', attr(87, 85, 84, 80, 81, 80, 71, 83, 52), 'Nicolás Ferrari'),
  player('na-kru', 'na-kru_melser', 'Melser', 'CL', 26, 'Initiator', attr(82, 80, 81, 84, 83, 86, 84, 81, 82), 'Marco Eliot Machuca'),
  player('na-kru', 'na-kru_heat', 'heat', 'BR', 24, 'Controller', attr(82, 80, 81, 82, 82, 84, 85, 80, 56), 'Olavo Marcelo'),
  player('na-kru', 'na-kru_nzr', 'NagZ', 'AR', 25, 'Sentinel', attr(83, 80, 81, 82, 82, 84, 83, 80, 54), 'Juan Pablo López'),
  player('na-kru', 'na-kru_shyy', 'shyy', 'CL', 22, 'Duelist', attr(86, 84, 84, 78, 80, 78, 70, 82, 40), 'Agustín Bilbao'),

  // --- MIBR (BR) ---------------------------------------------------
  player('na-mibr', 'na-mibr_artzin', 'artzin', 'BR', 21, 'Duelist', attr(88, 86, 85, 78, 80, 78, 70, 83, 40), 'Matheus Antunes'),
  player('na-mibr', 'na-mibr_rgln', 'RgLM', 'BR', 23, 'Initiator', attr(84, 82, 82, 81, 82, 83, 83, 82, 56), 'Leandro Lopes'),
  player('na-mibr', 'na-mibr_mwzera', 'mwzera', 'BR', 23, 'Duelist', attr(88, 86, 85, 78, 80, 77, 70, 82, 42), 'Leonardo Serrati'),
  player('na-mibr', 'na-mibr_frz', 'frz', 'BR', 24, 'Initiator', attr(82, 80, 81, 83, 82, 85, 84, 81, 76), 'Gabriel Mello'),
  player('na-mibr', 'na-mibr_xand', 'xand', 'BR', 26, 'Controller', attr(81, 79, 80, 84, 83, 86, 85, 80, 80), 'Alexandre Zizou'),

  // --- FURIA (BR) --------------------------------------------------
  player('na-fur', 'na-fur_mazin', 'mazin', 'BR', 22, 'Duelist', attr(88, 86, 85, 79, 81, 78, 70, 83, 40), 'Matheus Araújo'),
  player('na-fur', 'na-fur_khalil', 'khalil', 'BR', 23, 'Initiator', attr(84, 82, 82, 82, 82, 84, 83, 82, 70), 'Khalil Schmidt'),
  player('na-fur', 'na-fur_havoc', 'havoc', 'BR', 24, 'Controller', attr(82, 80, 81, 82, 82, 84, 85, 80, 58), 'Pedro Mota'),
  player('na-fur', 'na-fur_qck', 'mwzera2', 'BR', 22, 'Initiator', attr(83, 81, 82, 80, 81, 81, 82, 81, 46), 'Gabriel Lima'),
  player('na-fur', 'na-fur_nzr', 'nzr', 'BR', 24, 'Sentinel', attr(83, 80, 81, 82, 82, 84, 83, 80, 54), 'Rafael Soares'),

  // --- G2 Esports (NA) ---------------------------------------------
  player('na-g2', 'na-g2_valyn', 'valyn', 'US', 23, 'Initiator', attr(84, 82, 82, 84, 83, 86, 84, 82, 84), 'Jacob Batio'),
  player('na-g2', 'na-g2_jonahp', 'JonahP', 'US', 22, 'Duelist', attr(89, 87, 86, 79, 82, 79, 71, 84, 42), 'Jonah Pulice'),
  player('na-g2', 'na-g2_leaf', 'leaf', 'US', 23, 'Duelist', attr(90, 88, 87, 79, 82, 79, 71, 84, 44), 'Nathan Orf'),
  player('na-g2', 'na-g2_trent', 'trent', 'CA', 22, 'Sentinel', attr(84, 81, 82, 82, 82, 84, 84, 81, 52), 'Trent Cairns'),
  player('na-g2', 'na-g2_jameryy', 'JonahP2', 'US', 22, 'Controller', attr(82, 80, 81, 82, 82, 84, 85, 80, 56), 'James Macaranas'),

  // --- 2Game Esports (BR/LATAM) ------------------------------------
  player('na-2g', 'na-2g_pleeh', 'pleh', 'BR', 23, 'Duelist', attr(87, 85, 84, 78, 80, 78, 70, 82, 40), 'Gabriel Souza'),
  player('na-2g', 'na-2g_jhona', 'jhONA', 'BR', 24, 'Initiator', attr(82, 80, 81, 83, 82, 85, 83, 81, 78), 'Jhonathan Silva'),
  player('na-2g', 'na-2g_dgzin', 'dgzin', 'BR', 21, 'Duelist', attr(86, 84, 84, 77, 79, 76, 70, 81, 38), 'Diego Goularte'),
  player('na-2g', 'na-2g_nyang', 'nyang', 'BR', 22, 'Controller', attr(80, 78, 79, 82, 81, 84, 85, 79, 56), 'Vitor Hugo'),
  player('na-2g', 'na-2g_msm', 'mssm', 'BR', 23, 'Sentinel', attr(82, 79, 80, 82, 81, 83, 83, 79, 52), 'Mateus Magrini')
];

/* ------------------------------------------------------------------ *
 *  Assemble teams (roster = ids of that team's 5 players, in listed order)
 * ------------------------------------------------------------------ */

/** @type {object[]} */
const TEAMS = TEAM_META.map((meta) => ({
  id: meta.id,
  name: meta.name,
  tag: meta.tag,
  leagueId: 'americas',
  roster: PLAYERS.filter((p) => p.contract.teamId === meta.id).map((p) => p.id)
}));

/** @type {object} */
const LEAGUE = {
  id: 'americas',
  name: 'VCT Americas',
  region: 'americas',
  teamIds: TEAM_META.map((t) => t.id)
};

/**
 * AMERICAS_SEED — league seed fixture (CONTRACTS-SEASON §1).
 * @type {{ league: object, teams: object[], players: object[] }}
 */
export const AMERICAS_SEED = {
  league: LEAGUE,
  teams: TEAMS,
  players: PLAYERS
};
