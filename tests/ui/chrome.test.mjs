/**
 * tests/ui/chrome.test.mjs — shell chrome components (CONTRACTS-UI §6, §8).
 *
 * Headless via toHtml (no DOM):
 *   - Sidebar marks the active route's nav item (and a contextual screen maps
 *     to its parent item), and renders the followed-team badge;
 *   - ContinueButton shows 'Continue' vs 'Season complete' by the complete flag
 *     (and is disabled when complete);
 *   - ToastRoot renders each toast in ui.toasts with its text + kind class.
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert } from '../_assert.mjs';
import { toHtml } from '../../src/ui/render.js';
import { Sidebar, NAV_ITEMS } from '../../src/ui/components/Sidebar.js';
import { ContinueButton } from '../../src/ui/components/ContinueButton.js';
import { TopBar } from '../../src/ui/components/TopBar.js';
import { ToastRoot, ModalRoot } from '../../src/ui/components/Roots.js';

/** Count occurrences of a substring. */
function count(haystack, needle) {
  let c = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    c += 1;
    i += needle.length;
  }
  return c;
}

export default async function run() {
  // ---- Sidebar: active route highlight + followed-team badge -----------
  const followedTeam = { id: 'drx', name: 'DRX', tag: 'DRX' };

  for (const item of NAV_ITEMS) {
    const html = toHtml(
      Sidebar({ route: { screen: item.screen }, followedTeam, onNavigate: null })
    );
    // exactly one active item across the whole sidebar
    assert(
      count(html, 'sidebar__item--active') === 1,
      `exactly one active nav item for route "${item.screen}"`
    );
    // every primary label renders
    for (const it of NAV_ITEMS) {
      assert(
        html.includes(`>${it.label}</span>`),
        `nav label "${it.label}" present for route "${item.screen}"`
      );
    }
    // followed-team badge present
    assert(html.includes('sidebar__follow'), 'followed-team badge present');
    assert(html.includes('>DRX<'), 'followed-team tag/name rendered');
  }

  // The active item must be the one whose label sits in the highlighted button.
  // Verify the tournament route highlights the unified Tournament item, and a
  // contextual screen (player) maps to its parent (tournament) item too.
  const tournamentHtml = toHtml(
    Sidebar({ route: { screen: 'tournament' }, followedTeam })
  );
  const activeIdx = tournamentHtml.indexOf('sidebar__item--active');
  const tournamentIdx = tournamentHtml.indexOf('>Tournament</span>');
  assert(activeIdx !== -1 && tournamentIdx !== -1, 'tournament markers present');
  // the active button precedes (contains) the Tournament label
  assert(activeIdx < tournamentIdx, 'active class is on the Tournament item');

  const playerHtml = toHtml(Sidebar({ route: { screen: 'player' }, followedTeam }));
  assert(
    count(playerHtml, 'sidebar__item--active') === 1,
    'contextual screen still highlights exactly one (parent) item'
  );
  const pActive = playerHtml.indexOf('sidebar__item--active');
  const pTournament = playerHtml.indexOf('>Tournament</span>');
  assert(pActive < pTournament, 'player screen highlights its parent Tournament item');

  // empty followed team renders the empty-state badge without throwing
  const noTeamHtml = toHtml(Sidebar({ route: { screen: 'home' }, followedTeam: null }));
  assert(
    noTeamHtml.includes('sidebar__follow--empty'),
    'empty followed-team state rendered'
  );

  // ---- ContinueButton: label by complete flag --------------------------
  const cont = toHtml(ContinueButton({ complete: false }));
  assert(cont.includes('>Continue</span>'), "incomplete -> 'Continue' label");
  assert(!cont.includes('disabled'), 'incomplete button is enabled');

  const done = toHtml(ContinueButton({ complete: true }));
  assert(done.includes('>Season complete</span>'), "complete -> 'Season complete' label");
  assert(done.includes('disabled'), 'complete button is disabled');
  assert(done.includes('continue-btn--done'), 'complete button carries done modifier');

  // TopBar embeds the ContinueButton with the right label
  const topbar = toHtml(
    TopBar({ eventLabel: 'Pacific Kickoff', seasonLabel: '2026 — Pacific', kickoffComplete: false })
  );
  assert(topbar.includes('Pacific Kickoff'), 'topbar shows event label');
  assert(topbar.includes('>Continue</span>'), 'topbar embeds Continue button');

  // ---- ToastRoot: renders each toast -----------------------------------
  const state = {
    ui: {
      toasts: [
        { id: 'toast_0', kind: 'success', text: 'Pacific Kickoff complete' },
        { id: 'toast_1', kind: 'info', text: 'Season complete (Phase 3 demo)' }
      ],
      modals: []
    }
  };
  const toastHtml = toHtml(ToastRoot(state, () => {}));
  assert(count(toastHtml, 'class="toast ') === 2, 'two toasts rendered');
  assert(toastHtml.includes('Pacific Kickoff complete'), 'first toast text present');
  assert(toastHtml.includes('Season complete (Phase 3 demo)'), 'second toast text present');
  assert(toastHtml.includes('toast--success'), 'success kind class present');
  assert(toastHtml.includes('toast--info'), 'info kind class present');

  // empty toast stack renders the root container without throwing
  const emptyToasts = toHtml(ToastRoot({ ui: { toasts: [], modals: [] } }, () => {}));
  assert(emptyToasts.includes('toast-root'), 'empty toast root still renders container');
  assert(count(emptyToasts, 'class="toast ') === 0, 'no toasts when stack empty');

  // ModalRoot renders an open modal's title + body
  const modalState = {
    ui: {
      modals: [{ id: 'modal_0', type: 'confirm', props: { title: 'Heads up', body: 'Body text' } }],
      toasts: []
    }
  };
  const modalHtml = toHtml(ModalRoot(modalState, () => {}));
  assert(modalHtml.includes('Heads up'), 'modal title rendered');
  assert(modalHtml.includes('Body text'), 'modal body rendered');
  assert(modalHtml.includes('modal--confirm'), 'modal type class present');
}
