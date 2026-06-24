/**
 * tests/unit/chemistry.test.mjs — language cohesion + team chemistry (P12.2).
 * Pure & deterministic.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { languageCohesion, teamChemistryMultiplier, driftChemistry, initialChemistry } from '../../src/engine/career/chemistry.js';
import { createPlayer } from '../../src/domain/player.js';
import { createTeam } from '../../src/domain/team.js';
import { BALANCE } from '../../src/config/balance.js';

const C = BALANCE.CAREER.CHEMISTRY;

/** Build five players of the given nationalities (languages derived from them). */
function five(nats) {
  return nats.map((nat, i) => createPlayer({ id: `p${i}`, name: `P${i}`, nationality: nat }));
}

function teamOf(ids, chemistry) {
  return createTeam({ id: 'T', roster: ids, chemistry });
}

export default async function run() {
  section('languageCohesion — same-language vs mixed vs barrier');
  {
    const allKR = five(['KR', 'KR', 'KR', 'KR', 'KR']);
    assertEqual(languageCohesion(allKR), 1, 'an all-Korean five communicates perfectly');

    // All speak English as a SECOND language (different natives) → softened.
    const englishLingua = five(['BR', 'TR', 'FR', 'DE', 'PL']);
    assert(Math.abs(languageCohesion(englishLingua) - C.ENGLISH_SOFTEN) < 1e-9, 'mixed roster gets by in English (softened)');

    // A Korean (no English) among English-speakers → some pairs hit a hard wall.
    const withBarrier = five(['KR', 'BR', 'TR', 'FR', 'DE']);
    const c = languageCohesion(withBarrier);
    assert(c < C.ENGLISH_SOFTEN && c > 0, `a lone non-English speaker drags cohesion down (${c.toFixed(2)})`);
    assert(c < languageCohesion(englishLingua), 'the barrier roster is less cohesive than the all-English one');
  }

  section('teamChemistryMultiplier — bounded, ordered, near-neutral default');
  {
    const players = {};
    // Build a team + register its five players (ids unique per nationality set).
    function makeTeam(nats, chemistry) {
      const ids = nats.map((nat, i) => `${nats.join('')}-${i}`);
      ids.forEach((id, i) => { players[id] = createPlayer({ id, name: id, nationality: nats[i] }); });
      return createTeam({ id: `T-${nats.join('')}`, roster: ids, chemistry });
    }

    const gelledKR = makeTeam(['KR', 'KR', 'KR', 'KR', 'KR'], 85);
    const fracturedMix = makeTeam(['KR', 'BR', 'TR', 'FR', 'US'], 25);
    const neutral = makeTeam(['BR', 'TR', 'FR', 'DE', 'PL'], C.CHEM_BASE);

    const mGelled = teamChemistryMultiplier(gelledKR, players);
    const mFractured = teamChemistryMultiplier(fracturedMix, players);
    const mNeutral = teamChemistryMultiplier(neutral, players);

    assert(mGelled > mFractured, `a gelled same-language side out-chemistries a fractured one (${mGelled.toFixed(4)} > ${mFractured.toFixed(4)})`);
    assert(mGelled <= 1 + C.CHEM_MAX + 1e-9 && mFractured >= 1 - C.CHEM_MAX - 1e-9, 'multiplier stays within ±CHEM_MAX');
    assert(Math.abs(mNeutral - 1) < 0.01, `neutral team ≈ 1.0 (${mNeutral.toFixed(4)})`);
    assertEqual(teamChemistryMultiplier(gelledKR, players), mGelled, 'deterministic');
  }

  section('driftChemistry — wins raise, losses lower, mean-reverts');
  {
    assert(driftChemistry(50, { won: true }) > 50, 'a winning slot raises chemistry');
    assert(driftChemistry(50, { won: false }) < 50, 'a losing slot lowers chemistry');
    // Above base, a loss + revert pulls it down toward base.
    assert(driftChemistry(90, { won: false }) < 90, 'high chemistry reverts toward base on a loss');
    const v = driftChemistry(50, { won: true });
    assert(v >= 0 && v <= 100, 'stays in [0,100]');
  }

  section('initialChemistry — docks per fresh signing');
  {
    assertEqual(initialChemistry(0), C.CHEM_BASE, 'an unchanged roster keeps base chemistry');
    assert(initialChemistry(3) < initialChemistry(1), 'more signings → less initial chemistry');
    assert(initialChemistry(0) > initialChemistry(2), 'churn costs chemistry');
  }
}
