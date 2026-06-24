/**
 * tests/unit/traits.test.mjs — player traits & personalities (P12.3). Pure.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { traitDuelMod, traitDevMod, teamTraitChem, assignTraitsForNewgen, TRAIT_DEFS } from '../../src/engine/career/traits.js';
import { duelRating } from '../../src/engine/match/duel.js';
import { createPlayer } from '../../src/domain/player.js';
import { createRng } from '../../src/core/rng.js';
import { BALANCE } from '../../src/config/balance.js';

const T = BALANCE.CAREER.TRAITS;
const P = (traits) => createPlayer({ name: 'p', traits, attributes: { aim: 80, reaction: 78, movement: 76, gameSense: 74 } });

export default async function run() {
  section('traitDuelMod — reacts to the moment');
  {
    assertEqual(traitDuelMod(P([]), { isClutch: true, roundNo: 26 }), 1, 'no traits → no modifier');
    assert(traitDuelMod(P(['clutch']), { isClutch: true, roundNo: 5 }) > 1, 'clutch lifts a last-alive duel');
    assertEqual(traitDuelMod(P(['clutch']), { isClutch: false, roundNo: 5 }), 1, 'clutch is inert when not clutching');
    assert(traitDuelMod(P(['slowStarter']), { roundNo: 2 }) < 1, 'slow starter drags in the opening rounds');
    assertEqual(traitDuelMod(P(['slowStarter']), { roundNo: 10 }), 1, 'slow starter is fine after the opening');
    assert(traitDuelMod(P(['bigGame']), { roundNo: 27 }) > 1, 'big-game lifts in overtime');
    assert(traitDuelMod(P(['choker']), { roundNo: 27 }) < 1, 'choker wilts in overtime');
    assertEqual(traitDuelMod(P(['bigGame']), { roundNo: 10 }), 1, 'big-game inert in regulation');
  }

  section('traitDuelMod — actually moves duelRating');
  {
    const ctx = { side: 'atk', econType: 'full', econFactor: 1, isClutch: true, roundNo: 5 };
    const plain = duelRating(P([]), ctx);
    const clutch = duelRating(P(['clutch']), ctx);
    assert(clutch > plain, `a clutch player out-rates a plain one when last alive (${clutch.toFixed(2)} > ${plain.toFixed(2)})`);
  }

  section('traitDevMod — shapes the growth curve');
  {
    assert(traitDevMod(P(['workhorse'])).growthMult > 1, 'workhorse grows faster');
    assert(traitDevMod(P(['consistent'])).noiseMult < 1, 'consistent is steadier');
    assert(traitDevMod(P(['volatile'])).noiseMult > 1, 'volatile is swingier');
    assert(traitDevMod(P(['earlyPeak'])).peakShift < 0, 'early peak shifts the arc earlier');
    assert(traitDevMod(P(['latePeak'])).peakShift > 0, 'late peak shifts the arc later');
    assertEqual(traitDevMod(P([])).growthMult, 1, 'no traits → neutral dev');
  }

  section('teamTraitChem — mentors/leaders lift, hotheads drag');
  {
    assert(teamTraitChem([P(['mentor']), P([]), P([])]) > 0, 'a mentor lifts chemistry');
    assert(teamTraitChem([P(['leader'])]) > 0, 'a leader lifts chemistry');
    assert(teamTraitChem([P(['hothead'])]) < 0, 'a hothead drags chemistry');
    assertEqual(teamTraitChem([P([]), P([])]), 0, 'no chem traits → no delta');
  }

  section('assignTraitsForNewgen — deterministic, valid, varied');
  {
    assertEqual(assignTraitsForNewgen(createRng(5)), assignTraitsForNewgen(createRng(5)), 'same seed → same traits');
    let withTraits = 0;
    const seenIds = new Set();
    for (let s = 0; s < 300; s += 1) {
      const ts = assignTraitsForNewgen(createRng(7000 + s));
      assert(ts.length <= 2, 'at most 2 traits');
      for (const id of ts) { assert(id in TRAIT_DEFS, `valid trait id ${id}`); seenIds.add(id); }
      if (ts.length) withTraits += 1;
    }
    assert(withTraits > 0 && withTraits < 300, `some but not all newgens get traits (${withTraits}/300)`);
    assert(seenIds.size >= 4, `a variety of traits appear (${seenIds.size} distinct)`);
  }
}
