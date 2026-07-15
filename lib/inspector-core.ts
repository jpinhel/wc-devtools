/**
 * inspector-core.ts — pure/testable functions extracted from wc-inspector.ts.
 *
 * All functions here are free of WXT dependencies and can run in Node/jsdom.
 * wc-inspector.ts imports from here and wires up the module-level instances.
 *
 * Design:
 *   - Stateless functions (serializeValue, detectFramework) are exported directly.
 *   - Stateful id registry is a factory (createIdRegistry) for test isolation.
 *   - buildWCNode / collectWCChildren take the registry as a parameter.
 *   - makeScheduler takes injectable tree + registry getters.
 *   - setProp takes an injectable resolveId function.
 */

import type {
  AdoptedStyleSheetInfo,
  AriaRefInfo,
  CssVarInfo,
  PartInfo,
  SerializableValue,
  SlotInfo,
  SourceRef,
  StencilHydrationState,
  TreePatch,
  WCFramework,
  WCNode,
  WCPropMeta,
} from '../types/wc';
import { serializeContextRequests, serializeSignals, serializeTasks } from './lit-labs';
import { extractStencilPropMeta } from './stencil-meta';
import { diffTree } from './tree-diff';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_DEPTH = 20;
// Per-container cap on collected WC nodes. Note: collectWCChildren FLATTENS
// components nested under non-custom containers into the same list, so this
// effectively caps a whole flattened region (the root list covers every
// top-level component of the page). 50 silently dropped late-DOM elements on
// real doc sites (e.g. a toast stack appended to <body>); 300 gives headroom
// while still bounding degenerate pages. Anything beyond the cap is counted
// and surfaced as "+N hidden" in the tree and status bar.
export const MAX_CHILDREN = 300;
export const MAX_PROPS = 30;
export const MAX_STRING_LENGTH = 500;
export const MAX_ARRAY_ITEMS = 20;
export const MAX_OBJECT_KEYS = 30;
export const MAX_SLOTS = 20;
export const MAX_ASSIGNED_NODES = 20;
export const MAX_PARTS = 50;
export const MAX_ADOPTED_SHEETS = 10;
export const MAX_CSS_VARS = 40;
export const MAX_STATES = 20;

// ── Framework-internal property blocklist ─────────────────────────────────────
//
// Short minified names used internally by frameworks — must never surface in the
// Properties tab as they are implementation details, not user-facing state.
//
const FRAMEWORK_INTERNAL_PROPS = new Set([
  // Stencil: scoped CSS parts, slot content refs, component IDs, style scoping
  's-p',
  's-cr',
  's-id',
  's-si',
  's-sc',
  's-hn',
]);

// ── Native prototype blocklist ────────────────────────────────────────────────

let _nativeProtoKeys: Set<string> | null = null;

export function getNativeProtoKeys(): Set<string> {
  if (_nativeProtoKeys) return _nativeProtoKeys;
  const keys = new Set<string>();
  const protos: object[] = [
    HTMLElement.prototype,
    Element.prototype,
    Node.prototype,
    EventTarget.prototype,
  ];
  for (const proto of protos) {
    let p: object | null = proto;
    while (p && p !== Object.prototype) {
      for (const k of Object.getOwnPropertyNames(p)) keys.add(k);
      p = Object.getPrototypeOf(p);
    }
  }
  _nativeProtoKeys = keys;
  return keys;
}

/** Reset cached native keys — only call from tests. */
export function _resetNativeProtoKeys(): void {
  _nativeProtoKeys = null;
}

// ── Value serialization ───────────────────────────────────────────────────────
//
// ASCII — decision tree:
//
//   value
//   ├── null/undefined/primitive  → return as-is (or string equivalent)
//   ├── Function/Symbol/BigInt    → return descriptive string
//   ├── DOM Node / Element        → return tag string
//   ├── depth >= 3                → return '[Object…]' sentinel
//   └── object / array
//       ├── visited (circular)    → return '[Circular]'
//       └── recurse (depth+1)     → truncate at limits
//

export function serializeValue(
  value: unknown,
  depth: number,
  visited: WeakSet<object>,
): SerializableValue {
  if (value === null) return null;
  if (value === undefined) return '[undefined]';
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'symbol') return `[Symbol: ${String(value)}]`;
  if (typeof value === 'bigint') return `[BigInt: ${value}]`;
  if (value instanceof Element) return `[Element: <${(value as Element).tagName.toLowerCase()}>]`;
  if (value instanceof Node) return '[Node]';
  if (depth >= 3) return '[Object…]';

  if (typeof value === 'object') {
    if (visited.has(value)) return '[Circular]';
    visited.add(value);
    try {
      if (Array.isArray(value)) {
        return (value as unknown[])
          .slice(0, MAX_ARRAY_ITEMS)
          .map((v) => serializeValue(v, depth + 1, visited));
      }
      const result: Record<string, SerializableValue> = {};
      for (const k of Object.keys(value).slice(0, MAX_OBJECT_KEYS)) {
        try {
          result[k] = serializeValue((value as Record<string, unknown>)[k], depth + 1, visited);
        } catch {
          result[k] = '[Error reading key]';
        }
      }
      return result;
    } finally {
      // Allow the same object in sibling branches (only block true cycles)
      visited.delete(value);
    }
  }

  return String(value);
}

