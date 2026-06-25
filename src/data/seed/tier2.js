/**
 * data/seed/tier2.js — Tier-2 (Challengers) team identities, per region.
 *
 * The franchised Tier-1 leagues live in the four region fixtures
 * (pacific/americas/emea/china). This file supplies the SECOND division: the
 * static identities (id, name, tag) of the Challengers clubs in each region. Their
 * ROSTERS are not hand-authored — they're generated deterministically with a
 * realistic T2 quality/age curve by `engine/career/tier2/tier2World.js`, so this
 * fixture stays small and the talent curve is tunable from `config/balance.js`.
 *
 * Ids are globally unique and prefixed `t2-<region>-…` so they never collide with
 * the franchised T1 ids. Each region lists BALANCE.CAREER.TIER2.TEAMS_PER_REGION
 * (12) clubs, sized to the regional Kickoff/Stage format (two groups of six → an
 * eight-team playoff). Pure data, named exports only — no randomness, no I/O.
 *
 * `NATIONALITY_POOL_BY_REGION` gives plausible nationalities the generator draws
 * from so a region's Challengers scene looks locally sourced (Pacific is KR/JP/SEA,
 * Americas NA/BR/LATAM, etc.).
 */

/** @typedef {{ id:string, name:string, tag:string }} Tier2TeamMeta */

/**
 * Twelve Challengers clubs per region. Names are plausible second-division /
 * academy-style orgs, not an authoritative roster — they exist to give the T2
 * ecosystem distinct, stable identities across a career.
 * @type {Readonly<Record<string, ReadonlyArray<Tier2TeamMeta>>>}
 */
export const TIER2_TEAMS_BY_REGION = Object.freeze({
  pacific: Object.freeze([
    { id: 't2-pac-ardent', name: 'Ardent Crusade', tag: 'ARC' },
    { id: 't2-pac-meteor', name: 'Meteor Gaming', tag: 'MTR' },
    { id: 't2-pac-nautilus', name: 'Nautilus', tag: 'NTL' },
    { id: 't2-pac-onsla', name: 'Onslaught', tag: 'ONS' },
    { id: 't2-pac-reject', name: 'REJECT Shion', tag: 'RJS' },
    { id: 't2-pac-sengoku', name: 'Sengoku Gaming', tag: 'SG' },
    { id: 't2-pac-fennel', name: 'FENNEL', tag: 'FL' },
    { id: 't2-pac-alpha', name: 'Alter Ego', tag: 'AE' },
    { id: 't2-pac-boom', name: 'BOOM Esports', tag: 'BOOM' },
    { id: 't2-pac-bigetron', name: 'Bigetron Astro', tag: 'BTR' },
    { id: 't2-pac-vivo', name: 'Vivo Keyd Pacific', tag: 'VKP' },
    { id: 't2-pac-orangu', name: 'Orangutan', tag: 'OG' }
  ]),
  americas: Object.freeze([
    { id: 't2-na-mirage', name: 'Mirage', tag: 'MRG' },
    { id: 't2-na-oxygen', name: 'Oxygen Esports', tag: 'OXG' },
    { id: 't2-na-moon', name: 'M80', tag: 'M80' },
    { id: 't2-na-tempo', name: 'TSM Academy', tag: 'TSMA' },
    { id: 't2-na-shopify', name: 'Shopify Rebellion', tag: 'SR' },
    { id: 't2-na-disguised', name: 'Disguised', tag: 'DSG' },
    { id: 't2-br-corinthians', name: 'Corinthians', tag: 'SCCP' },
    { id: 't2-br-fluxo', name: 'Fluxo', tag: 'FLX' },
    { id: 't2-br-recon', name: 'Los Recon', tag: 'RCN' },
    { id: 't2-latam-meta', name: 'Meta Gaming', tag: 'META' },
    { id: 't2-latam-australes', name: 'Australes', tag: 'AUS' },
    { id: 't2-latam-six', name: 'Six Karma', tag: '6K' }
  ]),
  emea: Object.freeze([
    { id: 't2-eu-apeks', name: 'Apeks', tag: 'APK' },
    { id: 't2-eu-case', name: 'Case Esports', tag: 'CASE' },
    { id: 't2-eu-gentle', name: 'Gentle Mates', tag: 'M8' },
    { id: 't2-eu-joblife', name: 'JobLife', tag: 'JL' },
    { id: 't2-eu-diamant', name: 'Diamant Esports', tag: 'DIA' },
    { id: 't2-eu-els', name: 'Els Academy', tag: 'ELS' },
    { id: 't2-eu-zeroten', name: 'Zero Tenacity', tag: '0TEN' },
    { id: 't2-eu-rebels', name: 'Rebels Gaming', tag: 'RBL' },
    { id: 't2-eu-natus', name: 'NAVI Junior', tag: 'NVJ' },
    { id: 't2-eu-koi', name: 'KOI Fundación', tag: 'KOIF' },
    { id: 't2-eu-vitality', name: 'Vitality.Neo', tag: 'VITN' },
    { id: 't2-eu-twisted', name: 'Twisted Minds', tag: 'TM' }
  ]),
  china: Object.freeze([
    { id: 't2-cn-dragon', name: 'Dragon Ranger Gaming', tag: 'DRG' },
    { id: 't2-cn-qghappy', name: 'QG Reloaded', tag: 'QGR' },
    { id: 't2-cn-douyu', name: 'Douyu Gaming', tag: 'DYG' },
    { id: 't2-cn-rare', name: 'Rare Atom Period', tag: 'RAP' },
    { id: 't2-cn-katevenge', name: 'Katevenge', tag: 'KTV' },
    { id: 't2-cn-mango', name: 'Mango Esports', tag: 'MG' },
    { id: 't2-cn-wolves', name: 'Wolves Academy', tag: 'WOLA' },
    { id: 't2-cn-rougue', name: 'Rogue Warriors', tag: 'RW' },
    { id: 't2-cn-titan', name: 'Titan Esports Club', tag: 'TEC' },
    { id: 't2-cn-newhappy', name: 'NewHappy', tag: 'NH' },
    { id: 't2-cn-thunder', name: 'Thunder Talk Gaming', tag: 'TTG' },
    { id: 't2-cn-feng', name: 'FengXi', tag: 'FX' }
  ])
});

/**
 * Plausible player nationalities per region, so generated Challengers rosters look
 * locally sourced. The generator draws uniformly from the region's pool.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const NATIONALITY_POOL_BY_REGION = Object.freeze({
  pacific: Object.freeze(['KR', 'JP', 'ID', 'PH', 'TH', 'SG', 'MY', 'VN']),
  americas: Object.freeze(['US', 'CA', 'BR', 'AR', 'CL', 'MX']),
  emea: Object.freeze(['FR', 'GB', 'ES', 'DE', 'SE', 'PL', 'TR', 'UA', 'FI']),
  china: Object.freeze(['CN'])
});

/** Fixed region order (mirrors qualification.REGION_ORDER) for stable iteration. */
export const TIER2_REGION_ORDER = Object.freeze(['pacific', 'americas', 'emea', 'china']);
