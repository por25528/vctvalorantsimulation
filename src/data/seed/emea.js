/**
 * data/seed/emea.js — VCT EMEA league seed fixture (Phase 4).
 *
 * NOTE: These rosters are editable approximations assembled for engine testing
 * only. Handles, roles, nationalities and attribute spreads are best-known /
 * plausible values — NOT an authoritative 2026 roster — and are meant to be
 * refined later. Stars sit ~84-92, role players ~74-82; IGLs carry elevated
 * gameSense + igl. Numbers are varied per player to keep the spread realistic
 * rather than uniform. EMEA is modelled as a strong region, so its star ceiling
 * and overall floor sit a touch above the Pacific fixture.
 *
 * Shape (CONTRACTS-SEASON §1): EMEA_SEED = { league, teams:[12], players:[60] }.
 *  - `league`  : a partial League ({ id, name, region, teamIds }).
 *  - `teams`   : partial Team objects ({ id, name, tag, leagueId, roster:[playerId] }).
 *  - `players` : partial Player objects ({ id, name, handle, nationality, age,
 *                role, attributes, contract:{ teamId } }).
 * Every partial normalizes cleanly through createTeam / createPlayer from domain.
 *
 * Ids are globally unique via the `eu-` prefix (e.g. eu-fnc, eu-tl) so they do
 * not collide with the pacific / americas / china rosters in buildWorld().
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
 *  TEAMS  (id, name, tag) — VCT EMEA partner roster (eu- namespaced)
 * ------------------------------------------------------------------ */

/** @type {{ id:string, name:string, tag:string }[]} */
const TEAM_META = [
  { id: 'eu-fnc', name: 'Fnatic', tag: 'FNC' },
  { id: 'eu-tl', name: 'Team Liquid', tag: 'TL' },
  { id: 'eu-th', name: 'Team Heretics', tag: 'TH' },
  { id: 'eu-kc', name: 'Karmine Corp', tag: 'KC' },
  { id: 'eu-vit', name: 'Team Vitality', tag: 'VIT' },
  { id: 'eu-navi', name: 'NAVI', tag: 'NAVI' },
  { id: 'eu-fut', name: 'FUT Esports', tag: 'FUT' },
  { id: 'eu-koi', name: 'KOI', tag: 'KOI' },
  { id: 'eu-bbl', name: 'BBL Esports', tag: 'BBL' },
  { id: 'eu-m8', name: 'Gentle Mates', tag: 'M8' },
  { id: 'eu-apk', name: 'Apeks', tag: 'APK' },
  { id: 'eu-gx', name: 'GIANTX', tag: 'GX' }
];

/* ------------------------------------------------------------------ *
 *  PLAYERS  (5 per team)
 *  attr(aim, movement, reaction, composure, consistency, gameSense, utility, trading, igl)
 * ------------------------------------------------------------------ */