// ── Framework detection ───────────────────────────────────────────────────────

export function detectFramework(element: Element): WCFramework {
  const ctor = element.constructor as unknown as Record<string, unknown>;
  const proto = (ctor.prototype as Record<string, unknown> | undefined) ?? null;

  // Stencil — checked before Lit so its compiled components are never
  // misclassified by Lit heuristics.
  //   - Lazy bundle path (bootstrap-lazy.ts): `componentOnReady` is stamped
  //     on every host element prototype.
  //   - Standalone bundle path (bootstrap-custom-element.ts): proxyCustomElement
  //     stamps `__registerHost` / `__attachShadow` on the prototype.
  //   - SSR-hydrated elements: `s-id` / `s-hn` / `s-rc` on the instance.
  try {
    if (proto && typeof proto.componentOnReady === 'function') return 'stencil';
    if (proto && typeof proto.__registerHost === 'function') return 'stencil';
    if (proto && typeof proto.__attachShadow === 'function') return 'stencil';
    const inst = element as Element & Record<string, unknown>;
    if (inst['s-id'] !== undefined) return 'stencil';
    if (inst['s-hn'] !== undefined) return 'stencil';
    if (inst['s-rc'] !== undefined) return 'stencil';
    if (ctor.__stencilApp !== undefined) return 'stencil';
    if (ctor.$watchers$ !== undefined || ctor.$deserializers$ !== undefined) return 'stencil';
    // Page-wide marker — set by Stencil's prerender step on the host document.
    // Only treat as Stencil if the element isn't already detected as something
    // more specific (Lit/FAST run after this block so they still win).
    const gen = document.querySelector('meta[name="generator"]')?.getAttribute('content');
    if (gen?.startsWith('Stencil') && 'componentOnReady' in element) return 'stencil';
  } catch {
    /* ignore */
  }

  // Lit — only positive, strict markers. Past versions used
  // `elementProperties instanceof Map` as a fallback, but that produced
  // false positives on unrelated classes (notably Stencil components on
  // pages that also bundle Lit), so it's been removed.
  try {
    if (ctor._$litElement$ === true) return 'lit';
    if (ctor.__litElement__ === true) return 'lit';
  } catch {
    /* ignore getter side-effects */
  }

  try {
    if ('$fastController' in element) return 'fast';
    if (ctor.definition !== undefined && typeof ctor.definition === 'object') return 'fast';
  } catch {
    /* ignore */
  }

  return 'vanilla';
}

// ── Click-to-source stack parsing ─────────────────────────────────────────────
//
// A stack captured inside the patched `customElements.define` looks like:
//
//   Chrome:  "    at defineWrapper (chrome-extension://…/wc-inspector.js:12:3)"
//            "    at https://site.com/assets/app.js:123:45"
//            "    at Module.foo (https://site.com/assets/app.js:123:45)"
//   Firefox: "defineWrapper@moz-extension://…/wc-inspector.js:12:3"
//            "foo@https://site.com/assets/app.js:123:45"
//
// Extension frames never match (protocol whitelist), so the first http(s)/file
// frame is the page-side caller. Frames from bundled dependencies (Lit's
// decorator helpers live in a node_modules/.vite chunk, not the component
// file) are deprioritized — used only when no app-code frame exists.

const STACK_FRAME_RE = /((?:https?|file):\/\/[^\s()]+?):(\d+):(\d+)\)?\s*$/;
const LIBRARY_URL_RE = /node_modules\/|\/\.vite\/deps\//;

export function parseStackSourceRef(stack: string): SourceRef | null {
  let libraryFallback: SourceRef | null = null;
  for (const line of stack.split('\n')) {
    const m = line.match(STACK_FRAME_RE);
    if (!m) continue;
    const ref: SourceRef = { url: m[1], line: Number(m[2]), column: Number(m[3]) };
    if (!LIBRARY_URL_RE.test(ref.url)) return ref;
    libraryFallback ??= ref;
  }
  return libraryFallback;
}

// ── Framework version detection ───────────────────────────────────────────────

export function detectFrameworkVersion(
  element: Element,
  framework: WCFramework,
): string | undefined {
  if (framework === 'lit') {
    const ctor = element.constructor as unknown as Record<string, unknown>;
    const versions = (globalThis as { litElementVersions?: string[] }).litElementVersions;
    // Only trust the global registry when there's a single entry — multiple
    // entries mean several Lit copies on the page, and we can't tell which
    // one this element belongs to without confusing the user.
    if (Array.isArray(versions) && versions.length === 1) return versions[0];
    if (ctor._$litElement$ === true) return '3.x';
    if (ctor.__litElement__ === true) return '2.x';
    return undefined;
  }
  if (framework === 'stencil') {
    const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content');
    if (generator?.startsWith('Stencil')) return generator.replace(/^Stencil\s+/, '');
    return undefined;
  }
  return undefined;
}

