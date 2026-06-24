/**
 * tests/ui/screen-editor.test.mjs — P7d god-mode editor (CONTRACTS-POLISH P7d).
 *
 * Headless via toHtml. Renders the Editor and exercises editPlayer/editTeam/
 * healPlayer: edits apply + clamp via the domain factory, identity is preserved,
 * untouched fields survive, and the heal action clears injury + fatigue.
 */

import { assert, assertEqual, section } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { buildStore } from '../../src/state/createRootStore.js';
import { bootstrap, editPlayer, editTeam, healPlayer } from '../../src/state/commands.js';
import { navigate } from '../../src/state/actions.js';
import { setPlayer } from '../../src/state/slices/world.js';
import { Editor } from '../../src/ui/screens/Editor.js';
import { RouterOutlet } from '../../src/ui/router.js';
import { NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { selectFollowedTeam, selectRoster, selectPlayer, selectTeam } from '../../src/state/selectors.js';

export default async function run() {
  const store = buildStore();
  await bootstrap(store, { fresh: true });

  const team = selectFollowedTeam(store.getState());
  const roster = selectRoster(store.getState(), team.id);
  const pid = roster[0].id;

  section('Editor renders the team + roster + attribute inputs');
  let html = toHtml(Editor(store.getState(), store.dispatch, store));
  assert(html.includes('screen--editor'), 'editor screen renders');
  assert(html.includes('God Mode') && html.includes(team.name), 'header shows god mode + team');
  assert(html.includes('editor__attrs') && html.includes('editor__input'), 'attribute inputs render');
  assert((html.match(/editor__tabs/g) || []).length === 1 && roster.every((p) => html.includes(p.handle || p.name)), 'roster tabs list every player');

  section('editPlayer — applies + clamps via the domain factory');
  editPlayer(store, pid, { attributes: { aim: 99 } });
  assertEqual(selectPlayer(store.getState(), pid).attributes.aim, 99, 'aim set to 99');
  editPlayer(store, pid, { attributes: { aim: 150 } }); // out of range -> clamped
  assertEqual(selectPlayer(store.getState(), pid).attributes.aim, 100, 'aim clamped to 100');
  // identity + other fields preserved
  const after = selectPlayer(store.getState(), pid);
  assertEqual(after.id, pid, 'id preserved across edits');
  assert(typeof after.attributes.movement === 'number', 'other attributes survive');

  section('editPlayer — role change preserves attributes');
  const beforeMove = selectPlayer(store.getState(), pid).attributes.movement;
  editPlayer(store, pid, { role: 'Controller' });
  assertEqual(selectPlayer(store.getState(), pid).role, 'Controller', 'role changed');
  assertEqual(selectPlayer(store.getState(), pid).attributes.movement, beforeMove, 'attributes not reset on role change');

  section('editTeam — applies + clamps');
  editTeam(store, team.id, { name: 'My Squad', reputation: 250 });
  assertEqual(selectTeam(store.getState(), team.id).name, 'My Squad', 'team name edited');
  assertEqual(selectTeam(store.getState(), team.id).reputation, 100, 'reputation clamped to 100');
  assert(selectTeam(store.getState(), team.id).roster.length === 5, 'roster preserved through a team edit');

  section('healPlayer — clears injury + resets fatigue');
  store.dispatch(setPlayer({ ...selectPlayer(store.getState(), pid), injury: { weeks: 2, type: 'knock' }, dynamics: { form: 0, morale: 60, fatigue: 90 } }));
  assert(selectPlayer(store.getState(), pid).injury, 'player is injured first');
  healPlayer(store, pid);
  assertEqual(selectPlayer(store.getState(), pid).injury, null, 'injury cleared');
  assertEqual(selectPlayer(store.getState(), pid).dynamics.fatigue, 0, 'fatigue reset');

  section('router + sidebar');
  store.dispatch(navigate('editor', { playerId: pid }));
  assert(toHtml(RouterOutlet(store.getState(), store.dispatch, store)).includes('screen--editor'), 'router routes to editor');
  assert(NAV_ITEMS.some((i) => i.screen === 'editor'), 'sidebar exposes a God Mode nav item');

  section('edited world still simulates');
  const { continueSeason } = await import('../../src/state/commands.js');
  continueSeason(store, { simEvent: true });
  assert(selectRoster(store.getState(), team.id).length === 5, 'roster still valid after edits + a played slot');
}