/** @type {object[]} */
const PLAYERS = [
  // --- Fnatic (EU/intl) --------------------------------------------
  player('eu-fnc', 'eu-fnc-boaster', 'Boaster', 'GB', 27, 'Initiator', attr(78, 76, 78, 88, 85, 90, 84, 79, 92), 'Jake Howlett'),
  player('eu-fnc', 'eu-fnc-derke', 'Derke', 'FI', 23, 'Duelist', attr(92, 90, 88, 81, 84, 80, 70, 86, 42), 'Nikita Sirmitev'),
  player('eu-fnc', 'eu-fnc-alfajer', 'Alfajer', 'TR', 20, 'Sentinel', attr(89, 85, 86, 83, 85, 86, 85, 84, 56), 'Emir Ali Beder'),
  player('eu-fnc', 'eu-fnc-leo', 'Leo', 'SE', 22, 'Initiator', attr(84, 82, 83, 84, 84, 87, 86, 83, 70), 'Leo Jannesson'),
  player('eu-fnc', 'eu-fnc-chronicle', 'Chronicle', 'RU', 24, 'Controller', attr(85, 82, 83, 85, 85, 88, 87, 82, 74), 'Timofey Khromov'),

  // --- Team Liquid (EU/intl) ---------------------------------------
  player('eu-tl', 'eu-tl-nats', 'nAts', 'RU', 24, 'Sentinel', attr(86, 81, 84, 87, 86, 89, 86, 82, 80), 'Ayaz Akhmetshin'),
  player('eu-tl', 'eu-tl-keiko', 'keiko', 'PT', 22, 'Initiator', attr(85, 83, 84, 82, 83, 84, 84, 83, 50), 'Frederico Wynne'),
  player('eu-tl', 'eu-tl-kamyk', 'kamyk', 'PL', 21, 'Duelist', attr(89, 87, 86, 79, 81, 78, 70, 83, 40), 'Kamil Talar'),
  player('eu-tl', 'eu-tl-patitek', 'Patitek', 'PL', 23, 'Controller', attr(82, 80, 81, 84, 83, 85, 86, 80, 64), 'Patryk Fabrowski'),
  player('eu-tl', 'eu-tl-narrate', 'narrate', 'RU', 23, 'Initiator', attr(84, 82, 83, 82, 82, 84, 83, 82, 58), 'Daniel Mosk'),

  // --- Team Heretics (EU/intl) -------------------------------------
  player('eu-th', 'eu-th-boo', 'Boo', 'FR', 27, 'Controller', attr(84, 81, 83, 86, 85, 89, 87, 82, 86), 'Ricardo Manuel'),
  player('eu-th', 'eu-th-wo0t', 'Wo0t', 'TR', 24, 'Duelist', attr(90, 88, 87, 80, 82, 79, 71, 85, 44), 'Mehmet Yagiz Ipek'),
  player('eu-th', 'eu-th-benjyfishy', 'benjyfishy', 'GB', 21, 'Initiator', attr(86, 84, 85, 82, 83, 84, 84, 83, 52), 'Benjy Fish'),
  player('eu-th', 'eu-th-miniboo', 'MiniBoo', 'PT', 21, 'Sentinel', attr(85, 82, 84, 81, 82, 82, 84, 82, 48), 'Mohamed Mraissi'),
  player('eu-th', 'eu-th-riens', 'RieNs', 'TR', 24, 'Initiator', attr(83, 81, 82, 83, 83, 85, 84, 81, 66), 'Eren Kasirga'),

  // --- Karmine Corp (EU/intl) --------------------------------------
  player('eu-kc', 'eu-kc-shin', 'ShiN', 'IL', 23, 'Initiator', attr(86, 84, 85, 82, 83, 84, 83, 84, 54), 'Shin Hong-min'),
  player('eu-kc', 'eu-kc-marteen', 'marteen', 'GB', 21, 'Duelist', attr(89, 87, 86, 80, 81, 79, 70, 84, 42), 'Martin Pham'),
  player('eu-kc', 'eu-kc-ataa', 'ATAKAPTAN', 'TR', 22, 'Sentinel', attr(85, 82, 84, 82, 82, 83, 84, 82, 50), 'Ata Tan'),
  player('eu-kc', 'eu-kc-newzera', 'newzera', 'RU', 22, 'Initiator', attr(84, 82, 83, 81, 82, 83, 83, 82, 56), 'Vitalii Pohorilyi'),
  player('eu-kc', 'eu-kc-saadhak', 'saadhak', 'AR', 28, 'Controller', attr(81, 79, 81, 86, 85, 89, 85, 80, 90), 'Matias Delipetro'),

  // --- Team Vitality (EU/intl) -------------------------------------
  player('eu-vit', 'eu-vit-trexx', 'trexx', 'SK', 24, 'Sentinel', attr(84, 81, 83, 83, 83, 85, 85, 82, 58), 'Adam Brivio'),
  player('eu-vit', 'eu-vit-derke2', 'Sayf', 'SE', 24, 'Duelist', attr(88, 86, 85, 81, 82, 80, 71, 84, 46), 'Saif Jibraeel'),
  player('eu-vit', 'eu-vit-less', 'Less', 'BR', 23, 'Sentinel', attr(86, 82, 84, 84, 84, 86, 85, 83, 60), 'Felipe Basso'),
  player('eu-vit', 'eu-vit-runi', 'runi', 'GB', 22, 'Controller', attr(82, 80, 81, 83, 83, 84, 85, 80, 62), 'Cinar Kaplan'),
  player('eu-vit', 'eu-vit-kicks', 'kicks', 'SE', 23, 'Initiator', attr(84, 82, 83, 82, 82, 84, 83, 82, 56), 'Karl Petter Aaes'),

  // --- NAVI (EU/intl) ----------------------------------------------
  player('eu-navi', 'eu-navi-ange1', 'ANGE1', 'UA', 30, 'Controller', attr(80, 78, 80, 87, 85, 90, 86, 79, 91), 'Kyrylo Karasov'),
  player('eu-navi', 'eu-navi-shao', 'Shao', 'RU', 25, 'Initiator', attr(85, 83, 84, 84, 84, 87, 85, 83, 72), 'Andrey Kiprsky'),
  player('eu-navi', 'eu-navi-suygetsu', 'SUYGETSU', 'RU', 26, 'Sentinel', attr(86, 82, 84, 84, 84, 86, 85, 82, 60), 'Dmitry Ilyushin'),
  player('eu-navi', 'eu-navi-cned', 'cNed', 'TR', 23, 'Duelist', attr(91, 88, 87, 81, 83, 81, 71, 85, 44), 'Mehmet Yagiz Ipek'),
  player('eu-navi', 'eu-navi-zyppan', 'Zyppan', 'SE', 25, 'Duelist', attr(86, 84, 84, 80, 81, 80, 72, 83, 48), 'Pontus Eek'),

  // --- FUT Esports (TR/intl) ---------------------------------------
  player('eu-fut', 'eu-fut-mojj', 'MOJJ', 'TR', 22, 'Duelist', attr(89, 87, 86, 79, 81, 79, 70, 84, 42), 'Doga Demir'),
  player('eu-fut', 'eu-fut-aslan', 'aslan', 'TR', 23, 'Initiator', attr(84, 82, 83, 82, 82, 84, 83, 82, 60), 'Berkant Joshkun'),
  player('eu-fut', 'eu-fut-qutionerr', 'qRaxs', 'TR', 22, 'Sentinel', attr(84, 81, 83, 82, 82, 83, 84, 81, 52), 'Mehmet Kubilay'),
  player('eu-fut', 'eu-fut-cne', 'yetujey', 'TR', 23, 'Controller', attr(82, 80, 81, 83, 83, 84, 85, 80, 62), 'Konur Alp Koldas'),
  player('eu-fut', 'eu-fut-ucha', 'ANaTuD', 'TR', 24, 'Initiator', attr(83, 81, 82, 82, 82, 84, 83, 81, 66), 'Anil Tutdere'),

  // --- KOI (EU/intl) -----------------------------------------------
  player('eu-koi', 'eu-koi-trent', 'tr-ent', 'PT', 23, 'Duelist', attr(88, 86, 85, 80, 81, 80, 71, 83, 44), 'Sebastian Olsson'),
  player('eu-koi', 'eu-koi-wolfen', 'Wolfen', 'ES', 24, 'Sentinel', attr(84, 81, 83, 82, 82, 84, 84, 81, 54), 'Mario Mird'),
  player('eu-koi', 'eu-koi-sheydos', 'Sheydos', 'RU', 24, 'Controller', attr(82, 80, 81, 83, 83, 85, 85, 80, 64), 'Bogdan Naumov'),
  player('eu-koi', 'eu-koi-keloqz', 'keloqz', 'FR', 23, 'Duelist', attr(86, 84, 84, 80, 81, 80, 71, 82, 46), 'Kerel Bkhar'),
  player('eu-koi', 'eu-koi-blizm', 'blizm', 'RU', 22, 'Initiator', attr(83, 81, 82, 82, 82, 84, 83, 81, 58), 'Lev Bogov'),

  // --- BBL Esports (TR/intl) ---------------------------------------
  player('eu-bbl', 'eu-bbl-qw1', 'QutionerX', 'TR', 22, 'Duelist', attr(87, 85, 84, 80, 81, 79, 70, 82, 42), 'Dogukan Balaban'),
  player('eu-bbl', 'eu-bbl-brave', 'brave', 'TR', 24, 'Initiator', attr(83, 81, 82, 83, 83, 86, 84, 82, 78), 'Eren Cinmaz'),
  player('eu-bbl', 'eu-bbl-elamri', 'el决', 'TR', 23, 'Controller', attr(82, 80, 81, 83, 82, 84, 85, 80, 60), 'Mohamed El Amri'),
  player('eu-bbl', 'eu-bbl-trzy', 'Turko', 'TR', 22, 'Sentinel', attr(83, 80, 82, 81, 81, 82, 83, 80, 50), 'Berkan Kara'),
  player('eu-bbl', 'eu-bbl-monkeys', 'Monyet2', 'TR', 23, 'Initiator', attr(83, 81, 82, 81, 81, 83, 82, 81, 54), 'Baran Yardimci'),

  // --- Gentle Mates (FR/intl) --------------------------------------
  player('eu-m8', 'eu-m8-nidro', 'Nidro', 'BE', 21, 'Initiator', attr(84, 82, 83, 81, 82, 83, 83, 82, 56), 'Aktan Sevimsiz'),
  player('eu-m8', 'eu-m8-vatires', 'Vatires', 'GR', 23, 'Duelist', attr(87, 85, 84, 79, 80, 79, 70, 82, 42), 'Christos Goudis'),
  player('eu-m8', 'eu-m8-stunt', 'Stunt', 'IT', 23, 'Controller', attr(82, 80, 81, 83, 82, 84, 85, 80, 62), 'Konstantin Sterzik'),
  player('eu-m8', 'eu-m8-vakk', 'vakk', 'PL', 22, 'Sentinel', attr(83, 80, 82, 82, 81, 83, 84, 80, 52), 'Wassim Cist'),
  player('eu-m8', 'eu-m8-purp0', 'Purp0', 'FR', 24, 'Initiator', attr(83, 81, 82, 83, 82, 85, 83, 81, 70), 'Maxime Henquin'),

  // --- Apeks (NO/intl) ---------------------------------------------
  player('eu-apk', 'eu-apk-zelusm', 'zee', 'NO', 23, 'Duelist', attr(86, 84, 84, 80, 81, 79, 70, 82, 44), 'Zeljko Vukovic'),
  player('eu-apk', 'eu-apk-rabye', 'rabye', 'NO', 22, 'Sentinel', attr(84, 81, 83, 81, 81, 82, 83, 80, 50), 'Marius Madsen'),
  player('eu-apk', 'eu-apk-asguard', 'Asguard', 'NO', 25, 'Controller', attr(81, 79, 81, 84, 83, 85, 85, 80, 72), 'Andreas Hofstad'),
  player('eu-apk', 'eu-apk-drophx', 'drophx', 'NO', 21, 'Initiator', attr(83, 81, 82, 81, 81, 82, 82, 81, 52), 'Petter Pettersen'),
  player('eu-apk', 'eu-apk-kebzz', 'Kayoo', 'NO', 24, 'Initiator', attr(82, 80, 81, 82, 82, 84, 83, 80, 64), 'Mathias Karlsen'),

  // --- GIANTX (EU/intl) --------------------------------------------
  player('eu-gx', 'eu-gx-hoody', 'hoody', 'RU', 24, 'Controller', attr(82, 80, 81, 84, 83, 85, 86, 80, 66), 'Roman Slavnov'),
  player('eu-gx', 'eu-gx-cloud', 'Cloud', 'TR', 23, 'Sentinel', attr(84, 81, 83, 82, 82, 84, 84, 81, 54), 'Mert Hari'),
  player('eu-gx', 'eu-gx-rhyme', 'rhyme', 'RU', 23, 'Initiator', attr(84, 82, 83, 81, 82, 83, 83, 82, 58), 'Emir Muminovic'),
  player('eu-gx', 'eu-gx-sayonara2', 'nAts2', 'CZ', 22, 'Duelist', attr(86, 84, 84, 80, 81, 79, 70, 82, 44), 'David Pruzina'),
  player('eu-gx', 'eu-gx-fit1nho', 'fit1nho', 'PT', 23, 'Duelist', attr(85, 83, 83, 79, 80, 79, 71, 81, 46), 'Afonso Varela')
];

/* ------------------------------------------------------------------ *
 *  Assemble teams (roster = ids of that team's 5 players, in listed order)
 * ------------------------------------------------------------------ */

/** @type {object[]} */
const TEAMS = TEAM_META.map((meta) => ({
  id: meta.id,
  name: meta.name,
  tag: meta.tag,
  leagueId: 'emea',
  roster: PLAYERS.filter((p) => p.contract.teamId === meta.id).map((p) => p.id)
}));

/** @type {object} */
const LEAGUE = {
  id: 'emea',
  name: 'VCT EMEA',
  region: 'emea',
  teamIds: TEAM_META.map((t) => t.id)
};

/**
 * EMEA_SEED — VCT EMEA league seed fixture (CONTRACTS-SEASON §1).
 * @type {{ league: object, teams: object[], players: object[] }}
 */
export const EMEA_SEED = {
  league: LEAGUE,
  teams: TEAMS,
  players: PLAYERS
};