// ── Stencil hydration detection ───────────────────────────────────────────────

/**
 * Heuristic detection of Stencil hydration state.
 *
 * - `s-id` attribute is set at SSR time (server-rendered).
 * - `s-hn` field is set at runtime by Stencil's lazy-built `connectedCallback`.
 *
 * Combinations:
 *  - `s-hn` present              → hydrated (whether SSR was used or not)
 *  - `s-id` present, no `s-hn`   → SSR-only (not yet hydrated)
 *  - neither                     → unknown
 */
export function detectStencilHydration(element: Element): StencilHydrationState {
  const hasSsrMarker = element.hasAttribute('s-id');
  const hasHydratedMarker = (element as Element & Record<'s-hn', unknown>)['s-hn'] !== undefined;
  if (hasHydratedMarker) return 'hydrated';
  if (hasSsrMarker) return 'ssr-only';
  return 'unknown';
}

// ── Property / attribute serialization ───────────────────────────────────────

export function serializeProperties(element: Element): Record<string, SerializableValue> {
  const propNames = new Set<string>();
  const ctor = element.constructor as {
    observedAttributes?: string[];
    elementProperties?: Map<PropertyKey, unknown>;
  };

  // Lit elements declare reactive props in elementProperties — use it directly
  // to avoid picking up lifecycle methods (render, update, shouldUpdate, etc.)
  if (ctor.elementProperties instanceof Map) {
    for (const key of ctor.elementProperties.keys()) {
      propNames.add(String(key));
    }
  } else {
    // Generic WC: observed attributes + own instance props + prototype chain
    const NATIVE = getNativeProtoKeys();

    for (const k of ctor.observedAttributes ?? []) propNames.add(k);

    Object.getOwnPropertyNames(element).forEach((k) => {
      if (!NATIVE.has(k) && !k.startsWith('_') && !FRAMEWORK_INTERNAL_PROPS.has(k))
        propNames.add(k);
    });

    let proto = Object.getPrototypeOf(element) as object | null;
    while (proto && proto !== HTMLElement.prototype) {
      Object.getOwnPropertyNames(proto).forEach((k) => {
        if (
          !NATIVE.has(k) &&
          !k.startsWith('_') &&
          k !== 'constructor' &&
          !FRAMEWORK_INTERNAL_PROPS.has(k)
        )
          propNames.add(k);
      });
      proto = Object.getPrototypeOf(proto);
    }
  }

  const props: Record<string, SerializableValue> = {};
  const visited = new WeakSet<object>();
  let count = 0;

  for (const k of propNames) {
    let rawValue: unknown;
    try {
      rawValue = (element as unknown as Record<string, unknown>)[k];
    } catch {
      props[k] = '[Error reading property]';
      count++;
      continue;
    }

    // Skip functions (methods are not inspectable state) and undefined (uninitialized)
    if (typeof rawValue === 'function' || rawValue === undefined) continue;

    if (count >= MAX_PROPS) {
      props['[…truncated]'] = `${propNames.size - MAX_PROPS} more properties`;
      break;
    }
    count++;

    props[k] = serializeValue(rawValue, 0, visited);
  }

  return props;
}

// ── Property metadata (kind: state/prop/attribute + reflects) ────────────────

export function serializePropMeta(element: Element): Record<string, WCPropMeta> {
  const result: Record<string, WCPropMeta> = {};
  const ctor = element.constructor as {
    observedAttributes?: string[];
    elementProperties?: Map<PropertyKey, { state?: boolean; reflect?: boolean }>;
  };

  if (ctor.elementProperties instanceof Map) {
    for (const [key, decl] of ctor.elementProperties.entries()) {
      const name = String(key);
      const isState = decl?.state === true;
      result[name] = {
        kind: isState ? 'state' : 'prop',
        reflects: decl?.reflect === true,
      };
    }
  }

  // Stencil path — read MEMBER_FLAGS bit field on cmpMeta$.$members$ to
  // distinguish @Prop vs @State and surface reflect modifiers. Only fires
  // when the component constructor exposes cmpMeta$ (Stencil-compiled).
  if ('cmpMeta$' in ctor) {
    const stencilMeta = extractStencilPropMeta(ctor);
    for (const [name, meta] of Object.entries(stencilMeta)) {
      if (result[name]) continue; // already declared (e.g. via Lit path)
      result[name] = meta;
    }
  }

  for (const k of ctor.observedAttributes ?? []) {
    if (result[k]) continue; // Lit/Stencil already accounted for
    result[k] = { kind: 'attribute', reflects: true };
  }

  return result;
}

