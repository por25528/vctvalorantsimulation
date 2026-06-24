/**
 * data/languages.js — nationality → spoken-language mapping for the chemistry /
 * communication system (P12).
 *
 * A player's `languages` array lists the languages they are functional in, the
 * NATIVE/primary language FIRST. Two teammates communicate best (cohesion 1.0)
 * when they share a primary language; they get by on a working common tongue
 * (typically English) when they merely share a non-primary language; and they
 * hit a real barrier (cohesion 0) when they share nothing.
 *
 * Design intent (faithful to pro VCT): East-Asian scenes (KR/CN/JP) overwhelmingly
 * communicate in their native language and are NOT given English by default — so a
 * lone Korean import on a Western roster genuinely struggles until familiarity
 * builds. Most other regions DO carry English as a second language, so mixed
 * rosters work but with friction. Specific players can override this in seed data.
 *
 * Pure data, no dependencies. Codes are lowercase ISO-639-1-ish tags; their exact
 * spelling only matters for set-intersection, so they just need to be consistent.
 */

/** Fallback language list when a nationality is unknown/unmapped. */
export const DEFAULT_LANGUAGES = Object.freeze(['en']);

/**
 * @type {Readonly<Record<string, string[]>>}
 * Nationality (ISO-3166-ish, as used in seed data) → languages, primary first.
 */
export const NATIONALITY_LANGUAGE = Object.freeze({
  // ---- Anglophone (native English) ----
  US: ['en'], CA: ['en'], GB: ['en'], UK: ['en'], AU: ['en'], NZ: ['en'], IE: ['en'],
  // ---- East Asia: native only (the international language barrier) ----
  KR: ['ko'], CN: ['zh'], JP: ['ja'], TW: ['zh'], HK: ['zh'], MO: ['zh'],
  // ---- Southeast Asia: bilingual (native + English) ----
  SG: ['en'], MY: ['ms', 'en'], ID: ['id', 'en'], TH: ['th', 'en'],
  PH: ['tl', 'en'], VN: ['vi', 'en'],
  // ---- South Asia ----
  IN: ['hi', 'en'], PK: ['ur', 'en'], BD: ['bn', 'en'],
  // ---- Iberia / Lusophone & Hispanophone ----
  BR: ['pt', 'en'], PT: ['pt', 'en'],
  ES: ['es', 'en'], AR: ['es', 'en'], CL: ['es', 'en'], MX: ['es', 'en'],
  PE: ['es', 'en'], CO: ['es', 'en'], UY: ['es', 'en'], VE: ['es', 'en'],
  // ---- Western / Central Europe ----
  FR: ['fr', 'en'], BE: ['fr', 'en'], CH: ['de', 'fr', 'en'], DE: ['de', 'en'],
  AT: ['de', 'en'], NL: ['nl', 'en'], IT: ['it', 'en'],
  // ---- Nordics ----
  SE: ['sv', 'en'], FI: ['fi', 'en'], DK: ['da', 'en'], NO: ['no', 'en'], IS: ['is', 'en'],
  // ---- Eastern Europe / CIS ----
  PL: ['pl', 'en'], RU: ['ru', 'en'], UA: ['uk', 'ru', 'en'], BY: ['ru', 'en'],
  LV: ['lv', 'ru', 'en'], LT: ['lt', 'en'], EE: ['et', 'en'],
  CZ: ['cs', 'en'], SK: ['sk', 'en'], HU: ['hu', 'en'], RO: ['ro', 'en'],
  BG: ['bg', 'en'], RS: ['sr', 'en'], HR: ['hr', 'en'], SI: ['sl', 'en'],
  GR: ['el', 'en'],
  // ---- Türkiye ----
  TR: ['tr', 'en'],
  // ---- MENA ----
  MA: ['ar', 'fr', 'en'], DZ: ['ar', 'fr', 'en'], TN: ['ar', 'fr', 'en'],
  SA: ['ar', 'en'], AE: ['ar', 'en'], EG: ['ar', 'en'], JO: ['ar', 'en'],
  LB: ['ar', 'fr', 'en'], IL: ['he', 'en'],
  // ---- Fallback ----
  INT: ['en']
});

/**
 * Resolve the default languages for a nationality. Returns a fresh array (so
 * callers may freeze/own it). Unknown nationalities fall back to English.
 * @param {string} nationality
 * @returns {string[]} languages, primary first
 */
export function languagesFor(nationality) {
  const key = typeof nationality === 'string' ? nationality.toUpperCase() : '';
  const langs = NATIONALITY_LANGUAGE[key];
  return Array.isArray(langs) && langs.length ? langs.slice() : DEFAULT_LANGUAGES.slice();
}
