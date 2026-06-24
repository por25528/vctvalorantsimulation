/**
 * src/main.js — application entry point (CONTRACTS-UI §4).
 *
 * Phase 3 wires the UI shell: build the root store, bootstrap the world from the
 * Pacific seed, then mount the App shell into `#app`. This is the only module
 * `index.html` loads (`<script type="module" src="src/main.js">`); it contains
 * no inline logic of its own beyond this composition.
 */

import { buildStore } from './state/createRootStore.js';
import { bootstrap } from './state/commands.js';
import { App } from './ui/app.js';

const store = buildStore();
bootstrap(store);

// Mount only in a DOM environment. A bare `import` of this module in Node (the
// import smoke check) builds + bootstraps the store but skips the DOM mount, so
// it loads without a `document` reference error.
if (typeof document !== 'undefined') {
  App(store);
}