export function serializeAttributes(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  Array.from(element.attributes).forEach((a) => {
    attrs[a.name] = a.value;
  });
  return attrs;
}

// ── Slots ─────────────────────────────────────────────────────────────────────

export function serializeSlots(element: Element): SlotInfo[] {
  const sr = element.shadowRoot;
  if (!sr) return [];
  const slots = Array.from(sr.querySelectorAll('slot')).slice(0, MAX_SLOTS);
  const result: SlotInfo[] = [];
  for (const slot of slots) {
    const assigned = (slot as HTMLSlotElement).assignedNodes({ flatten: false });
    const assignedNodes = assigned
      .slice(0, MAX_ASSIGNED_NODES)
      .filter((n): n is Element => n.nodeType === Node.ELEMENT_NODE)
      .map((n) => n.tagName.toLowerCase());
    const fallbackNodes = Array.from(slot.children)
      .slice(0, MAX_ASSIGNED_NODES)
      .map((n) => n.tagName.toLowerCase());
    result.push({
      name: (slot as HTMLSlotElement).name,
      assignedNodes,
      fallbackNodes,
      slottedRuleCount: countSlottedRules(sr),
    });
  }
  return result;
}

function countSlottedRules(sr: ShadowRoot): number {
  let count = 0;
  // Inline <style> elements inside the shadow root. NOTE: jsdom 29 returns null
  // for sheet on shadow-root <style>, so this branch is not directly covered by
  // unit tests; the adoptedStyleSheets branch below provides equivalent coverage.
  for (const style of Array.from(sr.querySelectorAll('style'))) {
    const sheet = (style as HTMLStyleElement).sheet;
    if (!sheet) continue;
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if ((rule as CSSStyleRule).selectorText?.includes('::slotted')) count++;
      }
    } catch {
      /* cross-origin or pending stylesheet — ignore */
    }
  }
  // Constructible stylesheets adopted by the shadow root.
  for (const sheet of sr.adoptedStyleSheets ?? []) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if ((rule as CSSStyleRule).selectorText?.includes('::slotted')) count++;
      }
    } catch {
      /* ignore */
    }
  }
  return count;
}

// ── Parts ─────────────────────────────────────────────────────────────────────

export function serializeParts(element: Element): PartInfo[] {
  const sr = element.shadowRoot;
  if (!sr) return [];
  const parts: PartInfo[] = [];
  const elementsWithPart = Array.from(sr.querySelectorAll('[part]')).slice(0, MAX_PARTS);
  for (const el of elementsWithPart) {
    const value = el.getAttribute('part') ?? '';
    const names = value.split(/\s+/).filter(Boolean);
    for (const name of names) {
      parts.push({
        name,
        elementTag: el.tagName.toLowerCase(),
        ruleCount: countPartRules(name),
      });
    }
  }
  return parts;
}

function countPartRules(partName: string): number {
  const escaped = partName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ::part(...) takes a space-separated list of identifiers (no commas).
  // Match `partName` as a full token: preceded by `(` or whitespace, followed by `)` or whitespace.
  const re = new RegExp(`::part\\(\\s*(?:[^)\\s]+\\s+)*${escaped}(?=\\s|\\))`);
  let count = 0;
  const sheets: CSSStyleSheet[] = [];
  for (const sheet of Array.from(document.styleSheets)) sheets.push(sheet as CSSStyleSheet);
  // Document adopted sheets — directly access the typed property (always present in modern lib.dom.d.ts; nullish-guard for jsdom).
  if (document.adoptedStyleSheets) sheets.push(...document.adoptedStyleSheets);

  for (const sheet of sheets) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        const selector = (rule as CSSStyleRule).selectorText;
        if (!selector) continue;
        if (re.test(selector)) count++;
      }
    } catch {
      /* cross-origin or empty sheet */
    }
  }
  return count;
}

// ── Adopted stylesheets ───────────────────────────────────────────────────────

export function serializeAdoptedStyles(element: Element): AdoptedStyleSheetInfo[] {
  const sr = element.shadowRoot;
  if (!sr) return [];
  const adopted = sr.adoptedStyleSheets ?? [];
  if (adopted.length === 0) return [];
  const result: AdoptedStyleSheetInfo[] = [];
  for (const sheet of adopted.slice(0, MAX_ADOPTED_SHEETS)) {
    try {
      const text = Array.from(sheet.cssRules)
        .map((r) => (r as CSSStyleRule).cssText)
        .join('\n');
      result.push({
        cssText: text.length > MAX_STRING_LENGTH ? `${text.slice(0, MAX_STRING_LENGTH)}…` : text,
        ruleCount: sheet.cssRules.length,
      });
    } catch {
      result.push({ cssText: '[unreadable sheet]', ruleCount: 0 });
    }
  }
  return result;
}

// ── CSS custom properties ─────────────────────────────────────────────────────

