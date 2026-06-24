/**
 * ui/render.js — tiny hyperscript + DOM renderer + pure HTML serializer.
 * Phase 3 (UI shell). Vanilla, zero-dependency, no virtual-DOM library.
 *
 * Per CONTRACTS-UI §1:
 *   - h(tag, props, ...children): tag = string | Fragment | (props)=>VNode component
 *   - mount(vnode, container): build real DOM, replace container children, attach handlers
 *   - patch(container, vnode): minimal keyed diff update
 *   - toHtml(vnode): pure HTML string serialization (event handlers omitted, components invoked)
 *   - Fragment symbol; classNames(...parts) helper
 *
 * @typedef {{tag:(string|symbol|Function), props:object, children:Array<VNode|string>}} VNode
 */

/** Fragment marker — groups children without a wrapper element. */
export const Fragment = Symbol('Fragment');

/** HTML void elements (no closing tag, no children). */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

/** SVG namespace — so <svg> subtrees render as real graphics, not HTML unknowns. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The SVG namespace of a DOM parent (null for HTML), used to create children correctly. */
function nsOf(parent) {
  return parent && parent.namespaceURI === SVG_NS ? SVG_NS : null;
}

/**
 * Join truthy class parts into a className string.
 * Accepts strings, arrays, and objects ({cls: bool}).
 * @param {...*} parts
 * @returns {string}
 */
export function classNames(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === 'string' || typeof p === 'number') {
      out.push(String(p));
    } else if (Array.isArray(p)) {
      const inner = classNames(...p);
      if (inner) out.push(inner);
    } else if (typeof p === 'object') {
      for (const k of Object.keys(p)) if (p[k]) out.push(k);
    }
  }
  return out.join(' ');
}

/**
 * Flatten children, dropping null/false/undefined, leaving primitives + vnodes.
 * @param {Array<*>} children
 * @returns {Array<VNode|string|number>}
 */
function flatten(children) {
  const out = [];
  for (const c of children) {
    if (c === null || c === false || c === undefined || c === true) continue;
    if (Array.isArray(c)) {
      for (const x of flatten(c)) out.push(x);
    } else {
      out.push(c);
    }
  }
  return out;
}

/**
 * Hyperscript factory. Produces a plain VNode (component tags stay un-invoked
 * until render/serialize time so they remain pure and inspectable).
 * @param {string|symbol|Function} tag
 * @param {object|null} props
 * @param {...*} children
 * @returns {VNode}
 */
export function h(tag, props, ...children) {
  return { tag, props: props || {}, children: flatten(children) };
}

/** True for primitive (text) children. */
function isText(node) {
  return typeof node === 'string' || typeof node === 'number';
}

/** Resolve a component vnode (function tag) to its returned vnode. */
function resolveComponent(vnode) {
  const { tag, props, children } = vnode;
  const out = tag({ ...props, children });
  return out;
}

// ---------------------------------------------------------------------------
// String serialization (pure, no DOM) — what tests use.
// ---------------------------------------------------------------------------

/** Escape text content for HTML. */
function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape an attribute value (double-quoted). */
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Serialize a style object to a CSS string. */
function styleToString(style) {
  if (typeof style === 'string') return style;
  if (!style || typeof style !== 'object') return '';
  return Object.keys(style)
    .map((k) => {
      const prop = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      return `${prop}: ${style[k]}`;
    })
    .join('; ');
}

/** Serialize props -> attribute string (event handlers + children omitted). */
function propsToAttrs(props) {
  const attrs = [];
  for (const key of Object.keys(props)) {
    if (key === 'children' || key === 'key') continue;
    if (/^on[A-Z]/.test(key)) continue;
    const val = props[key];
    if (val === null || val === undefined || val === false) continue;
    if (key === 'class' || key === 'className') {
      const cls = typeof val === 'string' ? val : classNames(val);
      if (cls) attrs.push(`class="${escapeAttr(cls)}"`);
      continue;
    }
    if (key === 'style') {
      const s = styleToString(val);
      if (s) attrs.push(`style="${escapeAttr(s)}"`);
      continue;
    }
    if (val === true) {
      attrs.push(key);
      continue;
    }
    attrs.push(`${key}="${escapeAttr(val)}"`);
  }
  return attrs.length ? ' ' + attrs.join(' ') : '';
}

