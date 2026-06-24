/**
 * tests/ui/render.test.mjs — render layer (CONTRACTS-UI §1).
 * Covers: nesting, text/attribute escaping, attributes (class/style/value/checked),
 * Fragment, component-as-tag, classNames helper, and keyed-list patch verified by
 * serializing the patched DOM back to HTML and comparing to toHtml of the target.
 *
 * Default-exported async fn that throws on failure (per tests/run.mjs).
 */

import { assert } from '../_assert.mjs';
import { h, Fragment, toHtml, classNames, mount, patch } from '../../src/ui/render.js';

// ---------------------------------------------------------------------------
// Minimal DOM shim so mount()/patch() run headlessly under Node.
// Only the surface render.js touches is implemented.
// ---------------------------------------------------------------------------
const TEXT = 3;
const ELEM = 1;
const FRAG = 11;

class Node {
  constructor(type) {
    this.nodeType = type;
    this.childNodes = [];
    this.parentNode = null;
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get nextSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const i = p.childNodes.indexOf(this);
    return p.childNodes[i + 1] || null;
  }
  appendChild(child) {
    if (child.nodeType === FRAG) {
      for (const c of child.childNodes.slice()) this.appendChild(c);
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child, ref) {
    if (ref == null) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const i = this.childNodes.indexOf(ref);
    child.parentNode = this;
    this.childNodes.splice(i, 0, child);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  replaceChild(next, old) {
    const i = this.childNodes.indexOf(old);
    if (i < 0) return this.appendChild(next);
    if (next.parentNode) next.parentNode.removeChild(next);
    next.parentNode = this;
    this.childNodes[i] = next;
    old.parentNode = null;
    return old;
  }
}

class TextNode extends Node {
  constructor(text) {
    super(TEXT);
    this.nodeValue = text;
  }
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';

class Element extends Node {
  constructor(tag, ns) {
    super(ELEM);
    this.tagName = tag;
    this.namespaceURI = ns || XHTML_NS;
    this.attributes = {};
    this.value = '';
    this.checked = false;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }
  addEventListener() {}
  removeEventListener() {}
}

class Document {
  createElement(tag) {
    return new Element(tag, XHTML_NS);
  }
  createElementNS(ns, tag) {
    return new Element(tag, ns);
  }
  createTextNode(text) {
    return new TextNode(text);
  }
  createDocumentFragment() {
    return new Node(FRAG);
  }
}

/** Serialize a shim DOM node back to HTML for comparison with toHtml output. */
function domToHtml(node) {
  if (node.nodeType === TEXT) {
    return String(node.nodeValue)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  const tag = node.tagName;
  const attrs = Object.keys(node.attributes)
    .map((k) => ` ${k}="${node.attributes[k]}"`)
    .join('');
  const inner = node.childNodes.map(domToHtml).join('');
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

export default async function run() {
  // -- classNames helper -------------------------------------------------
  assert(classNames('a', false, 'b', null, undefined, 'c') === 'a b c', 'classNames truthy join');
  assert(classNames({ on: true, off: false }, ['x', 0, 'y']) === 'on x y', 'classNames obj+array');
  assert(classNames() === '', 'classNames empty');

  // -- nesting -----------------------------------------------------------
  const nested = h('div', { class: 'wrap' }, h('span', null, 'hi'), h('b', null, 'yo'));
  assert(
    toHtml(nested) === '<div class="wrap"><span>hi</span><b>yo</b></div>',
    `nesting html: ${toHtml(nested)}`
  );

  // -- null/false/undefined children flattened away ----------------------
  const sparse = h('ul', null, h('li', null, '1'), null, false, undefined, h('li', null, '2'));
  assert(toHtml(sparse) === '<ul><li>1</li><li>2</li></ul>', `sparse: ${toHtml(sparse)}`);

  // numbers become text
  assert(toHtml(h('span', null, 42)) === '<span>42</span>', 'number child');

  // -- text escaping -----------------------------------------------------
  const xss = h('p', null, '<script>alert("x & y")</script>');
  assert(
    toHtml(xss) === '<p>&lt;script&gt;alert("x &amp; y")&lt;/script&gt;</p>',
    `text escaping: ${toHtml(xss)}`
  );

  // -- attribute escaping ------------------------------------------------
  const attrEsc = h('a', { title: 'a "b" & <c>', href: 'x?q=1&r=2' }, 'link');
  assert(
    toHtml(attrEsc) ===
      '<a title="a &quot;b&quot; &amp; &lt;c&gt;" href="x?q=1&amp;r=2">link</a>',
    `attr escaping: ${toHtml(attrEsc)}`
  );

  // -- class/style/value/checked/boolean attrs ---------------------------
  const styled = h('div', { class: 'box', style: { color: 'red', backgroundColor: 'black' } });
  assert(
    toHtml(styled) === '<div class="box" style="color: red; background-color: black"></div>',
    `style: ${toHtml(styled)}`
  );
  const input = h('input', { type: 'checkbox', checked: true, value: 'v' });
  assert(toHtml(input) === '<input type="checkbox" checked value="v">', `input: ${toHtml(input)}`);
  // false-valued attrs dropped
  assert(toHtml(h('input', { disabled: false })) === '<input>', 'false attr dropped');

  // -- event handlers omitted in toHtml ----------------------------------
  let clicked = 0;
  const btn = h('button', { onClick: () => { clicked++; }, class: 'b' }, 'Go');
  assert(toHtml(btn) === '<button class="b">Go</button>', `handler omitted: ${toHtml(btn)}`);
  assert(clicked === 0, 'handler not called during serialize');

  // -- Fragment ----------------------------------------------------------
  const frag = h(Fragment, null, h('i', null, 'a'), h('i', null, 'b'));
  assert(toHtml(frag) === '<i>a</i><i>b</i>', `fragment: ${toHtml(frag)}`);
  assert(toHtml(h('div', null, frag)) === '<div><i>a</i><i>b</i></div>', 'fragment in parent');

  // -- component-as-tag --------------------------------------------------
  const Card = (props) => h('div', { class: 'card' }, h('h3', null, props.title), ...props.children);
  const comp = h(Card, { title: 'T' }, h('p', null, 'body'));
  assert(
    toHtml(comp) === '<div class="card"><h3>T</h3><p>body</p></div>',
    `component: ${toHtml(comp)}`
  );
  // nested components
  const List = (p) => h('ul', null, p.items.map((it) => h('li', { key: it }, it)));
  assert(
    toHtml(h(List, { items: ['x', 'y'] })) === '<ul><li>x</li><li>y</li></ul>',
    'component returning mapped list'
  );

  // -- mount + keyed list patch (via DOM shim, compared through HTML) -----
  globalThis.document = new Document();
  const container = new Element('div');

  const listVNode = (items) =>
    h('ul', { class: 'L' }, items.map((it) => h('li', { key: it.id }, it.text)));

  const v1 = listVNode([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }]);
  mount(v1, container);
  assert(
    domToHtml(container.firstChild) === toHtml(v1),
    `mount: ${domToHtml(container.firstChild)} vs ${toHtml(v1)}`
  );

  // Reorder + remove + add + edit text, keyed by id.
  const v2 = listVNode([{ id: 'c', text: 'C' }, { id: 'a', text: 'A2' }, { id: 'd', text: 'D' }]);
  patch(container, v2);
  assert(
    domToHtml(container.firstChild) === toHtml(v2),
    `keyed patch reorder: ${domToHtml(container.firstChild)} vs ${toHtml(v2)}`
  );

  // Patch attribute change on the container element itself.
  const v3 = h('ul', { class: 'L2' }, h('li', { key: 'a' }, 'A'));
  patch(container, v3);
  assert(
    domToHtml(container.firstChild) === toHtml(v3),
    `keyed patch shrink+attr: ${domToHtml(container.firstChild)} vs ${toHtml(v3)}`
  );

  // Positional (unkeyed) patch path.
  const c2 = new Element('div');
  mount(h('div', null, h('span', null, 'one'), h('span', null, 'two')), c2);
  const after = h('div', null, h('span', null, 'ONE'), h('span', null, 'two'), h('b', null, '!'));
  patch(c2, after);
  assert(
    domToHtml(c2.firstChild) === toHtml(after),
    `positional patch: ${domToHtml(c2.firstChild)} vs ${toHtml(after)}`
  );

  // -- SVG namespace: <svg> subtrees create in the SVG namespace ----------
  const svgHost = new Element('div');
  const svgVNode = h(
    'div',
    null,
    h('svg', { viewBox: '0 0 10 10' }, h('g', null, h('rect', { x: 1, y: 2, width: 3, height: 4 }))),
    h('p', null, 'html sibling')
  );
  mount(svgVNode, svgHost);
  const outerDiv = svgHost.firstChild;
  const svgEl = outerDiv.childNodes[0];
  const pEl = outerDiv.childNodes[1];
  assert(svgEl.tagName === 'svg' && svgEl.namespaceURI === SVG_NS, 'svg element is in the SVG namespace');
  const gEl = svgEl.firstChild;
  const rectEl = gEl.firstChild;
  assert(gEl.namespaceURI === SVG_NS, 'svg child <g> inherits the SVG namespace');
  assert(rectEl.namespaceURI === SVG_NS, 'nested <rect> inherits the SVG namespace');
  assert(pEl.namespaceURI === XHTML_NS, 'the HTML sibling stays in the XHTML namespace');

  // Patch INTO the svg subtree: a newly created child still gets the SVG ns.
  const svgVNode2 = h(
    'div',
    null,
    h('svg', { viewBox: '0 0 10 10' }, h('g', null, h('rect', { x: 1, y: 2, width: 3, height: 4 }), h('circle', { r: 2 }))),
    h('p', null, 'html sibling')
  );
  patch(svgHost, svgVNode2);
  const gEl2 = svgHost.firstChild.childNodes[0].firstChild;
  const circleEl = gEl2.childNodes[1];
  assert(circleEl && circleEl.tagName === 'circle' && circleEl.namespaceURI === SVG_NS, 'patched-in <circle> is in the SVG namespace');

  delete globalThis.document;
}