export function serializeCssVars(element: Element): CssVarInfo[] {
  const declared = new Set<string>();
  const declaredOnHost = new Set<string>();

  // Inline style on the host counts as declared on host.
  if (element instanceof HTMLElement) {
    for (let i = 0; i < element.style.length; i++) {
      const name = element.style[i];
      if (name?.startsWith('--')) {
        declared.add(name);
        declaredOnHost.add(name);
      }
    }
  }

  // Collect every sheet that may declare vars affecting the host.
  // Track shadow-root sheets separately so :host rules from the document
  // (which have no effect there) are not credited as host-declared.
  const sheets: CSSStyleSheet[] = [];
  const shadowSheets = new Set<CSSStyleSheet>();
  for (const sheet of Array.from(document.styleSheets)) sheets.push(sheet as CSSStyleSheet);
  const sr = element.shadowRoot;
  if (sr) {
    for (const style of Array.from(sr.querySelectorAll('style'))) {
      const sheet = (style as HTMLStyleElement).sheet;
      if (sheet) {
        sheets.push(sheet);
        shadowSheets.add(sheet);
      }
    }
    if (sr.adoptedStyleSheets) {
      for (const sheet of sr.adoptedStyleSheets) {
        sheets.push(sheet);
        shadowSheets.add(sheet);
      }
    }
  }

  for (const sheet of sheets) {
    const sheetIsShadowLocal = shadowSheets.has(sheet);
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        const styleRule = rule as CSSStyleRule;
        if (!styleRule.style) continue;
        const sel = styleRule.selectorText ?? '';
        // :host rules only count from shadow-root-local sheets.
        // :host-context(...) targets ancestor context — NOT a host declaration.
        const isHostRule =
          sheetIsShadowLocal &&
          (sel === ':host' ||
            sel.startsWith(':host(') ||
            sel.startsWith(':host ') ||
            sel.startsWith(':host,') ||
            sel.startsWith(':host::'));
        for (let i = 0; i < styleRule.style.length; i++) {
          const name = styleRule.style[i];
          if (name?.startsWith('--')) {
            declared.add(name);
            if (isHostRule) declaredOnHost.add(name);
          }
        }
      }
    } catch {
      /* cross-origin, restricted, or detached sheet */
    }
  }

  let computed: CSSStyleDeclaration | null = null;
  if (element instanceof HTMLElement) {
    try {
      computed = getComputedStyle(element);
    } catch {
      /* detached or restricted — fall back to no resolved values */
    }
  }
  const result: CssVarInfo[] = [];
  for (const name of Array.from(declared).sort().slice(0, MAX_CSS_VARS)) {
    const value = computed ? computed.getPropertyValue(name) : '';
    result.push({
      name,
      computedValue: value,
      declaredOnHost: declaredOnHost.has(name),
    });
  }
  return result;
}

// ── CustomStateSet ────────────────────────────────────────────────────────────

function getInternals(element: Element): ElementInternals | null {
  const lookup = (window as unknown as Record<string, unknown>).__wc_devtools_internals as
    | ((el: Element) => ElementInternals | null)
    | undefined;
  if (typeof lookup !== 'function') return null;
  try {
    return lookup(element);
  } catch {
    return null;
  }
}

export function serializeCustomStates(element: Element): string[] {
  const internals = getInternals(element);
  if (!internals) return [];
  const states = (internals as ElementInternals & { states?: Iterable<string> }).states;
  if (!states) return [];
  const out: string[] = [];
  let i = 0;
  for (const s of states) {
    if (i++ >= MAX_STATES) break;
    out.push(s);
  }
  return out;
}

