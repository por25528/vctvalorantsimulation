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
  // Verify by checking the standings route highlights the Standings item, and
  // a contextual screen (player) maps to its parent (standings) item too.
  const standingsHtml = toHtml(
    Sidebar({ route: { screen: 'standings' }, followedTeam })
  );
  const activeIdx = standingsHtml.indexOf('sidebar__item--active');
  const standingsIdx = standingsHtml.indexOf('>Standings</span>');
  assert(activeIdx !== -1 && standingsIdx !== -1, 'standings markers present');
  // the active button precedes (contains) the Standings label
  assert(activeIdx < standingsIdx, 'active class is on the Standings item');

  const playerHtml = toHtml(Sidebar({ route: { screen: 'player' }, followedTeam }));
  assert(
    count(playerHtml, 'sidebar__item--active') === 1,
    'contextual screen still highlights exactly one (parent) item'
  );
  const pActive = playerHtml.indexOf('sidebar__item--active');
  const pStandings = playerHtml.indexOf('>Standings</span>');
  assert(pActive < pStandings, 'player screen highlights its parent Standings item');

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