/**
 * Serialize a vnode to an HTML string. Pure — invokes component tags, omits
 * event handlers, escapes text + attributes.
 * @param {VNode|string|number|null} vnode
 * @returns {string}
 */
export function toHtml(vnode) {
  if (vnode === null || vnode === undefined || vnode === false || vnode === true) return '';
  if (isText(vnode)) return escapeText(vnode);
  if (Array.isArray(vnode)) return vnode.map(toHtml).join('');

  const { tag, props, children } = vnode;

  if (typeof tag === 'function') return toHtml(resolveComponent(vnode));
  if (tag === Fragment) return children.map(toHtml).join('');

  const inner = children.map(toHtml).join('');
  const attrs = propsToAttrs(props);
  if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

// ---------------------------------------------------------------------------
// Real DOM construction + patching.
// ---------------------------------------------------------------------------

/** Apply a single prop to a real DOM element. */
function setProp(el, key, val) {
  if (key === 'children' || key === 'key') return;
  if (/^on[A-Z]/.test(key)) {
    const ev = key.slice(2).toLowerCase();
    el.__handlers = el.__handlers || {};
    if (el.__handlers[ev]) el.removeEventListener(ev, el.__handlers[ev]);
    el.__handlers[ev] = val;
    if (typeof val === 'function') el.addEventListener(ev, val);
    return;
  }
  if (key === 'class' || key === 'className') {
    el.setAttribute('class', typeof val === 'string' ? val : classNames(val));
    return;
  }
  if (key === 'style') {
    el.setAttribute('style', styleToString(val));
    return;
  }
  if (key === 'value') {
    el.value = val == null ? '' : val;
    return;
  }
  if (key === 'checked') {
    el.checked = !!val;
    return;
  }
  if (val === false || val === null || val === undefined) {
    el.removeAttribute(key);
    return;
  }
  if (val === true) {
    el.setAttribute(key, '');
    return;
  }
  el.setAttribute(key, val);
}

/**
 * Build a real DOM node (Node) from a vnode. Fragments yield a DocumentFragment.
 * `ns` carries the active XML namespace down the tree: an `<svg>` tag enters the
 * SVG namespace (so the player radar / momentum chart render as graphics), and a
 * `<foreignObject>` drops its children back to HTML.
 * @param {VNode|string|number} vnode
 * @param {string|null} [ns]
 * @returns {Node}
 */
function createNode(vnode, ns) {
  if (isText(vnode)) return document.createTextNode(String(vnode));

  const { tag, props, children } = vnode;
  if (typeof tag === 'function') return createNode(resolveComponent(vnode), ns);

  if (tag === Fragment) {
    const frag = document.createDocumentFragment();
    for (const c of children) frag.appendChild(createNode(c, ns));
    return frag;
  }

  const elNs = tag === 'svg' ? SVG_NS : ns || null;
  const el = elNs && typeof document.createElementNS === 'function'
    ? document.createElementNS(elNs, tag)
    : document.createElement(tag);
  for (const key of Object.keys(props)) setProp(el, key, props[key]);
  el.__vnode = vnode;
  const childNs = tag === 'foreignObject' ? null : elNs;
  for (const c of children) el.appendChild(createNode(c, childNs));
  return el;
}

/**
 * Mount a vnode into a container, replacing its existing children.
 * @param {VNode} vnode
 * @param {Element} container
 */
export function mount(vnode, container) {
  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(createNode(vnode, nsOf(container)));
  container.__vnode = vnode;
}

/**
 * Re-render: diff the new vnode against the last one mounted on this container
 * and apply minimal DOM updates. Lists are matched by props.key.
 * @param {Element} container
 * @param {VNode} vnode
 */
export function patch(container, vnode) {
  const prev = container.__vnode;
  if (prev === undefined) {
    mount(vnode, container);
    return;
  }
  patchNode(container, container.firstChild, prev, vnode);
  container.__vnode = vnode;
}

/** Normalize a component/fragment vnode to a comparable element vnode tree-ish form. */
function normalize(vnode) {
  let v = vnode;
  while (v && typeof v === 'object' && typeof v.tag === 'function') {
    v = resolveComponent(v);
  }
  return v;
}

/** Key for a vnode child (explicit props.key, else null). */
function keyOf(vnode) {
  return vnode && typeof vnode === 'object' && vnode.props ? vnode.props.key : null;
}

/**
 * Patch a single DOM node in place (or replace it) to match newVnode.
 * @param {Node} parent
 * @param {Node} dom existing DOM node corresponding to oldVnode (may be null)
 * @param {*} oldVnode
 * @param {*} newVnode
 */
function patchNode(parent, dom, oldVnode, newVnode) {
  oldVnode = normalize(oldVnode);
  newVnode = normalize(newVnode);

  // Removal.
  if (newVnode === null || newVnode === undefined || newVnode === false) {
    if (dom) parent.removeChild(dom);
    return;
  }
  // Creation.
  if (!dom || oldVnode === null || oldVnode === undefined || oldVnode === false) {
    parent.appendChild(createNode(newVnode, nsOf(parent)));
    return;
  }
  // Text nodes.
  if (isText(newVnode) || isText(oldVnode)) {
    if (isText(newVnode) && isText(oldVnode)) {
      if (String(oldVnode) !== String(newVnode)) dom.nodeValue = String(newVnode);
    } else {
      parent.replaceChild(createNode(newVnode, nsOf(parent)), dom);
    }
    return;
  }
  // Fragment → just replace (rare; fragments mostly at roots).
  if (newVnode.tag === Fragment || oldVnode.tag === Fragment) {
    parent.replaceChild(createNode(newVnode, nsOf(parent)), dom);
    return;
  }
  // Different element type → replace.
  if (oldVnode.tag !== newVnode.tag) {
    parent.replaceChild(createNode(newVnode, nsOf(parent)), dom);
    return;
  }

  // Same element: reconcile props.
  const oldProps = oldVnode.props || {};
  const newProps = newVnode.props || {};
  for (const key of Object.keys(oldProps)) {
    if (!(key in newProps) && !/^on/.test(key) && key !== 'children' && key !== 'key') {
      if (key === 'class' || key === 'className') dom.removeAttribute('class');
      else if (key === 'value') dom.value = '';
      else if (key === 'checked') dom.checked = false;
      else dom.removeAttribute(key);
    }
  }
  for (const key of Object.keys(newProps)) {
    if (oldProps[key] !== newProps[key] || /^on/.test(key)) setProp(dom, key, newProps[key]);
  }
  dom.__vnode = newVnode;

  patchChildren(dom, oldVnode.children || [], newVnode.children || []);
}

/**
 * Reconcile children. If every new child carries a key, do a keyed reorder;
 * otherwise diff positionally.
 * @param {Element} parent
 * @param {Array} oldChildren
 * @param {Array} newChildren
 */
function patchChildren(parent, oldChildren, newChildren) {
  const newKeyed = newChildren.length > 0 && newChildren.every((c) => keyOf(c) != null);
  const oldKeyed = oldChildren.length > 0 && oldChildren.every((c) => keyOf(c) != null);

  if (newKeyed && oldKeyed) {
    // Map existing DOM nodes by key.
    const domByKey = new Map();
    let node = parent.firstChild;
    for (const oc of oldChildren) {
      if (node) {
        domByKey.set(String(keyOf(oc)), { dom: node, vnode: oc });
        node = node.nextSibling;
      }
    }
    let ref = parent.firstChild;
    for (const nc of newChildren) {
      const k = String(keyOf(nc));
      const existing = domByKey.get(k);
      if (existing) {
        patchNode(parent, existing.dom, existing.vnode, nc);
        if (existing.dom !== ref) parent.insertBefore(existing.dom, ref);
        else ref = ref ? ref.nextSibling : null;
        domByKey.delete(k);
      } else {
        parent.insertBefore(createNode(nc, nsOf(parent)), ref);
      }
    }
    for (const { dom } of domByKey.values()) parent.removeChild(dom);
    return;
  }

  // Positional diff.
  const max = Math.max(oldChildren.length, newChildren.length);
  const domNodes = [];
  let n = parent.firstChild;
  while (n) {
    domNodes.push(n);
    n = n.nextSibling;
  }
  for (let i = 0; i < max; i++) {
    patchNode(parent, domNodes[i], oldChildren[i], newChildren[i]);
  }
}