export function toggleCustomState(
  element: Element,
  state: string,
  enabled: boolean,
): { success: boolean; error?: string } {
  const internals = getInternals(element);
  if (!internals) return { success: false, error: 'No ElementInternals attached.' };
  const states = (
    internals as ElementInternals & {
      states?: { add(s: string): void; delete(s: string): void };
    }
  ).states;
  if (!states) return { success: false, error: 'CustomStateSet not available.' };
  try {
    if (enabled) states.add(state);
    else states.delete(state);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ── Cross-root ARIA ───────────────────────────────────────────────────────────

const ARIA_IDREF_ATTRS = [
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'aria-owns',
  'aria-flowto',
  'aria-activedescendant',
] as const;

export function serializeAriaRefs(element: Element): AriaRefInfo[] {
  const result: AriaRefInfo[] = [];
  const sourceRoot = element.getRootNode(); // uncomposed: stops at the nearest shadow boundary
  for (const attr of ARIA_IDREF_ATTRS) {
    const value = element.getAttribute(attr);
    if (!value) continue;
    const ids = [...new Set(value.trim().split(/\s+/).filter(Boolean))];
    let crossRoot = false;
    for (const id of ids) {
      // Heuristic lookup — not spec-compliant ARIA resolution.
      // ARIA scopes idrefs to the source element's tree-scope. We probe a wider
      // set of roots so the devtool can surface cross-root references that real
      // browsers may resolve in practice (e.g. aria-* on a light-DOM element
      // pointing into its own shadow root) even though the ARIA spec does not
      // formally support that direction.
      const target =
        (sourceRoot as Document | ShadowRoot).getElementById?.(id) ??
        document.getElementById(id) ??
        element.shadowRoot?.getElementById(id) ??
        null;
      if (target && target.getRootNode() !== sourceRoot) {
        crossRoot = true;
        break;
      }
    }
    result.push({ attribute: attr, ids, crossRoot });
  }
  return result;
}

// ── Element ID registry (factory — one instance per test / one global in prod) ─

export interface IdRegistry {
  getOrCreateId(element: Element): string;
  resolveId(nodeId: string): Element | null;
  /** True if this registry minted the id — used to ignore broadcast commands aimed at another frame. */
  hasId(nodeId: string): boolean;
  markClosedShadow(element: Element): void;
  hasClosedShadow(element: Element): boolean;
}

/**
 * @param prefix Frame discriminator. Commands are broadcast to every frame in
 * the tab, so ids must be unique across frames: the top frame uses no prefix
 * (`wc-0`), iframes pass a random prefix (`wc-a1b2c3-0`).
 */
export function createIdRegistry(prefix = ''): IdRegistry {
  const elementIds = new WeakMap<Element, string>();
  const idMap = new Map<string, Element>();
  const closedShadowHosts = new WeakSet<Element>();
  let idCounter = 0;

  function getOrCreateId(element: Element): string {
    const existing = elementIds.get(element);
    if (existing !== undefined) return existing;
    const id = prefix ? `wc-${prefix}-${idCounter++}` : `wc-${idCounter++}`;
    elementIds.set(element, id);
    idMap.set(id, element);
    return id;
  }

  function resolveId(nodeId: string): Element | null {
    const el = idMap.get(nodeId);
    if (!el?.isConnected) return null;
    return el;
  }

  function hasId(nodeId: string): boolean {
    return idMap.has(nodeId);
  }

  function markClosedShadow(element: Element): void {
    closedShadowHosts.add(element);
  }

  function hasClosedShadow(element: Element): boolean {
    return closedShadowHosts.has(element);
  }

  return { getOrCreateId, resolveId, hasId, markClosedShadow, hasClosedShadow };
}

// ── Method collection ─────────────────────────────────────────────────────────
//
// Lifecycle methods from Web Components standard + common frameworks.
// These are excluded from the user-defined methods list.
//
const LIFECYCLE_METHODS = new Set([
  // Web Components standard
  'connectedCallback',
  'disconnectedCallback',
  'attributeChangedCallback',
  'adoptedCallback',
  'formAssociatedCallback',
  'formDisabledCallback',
  'formResetCallback',
  'formStateRestoreCallback',
  // Lit
  'render',
  'update',
  'shouldUpdate',
  'willUpdate',
  'updated',
  'firstUpdated',
  'requestUpdate',
  'performUpdate',
  'scheduleUpdate',
  'getUpdateComplete',
  'addController',
  'removeController',
  'enableUpdating',
  // Stencil
  'componentWillLoad',
  'componentDidLoad',
  'componentWillRender',
  'componentDidRender',
  'componentWillUpdate',
  'componentDidUpdate',
  'componentDidUnload',
]);

export function serializeMethods(element: Element): string[] {
  const NATIVE = getNativeProtoKeys();
  const methods: string[] = [];
  const seen = new Set<string>();

  let proto = Object.getPrototypeOf(element) as object | null;
  while (proto && proto !== HTMLElement.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      if (seen.has(k) || k === 'constructor') {
        seen.add(k);
        continue;
      }
      seen.add(k);
      if (NATIVE.has(k) || LIFECYCLE_METHODS.has(k)) continue;
      if (k.startsWith('_') || k.startsWith('#')) continue;
      try {
        const desc = Object.getOwnPropertyDescriptor(proto, k);
        if (desc && typeof desc.value === 'function') methods.push(k);
      } catch {
        /* ignore getter side-effects */
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return methods;
}

// ── Custom element check ──────────────────────────────────────────────────────

export function isCustomElement(element: Element): boolean {
  return element.tagName.includes('-');
}

// ── Tree building ─────────────────────────────────────────────────────────────

export interface CollectedChildren {
  nodes: WCNode[];
  /** WC excluded by the capacity cap in this flattened region — never silent. */
  dropped: number;
}

/**
 * Collects the WC nodes of one flattened region: custom elements become nodes
 * (their own children are collected by buildWCNode), non-custom containers are
 * traversed and their WC descendants land in the SAME list. `capacity` caps the
 * region; everything beyond it is still counted so the UI can show "+N hidden".
 */
export function collectWCChildren(
  container: Element | ShadowRoot,
  depth: number,
  registry: IdRegistry,
  capacity: number = MAX_CHILDREN,
): CollectedChildren {
  if (depth > MAX_DEPTH) return { nodes: [], dropped: 0 };

  const nodes: WCNode[] = [];
  let dropped = 0;

  for (const child of Array.from(container.children)) {
    if (isCustomElement(child)) {
      if (nodes.length < capacity) {
        nodes.push(buildWCNode(child, depth, registry));
      } else {
        dropped++;
      }
    } else {
      const nested = collectWCChildren(child, depth, registry, capacity - nodes.length);
      nodes.push(...nested.nodes);
      dropped += nested.dropped;
      if (child.shadowRoot) {
        const srNested = collectWCChildren(
          child.shadowRoot,
          depth,
          registry,
          capacity - nodes.length,
        );
        nodes.push(...srNested.nodes);
        dropped += srNested.dropped;
      }
    }
  }

  return { nodes, dropped };
}

// Safely run a serializer — if it throws (e.g. a custom getter fails before
// the component is fully initialized) we want the tree walk to keep going
// rather than aborting the entire snapshot. Returning the fallback lets the
// node appear in the tree with whatever data we did manage to collect.
function safeCall<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[wc-devtools] ${label} threw, falling back to default`, err);
    }
    return fallback;
  }
}

export function buildWCNode(element: Element, depth: number, registry: IdRegistry): WCNode {
  const id = registry.getOrCreateId(element);
  const collected = safeCall(
    'collectWCChildren(light)',
    () => collectWCChildren(element, depth + 1, registry),
    // Fresh fallback per call — a shared array would alias children across nodes
    { nodes: [], dropped: 0 },
  );

  let shadowRoot: WCNode[] | null | 'closed' = null;
  let droppedShadow: number | undefined;
  if (element.shadowRoot !== null) {
    const shadowCollected = safeCall(
      'collectWCChildren(shadow)',
      () => collectWCChildren(element.shadowRoot as ShadowRoot, depth + 1, registry),
      { nodes: [], dropped: 0 },
    );
    shadowRoot = shadowCollected.nodes;
    droppedShadow = shadowCollected.dropped > 0 ? shadowCollected.dropped : undefined;
  } else if (registry.hasClosedShadow(element)) {
    shadowRoot = 'closed';
  }

  const fw = safeCall('detectFramework', () => detectFramework(element), 'vanilla' as WCFramework);
  const sigs = safeCall('serializeSignals', () => serializeSignals(element), []);
  const signals = sigs.length ? sigs : undefined;
  const contextRequests =
    fw === 'lit'
      ? safeCall('serializeContextRequests', () => serializeContextRequests(element), [])
      : undefined;
  const tasks =
    fw === 'lit' ? safeCall('serializeTasks', () => serializeTasks(element), []) : undefined;
  const stencilHydration =
    fw === 'stencil'
      ? safeCall('detectStencilHydration', () => detectStencilHydration(element), undefined)
      : undefined;
  const sourceRef = safeCall(
    'sourceRef',
    () => {
      const lookup = (window as unknown as Record<string, unknown>).__wc_devtools_source as
        | ((tag: string) => SourceRef | null)
        | undefined;
      return lookup?.(element.tagName.toLowerCase()) ?? undefined;
    },
    undefined,
  );
  return {
    id,
    tagName: element.tagName.toLowerCase(),
    attributes: safeCall('serializeAttributes', () => serializeAttributes(element), {}),
    properties: safeCall('serializeProperties', () => serializeProperties(element), {}),
    shadowRoot,
    children: collected.nodes,
    droppedChildren: collected.dropped > 0 ? collected.dropped : undefined,
    droppedShadow,
    depth,
    framework: fw,
    frameworkVersion: safeCall(
      'detectFrameworkVersion',
      () => detectFrameworkVersion(element, fw),
      undefined,
    ),
    methods: safeCall('serializeMethods', () => serializeMethods(element), []),
    slots: safeCall('serializeSlots', () => serializeSlots(element), []),
    parts: safeCall('serializeParts', () => serializeParts(element), []),
    adoptedStyles: safeCall('serializeAdoptedStyles', () => serializeAdoptedStyles(element), []),
    cssVars: safeCall('serializeCssVars', () => serializeCssVars(element), []),
    customStates: safeCall('serializeCustomStates', () => serializeCustomStates(element), []),
    ariaRefs: safeCall('serializeAriaRefs', () => serializeAriaRefs(element), []),
    propMeta: safeCall('serializePropMeta', () => serializePropMeta(element), {}),
    signals: signals && signals.length > 0 ? signals : undefined,
    contextRequests: contextRequests && contextRequests.length > 0 ? contextRequests : undefined,
    tasks: tasks && tasks.length > 0 ? tasks : undefined,
    stencilHydration,
    sourceRef,
  };
}

// ── Debounced scheduler ────────────────────────────────────────────────────────

export interface Scheduler {
  schedule(): void;
  forceRefresh(): void;
  /** Permanently stops the scheduler — pending timer cleared, future calls no-op. */
  dispose(): void;
}

/**
 * Creates a scheduler that debounces sends (300ms) and ships diff patches
 * keyed by stable WCNode id. The first send (and any send where the patch
 * batch would exceed MAX_PATCHES_PER_BATCH) ships a full snapshot instead.
 *
 * @param getTree       - injectable tree builder (default: buildWCTree from DOM)
 * @param getRegistry   - injectable registry getter
 * @param msgVersion    - message version constant
 */
export const MAX_PATCHES_PER_BATCH = 200;

export function makeScheduler(
  getTree: () => CollectedChildren,
  getRegistryFn: () => string[],
  msgVersion: number,
  // Observes outgoing patches — used by trace-updates to flash re-rendered nodes
  onPatches?: (patches: TreePatch[]) => void,
): Scheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTree: WCNode[] = [];
  let firstSendDone = false;
  let disposed = false;

  function postSnapshot(tree: WCNode[], truncated: number): void {
    window.postMessage(
      {
        source: 'wc-devtools-injected',
        version: msgVersion,
        type: 'tree-snapshot',
        tree,
        registry: getRegistryFn(),
        truncated: truncated > 0 ? truncated : undefined,
      },
      '*',
    );
  }

  function postPatches(patches: TreePatch[], truncated: number): void {
    window.postMessage(
      {
        source: 'wc-devtools-injected',
        version: msgVersion,
        type: 'tree-patches',
        patches,
        registry: getRegistryFn(),
        truncated: truncated > 0 ? truncated : undefined,
      },
      '*',
    );
  }

  function send(): void {
    let built: CollectedChildren;
    try {
      built = getTree();
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[wc-devtools] tree build failed, keeping previous snapshot', err);
      }
      return;
    }
    const { nodes: tree, dropped } = built;
    if (!firstSendDone) {
      firstSendDone = true;
      lastTree = tree;
      postSnapshot(tree, dropped);
      return;
    }
    const patches = diffTree(lastTree, tree);
    if (patches.length === 0) return;
    if (patches.length > MAX_PATCHES_PER_BATCH) {
      postSnapshot(tree, dropped);
    } else {
      postPatches(patches, dropped);
      try {
        onPatches?.(patches);
      } catch {
        /* observer must never break the send path */
      }
    }
    lastTree = tree;
  }

  function schedule(): void {
    if (disposed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      send();
    }, 300);
  }

  function forceRefresh(): void {
    if (disposed) return;
    firstSendDone = false; // next send is a snapshot
    send();
  }

  function dispose(): void {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return { schedule, forceRefresh, dispose };
}

// ── Live prop editing ─────────────────────────────────────────────────────────

export function setAttr(
  nodeId: string,
  attrName: string,
  value: string,
  resolveIdFn: (id: string) => Element | null,
): { success: boolean; error?: string } {
  const element = resolveIdFn(nodeId);
  if (!element) return { success: false, error: 'Element no longer in DOM' };
  try {
    element.setAttribute(attrName, value);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function removeAttr(
  nodeId: string,
  attrName: string,
  resolveIdFn: (id: string) => Element | null,
): { success: boolean; error?: string } {
  const element = resolveIdFn(nodeId);
  if (!element) return { success: false, error: 'Element no longer in DOM' };
  try {
    element.removeAttribute(attrName);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Invokes a user-defined method on the element. Returns the raw value —
 * the caller serializes it (and awaits it if it's a Promise) so this stays
 * synchronous and unit-testable.
 */
export function callMethod(
  nodeId: string,
  methodName: string,
  args: SerializableValue[],
  resolveIdFn: (id: string) => Element | null,
): { success: true; value: unknown } | { success: false; error: string } {
  const element = resolveIdFn(nodeId);
  if (!element) return { success: false, error: 'Element no longer in DOM' };
  const fn = (element as unknown as Record<string, unknown>)[methodName];
  if (typeof fn !== 'function') {
    return { success: false, error: `${methodName} is not a function` };
  }
  try {
    return { success: true, value: fn.apply(element, args) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export function setProp(
  nodeId: string,
  propName: string,
  value: SerializableValue,
  resolveIdFn: (id: string) => Element | null,
): { success: boolean; error?: string } {
  const element = resolveIdFn(nodeId);
  if (!element) return { success: false, error: 'Element no longer in DOM' };

  let proto: object | null = element;
  let descriptor: PropertyDescriptor | undefined;
  while (proto) {
    descriptor = Object.getOwnPropertyDescriptor(proto, propName);
    if (descriptor) break;
    proto = Object.getPrototypeOf(proto);
  }
  if (descriptor && !descriptor.writable && !descriptor.set) {
    return { success: false, error: `"${propName}" is read-only` };
  }

  try {
    (element as unknown as Record<string, unknown>)[propName] = value;
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
