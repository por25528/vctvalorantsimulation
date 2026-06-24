/**
 * tests/unit/news.test.mjs — P7b news generators + inbox slice (CONTRACTS-POLISH P7b).
 *
 * The generators are pure: constructed inputs → exact, deterministic NewsItems.
 * The inbox slice stamps ids + unread flags, caps the feed, and marks/loads.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { eventNews, awardNews, offseasonNews } from '../../src/engine/career/news.js';
import { inboxReducer, initialInboxState } from '../../src/state/slices/inbox.js';
import { appendNews, markNewsRead, loadInbox } from '../../src/state/actions.js';
import { BALANCE } from '../../src/config/balance.js';

const world = {
  teamsById: { t1: { id: 't1', name: 'Alpha' }, t2: { id: 't2', name: 'Beta' } },
  playersById: {
    p1: { id: 'p1', handle: 'star', role: 'Duelist', age: 22, contract: { teamId: 't1' } },
    p2: { id: 'p2', handle: 'vet', role: 'Sentinel', age: 30, contract: { teamId: 't2' } },
    p3: { id: 'p3', handle: 'mover', role: 'Initiator', age: 24, contract: { teamId: 't1' } },
    ng: { id: 'ng', handle: 'kid', role: 'Controller', age: 16, potential: 92, contract: { teamId: null } }
  }
};

export default async function run() {
  section('eventNews — winner headlines, champions special-case, followed result');
  const regional = [{
    slotId: 'kickoff', type: 'kickoff', scope: 'regional', region: 'pacific',
    result: { placements: [{ rank: 1, teamId: 't1' }, { rank: 3, teamId: 't2' }] }
  }];
  const ev = eventNews(regional, world, { seasonIndex: 0, followedTeamId: 't2' });
  assert(ev.some((i) => i.kind === 'result' && i.headline.includes('Alpha win Kickoff Pacific')), 'winner headline');
  assert(ev.some((i) => i.headline.includes('Beta finish 3rd at Kickoff Pacific') && i.tone === 'good'), 'followed-team top-3 result is good');

  const champ = eventNews([{ slotId: 'champions', type: 'champions', scope: 'international', result: { placements: [{ rank: 1, teamId: 't1' }] } }], world, { seasonIndex: 1 });
  assert(champ.length === 1 && champ[0].kind === 'champion' && champ[0].tone === 'headline', 'champions event yields a champion headline');
  assert(champ[0].headline.includes('Alpha are crowned'), 'champion headline text');

  // followed team that finished poorly -> bad tone
  const bad = eventNews(regional, world, { seasonIndex: 0, followedTeamId: 't1' });
  assert(!bad.some((i) => i.headline.includes('finish')), 'the winner is not also given a "finish" line');

  section('eventNews — determinism');
  assertEqual(eventNews(regional, world, { seasonIndex: 0, followedTeamId: 't2' }), ev, 'same inputs => identical items');

  section('awardNews — MVP / Finals / Rookie');
  const an = awardNews({ mvp: { playerId: 'p1', teamId: 't1' }, finalsMvp: { playerId: 'p3', teamId: 't1' }, rookieOfYear: null }, world, { seasonIndex: 2, followedTeamId: 't1' });
  assert(an.length === 2, 'two award items (no rookie)');
  assert(an[0].kind === 'award' && an[0].headline.includes('Season MVP: star (Alpha)'), 'MVP item');
  assert(an[0].tone === 'good', 'followed-team MVP is good-toned');

  section('offseasonNews — retirements, signings, newgens (bounded)');
  const report = {
    season: 0,
    retired: ['p2'],
    transfers: [{ playerId: 'p3', toTeamId: 't1', salary: 120000, kind: 'transfer' }],
    newgens: ['ng']
  };
  const on = offseasonNews(report, world, { seasonIndex: 0, followedTeamId: 't1' });
  assert(on.some((i) => i.kind === 'retirement' && i.headline.includes('vet retires at 30')), 'retirement item');
  assert(on.some((i) => i.kind === 'transfer' && i.headline.includes('mover signs for Alpha') && i.headline.includes('$120k')), 'signing item');
  assert(on.some((i) => i.kind === 'newgen' && i.headline.includes('Wonderkid kid') && i.headline.includes('potential 92')), 'newgen item');
  assertEqual(offseasonNews(report, world, { seasonIndex: 0, followedTeamId: 't1' }), on, 'offseasonNews deterministic');

  section('inbox slice — append stamps id + unread, newest at end');
  let s = inboxReducer(initialInboxState, appendNews([{ kind: 'result', headline: 'A' }, { kind: 'result', headline: 'B' }]));
  assertEqual(s.items.length, 2, 'two items appended');
  assert(s.items[0].id === 'n0' && s.items[1].id === 'n1', 'monotonic ids');
  assert(s.items.every((i) => i.read === false), 'new items are unread');
  s = inboxReducer(s, appendNews([{ kind: 'award', headline: 'C' }]));
  assert(s.items[2].id === 'n2', 'seq continues across appends');

  section('inbox slice — markRead (one / all)');
  let s2 = inboxReducer(s, markNewsRead('n1'));
  assert(s2.items.find((i) => i.id === 'n1').read === true, 'one item marked read');
  assert(s2.items.find((i) => i.id === 'n0').read === false, 'others untouched');
  s2 = inboxReducer(s2, markNewsRead());
  assert(s2.items.every((i) => i.read === true), 'mark-all read');
  assert(inboxReducer(s2, markNewsRead()) === s2, 'mark-all is a no-op when already all read');

  section('inbox slice — cap to INBOX_CAP, load derives seq');
  const cap = BALANCE.CAREER.NEWS.INBOX_CAP;
  let big = initialInboxState;
  big = inboxReducer(big, appendNews(Array.from({ length: cap + 25 }, (_, i) => ({ kind: 'result', headline: `H${i}` }))));
  assertEqual(big.items.length, cap, 'feed capped to INBOX_CAP');
  assert(big.items[0].headline === 'H25', 'oldest items dropped (kept newest)');
  const loaded = inboxReducer(initialInboxState, loadInbox([{ id: 'n7', kind: 'result', headline: 'X', read: true }]));
  assertEqual(loaded.items.length, 1, 'loadInbox installs items');
  assertEqual(loaded.seq, 8, 'loadInbox derives next seq past the max id');
  assert(inboxReducer(loaded, appendNews([{ kind: 'result', headline: 'Y' }])).items[1].id === 'n8', 'append continues from derived seq');
}
