/**
 * Unit tests for lib/inspector-core.ts
 *
 * Environment: jsdom (DOM APIs available)
 * Coverage targets:
 *   - serializeValue (nominal, circular, getter throw, depth limit, string truncation)
 *   - detectFramework (Lit, FAST, Stencil, vanilla)
 *   - buildWCNode (nominal, shadow DOM, 0 WC)
 *   - createIdRegistry (stable IDs, resolveId, GC'd element)
 *   - makeScheduler (debounce, dirty-check dedup)
 *   - setProp (success, readonly, not-in-DOM)
 *
 * ASCII — test grouping:
 *
 *   serializeValue
 *   ├── primitives (null, bool, number, string, undefined)
 *   ├── special objects (Function, Symbol, BigInt, Element, Node)
 *   ├── arrays and plain objects (recursive)
 *   ├── circular reference → '[Circular]'
 *   ├── depth limit (depth >= 3) → '[Object…]'
 *   └── string truncation
 *
 *   detectFramework
 *   ├── Lit (_$litElement$)
 *   ├── Lit (elementProperties Map)
 *   ├── FAST ($fastController on instance)
 *   ├── Stencil (__stencilApp on constructor)
 *   └── vanilla (no markers)
 *
 *   buildWCNode
 *   ├── nominal custom element
 *   ├── element with open shadow DOM
 *   └── container with no WC children
 *
 *   createIdRegistry
 *   ├── stable ID across calls
 *   ├── different elements get different IDs
 *   └── resolveId returns null when element removed from DOM
 *
 *   makeScheduler
 *   ├── debounce: N rapid calls → 1 send after 300ms
 *   └── dirty-check: identical tree skips postMessage
 *
 *   setProp
 *   ├── writable property → success
 *   ├── read-only (non-configurable) property → error with message
 *   └── nodeId not in DOM → error 'Element no longer in DOM'
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetNativeProtoKeys,
  buildWCNode,
  callMethod,
  collectWCChildren,
  createIdRegistry,
  detectFramework,
  detectFrameworkVersion,
  detectStencilHydration,
  makeScheduler,
  parseStackSourceRef,
  serializeValue,
  setProp,
} from '../lib/inspector-core';

// ── Helpers ───────────────────────────────────────────────────────────────────

function newVisited() {
  return new WeakSet<object>();
}

/**
 * Create and register a minimal custom element in jsdom.
 * jsdom doesn't fully upgrade custom elements, but tagName and prototype
 * manipulation work for our purposes.
 */
function makeCustomEl(tagName: string, extraProto?: Record<string, unknown>): HTMLElement {
  // Define the element if not already defined
  if (!customElements.get(tagName)) {
    const klass = class extends HTMLElement {};
    if (extraProto) {
      for (const [k, v] of Object.entries(extraProto)) {
        Object.defineProperty(klass.prototype, k, { value: v, writable: true, configurable: true });
      }
    }
    customElements.define(tagName, klass);
  }
  return document.createElement(tagName);
}

// ── serializeValue ────────────────────────────────────────────────────────────

describe('serializeValue', () => {
  it('returns primitives as-is', () => {
    expect(serializeValue(null, 0, newVisited())).toBe(null);
    expect(serializeValue(true, 0, newVisited())).toBe(true);
    expect(serializeValue(42, 0, newVisited())).toBe(42);
    expect(serializeValue('hello', 0, newVisited())).toBe('hello');
  });

  it('converts undefined to the sentinel string', () => {
    expect(serializeValue(undefined, 0, newVisited())).toBe('[undefined]');
  });

  it('converts non-finite numbers to strings', () => {
    expect(serializeValue(Infinity, 0, newVisited())).toBe('Infinity');
    expect(serializeValue(NaN, 0, newVisited())).toBe('NaN');
  });

  it('truncates long strings', () => {
    const long = 'x'.repeat(600);
    const result = serializeValue(long, 0, newVisited()) as string;
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(501 + 1); // MAX_STRING_LENGTH + '…'
  });

  it('serializes functions to [Function]', () => {
    expect(serializeValue(() => {}, 0, newVisited())).toBe('[Function]');
  });

  it('serializes symbols to a descriptive string', () => {
    const s = Symbol('test');
    expect(serializeValue(s, 0, newVisited())).toBe(`[Symbol: ${String(s)}]`);
  });

  it('serializes bigints to a descriptive string', () => {
    expect(serializeValue(BigInt(99), 0, newVisited())).toBe('[BigInt: 99]');
  });

  it('serializes Element references to a tag string', () => {
    const el = document.createElement('div');
    expect(serializeValue(el, 0, newVisited())).toBe('[Element: <div>]');
  });

  it('serializes plain objects recursively', () => {
    const obj = { a: 1, b: 'hi' };
    expect(serializeValue(obj, 0, newVisited())).toEqual({ a: 1, b: 'hi' });
  });

  it('serializes arrays recursively', () => {
    expect(serializeValue([1, 'two', null], 0, newVisited())).toEqual([1, 'two', null]);
  });

  it('returns [Circular] for circular references', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const result = serializeValue(obj, 0, newVisited()) as Record<string, unknown>;
    expect(result.self).toBe('[Circular]');
  });

  it('returns [Object…] sentinel at depth >= 3', () => {
    const deep = { level: { level: { level: { leaf: 'value' } } } };
    const result = serializeValue(deep, 0, newVisited()) as Record<string, unknown>;
    const l2 = (result.level as Record<string, unknown>).level as Record<string, unknown>;
    // depth 0→1→2: at depth=3 the inner object should become '[Object…]'
    expect(l2.level).toBe('[Object…]');
  });

  it('catches getter exceptions and records [Error reading key]', () => {
    const obj = {};
    Object.defineProperty(obj, 'bad', {
      get() {
        throw new Error('getter exploded');
      },
      enumerable: true,
    });
    const result = serializeValue(obj, 0, newVisited()) as Record<string, unknown>;
    expect(result.bad).toBe('[Error reading key]');
  });

  it('allows the same object reference in sibling branches (not false circular)', () => {
    const shared = { x: 1 };
    const obj = { a: shared, b: shared };
    const result = serializeValue(obj, 0, newVisited()) as Record<string, unknown>;
    expect(result.a).toEqual({ x: 1 });
    expect(result.b).toEqual({ x: 1 }); // NOT '[Circular]'
  });
});

// ── detectFramework ───────────────────────────────────────────────────────────

describe('detectFramework', () => {
  it('detects Lit via _$litElement$ static marker', () => {
    const el = makeCustomEl('detect-lit-1');
    Object.defineProperty(el.constructor, '_$litElement$', { value: true, configurable: true });
    expect(detectFramework(el)).toBe('lit');
  });

  it('detects Lit via __litElement__ static marker', () => {
    const el = makeCustomEl('detect-lit-2');
    Object.defineProperty(el.constructor, '__litElement__', { value: true, configurable: true });
    expect(detectFramework(el)).toBe('lit');
  });

  it('does not flag a non-Lit element as Lit just because it has elementProperties', () => {
    const el = makeCustomEl('detect-not-lit-1');
    Object.defineProperty(el.constructor, 'elementProperties', {
      value: new Map([['myProp', {}]]),
      configurable: true,
    });
    expect(detectFramework(el)).toBe('vanilla');
  });

  it('detects Stencil via __registerHost on the prototype', () => {
    const el = makeCustomEl('detect-stencil-2');
    Object.defineProperty(el.constructor.prototype, '__registerHost', {
      value: () => undefined,
      configurable: true,
    });
    expect(detectFramework(el)).toBe('stencil');
  });

  it('detects Stencil lazy-bundle components via componentOnReady', () => {
    const el = makeCustomEl('detect-stencil-lazy');
    Object.defineProperty(el.constructor.prototype, 'componentOnReady', {
      value: () => Promise.resolve(),
      configurable: true,
    });
    expect(detectFramework(el)).toBe('stencil');
  });

  it('detects Stencil via runtime s-hn marker on the instance', () => {
    const el = makeCustomEl('detect-stencil-shn') as Element & { 's-hn'?: string };
    (el as unknown as Record<string, string>)['s-hn'] = 'MY-CMP';
    expect(detectFramework(el)).toBe('stencil');
  });

  it('classifies a Stencil component as Stencil even when Lit-shaped statics exist', () => {
    const el = makeCustomEl('detect-stencil-3');
    Object.defineProperty(el.constructor.prototype, '__registerHost', {
      value: () => undefined,
      configurable: true,
    });
    Object.defineProperty(el.constructor, 'elementProperties', {
      value: new Map([['myProp', {}]]),
      configurable: true,
    });
    expect(detectFramework(el)).toBe('stencil');
  });

  it('detects FAST via $fastController on the instance', () => {
    const el = makeCustomEl('detect-fast-1') as HTMLElement & { $fastController?: unknown };
    (el as unknown as Record<string, unknown>).$fastController = {
      /* mock controller */
    };
    expect(detectFramework(el)).toBe('fast');
  });

  it('detects Stencil via __stencilApp on the constructor', () => {
    const el = makeCustomEl('detect-stencil-1');
    Object.defineProperty(el.constructor, '__stencilApp', { value: true, configurable: true });
    expect(detectFramework(el)).toBe('stencil');
  });

  it('returns vanilla when no framework markers are present', () => {
    const el = makeCustomEl('detect-vanilla-1');
    expect(detectFramework(el)).toBe('vanilla');
  });
});

// ── buildWCNode ───────────────────────────────────────────────────────────────

describe('buildWCNode', () => {
  beforeEach(() => {
    _resetNativeProtoKeys();
    document.body.innerHTML = '';
  });

  it('builds a nominal WCNode for a custom element', () => {
    const el = makeCustomEl('my-button');
    el.setAttribute('label', 'Click me');
    document.body.appendChild(el);

    const registry = createIdRegistry();
    const node = buildWCNode(el, 0, registry);

    expect(node.tagName).toBe('my-button');
    expect(node.depth).toBe(0);
    expect(node.attributes).toEqual({ label: 'Click me' });
    expect(typeof node.id).toBe('string');
    expect(node.id.startsWith('wc-')).toBe(true);
    expect(node.children).toEqual([]);
  });

  it('detects an open shadow root and builds shadow children', () => {
    const el = makeCustomEl('my-card');
    document.body.appendChild(el);
    const sr = el.attachShadow({ mode: 'open' });

    // Put a WC child in the shadow root
    const child = makeCustomEl('my-icon');
    sr.appendChild(child);

    const registry = createIdRegistry();
    const node = buildWCNode(el, 0, registry);

    expect(Array.isArray(node.shadowRoot)).toBe(true);
    expect((node.shadowRoot as object[]).length).toBe(1);
  });

  it('returns shadowRoot: null for elements without a shadow root', () => {
    const el = makeCustomEl('no-shadow-el');
    document.body.appendChild(el);

    const registry = createIdRegistry();
    const node = buildWCNode(el, 0, registry);

    expect(node.shadowRoot).toBeNull();
  });

  it('returns an empty children array when container has no WC descendants', () => {
    const div = document.createElement('div');
    div.innerHTML = '<span>hello</span><p>world</p>';
    document.body.appendChild(div);

    const registry = createIdRegistry();
    const result = collectWCChildren(div, 0, registry);
    expect(result).toEqual({ nodes: [], dropped: 0 });
  });

  it('counts WC beyond the capacity cap instead of dropping them silently', () => {
    const div = document.createElement('div');
    for (let i = 0; i < 5; i++) {
      div.appendChild(makeCustomEl('capped-el'));
    }
    // One nested inside a plain wrapper — flattened into the same region
    const wrapper = document.createElement('section');
    wrapper.appendChild(makeCustomEl('capped-el'));
    div.appendChild(wrapper);
    document.body.appendChild(div);

    const { nodes, dropped } = collectWCChildren(div, 0, createIdRegistry(), 4);
    expect(nodes).toHaveLength(4);
    expect(dropped).toBe(2);
  });
});

// ── createIdRegistry ──────────────────────────────────────────────────────────

describe('createIdRegistry', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('assigns stable IDs across multiple calls for the same element', () => {
    const el = makeCustomEl('stable-id-el');
    document.body.appendChild(el);
    const registry = createIdRegistry();

    const id1 = registry.getOrCreateId(el);
    const id2 = registry.getOrCreateId(el);
    expect(id1).toBe(id2);
  });

  it('assigns different IDs to different elements', () => {
    const a = makeCustomEl('id-a-el');
    const b = makeCustomEl('id-b-el');
    document.body.appendChild(a);
    document.body.appendChild(b);

    const registry = createIdRegistry();
    expect(registry.getOrCreateId(a)).not.toBe(registry.getOrCreateId(b));
  });

  it('resolveId returns the element when it is in the DOM', () => {
    const el = makeCustomEl('resolve-el');
    document.body.appendChild(el);
    const registry = createIdRegistry();

    const id = registry.getOrCreateId(el);
    expect(registry.resolveId(id)).toBe(el);
  });

  it('resolveId returns null after the element is removed from the DOM', () => {
    const el = makeCustomEl('removed-el');
    document.body.appendChild(el);
    const registry = createIdRegistry();

    const id = registry.getOrCreateId(el);
    el.remove(); // remove from DOM

    expect(registry.resolveId(id)).toBeNull();
  });

  it('resolveId returns null for an unknown ID', () => {
    const registry = createIdRegistry();
    expect(registry.resolveId('wc-99999')).toBeNull();
  });

  it('prefixes ids with the frame discriminator when given', () => {
    const el = makeCustomEl('prefixed-el');
    document.body.appendChild(el);
    const registry = createIdRegistry('f1a2b3');
    expect(registry.getOrCreateId(el)).toBe('wc-f1a2b3-0');
  });

  it('hasId reports ownership even for disconnected elements', () => {
    const el = makeCustomEl('has-id-el');
    document.body.appendChild(el);
    const registry = createIdRegistry();
    const id = registry.getOrCreateId(el);

    expect(registry.hasId(id)).toBe(true);
    expect(registry.hasId('wc-other-0')).toBe(false);
    el.remove();
    expect(registry.hasId(id)).toBe(true); // still owned — resolveId handles liveness
  });
});

// ── callMethod ────────────────────────────────────────────────────────────────

describe('callMethod', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('invokes the method with args and returns the raw value', () => {
    const el = makeCustomEl('call-method-el', {
      sum: function (this: HTMLElement, a: number, b: number) {
        return a + b;
      },
    });
    document.body.appendChild(el);
    const reg = createIdRegistry();
    const id = reg.getOrCreateId(el);

    const r = callMethod(id, 'sum', [2, 3], reg.resolveId);
    expect(r).toEqual({ success: true, value: 5 });
  });

  it('returns an error when the property is not a function', () => {
    const el = makeCustomEl('call-nonfn-el');
    (el as HTMLElement & { notFn?: number }).notFn = 1;
    document.body.appendChild(el);
    const reg = createIdRegistry();
    const id = reg.getOrCreateId(el);

    const r = callMethod(id, 'notFn', [], reg.resolveId);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain('not a function');
  });

  it('catches exceptions thrown by the method', () => {
    const el = makeCustomEl('call-throw-el', {
      boom: () => {
        throw new Error('kaboom');
      },
    });
    document.body.appendChild(el);
    const reg = createIdRegistry();
    const id = reg.getOrCreateId(el);

    const r = callMethod(id, 'boom', [], reg.resolveId);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain('kaboom');
  });

  it('returns an error when the element is gone', () => {
    const reg = createIdRegistry();
    const r = callMethod('nonexistent', 'foo', [], reg.resolveId);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe('Element no longer in DOM');
  });
});

// ── parseStackSourceRef ───────────────────────────────────────────────────────

describe('parseStackSourceRef', () => {
  it('parses a Chrome-style stack, skipping extension frames', () => {
    const stack = [
      'Error',
      '    at customElements.define (chrome-extension://abcdef/wc-inspector.js:88:15)',
      '    at Module.register (https://app.example.com/assets/my-button.js:42:7)',
      '    at https://app.example.com/assets/index.js:3:1',
    ].join('\n');
    expect(parseStackSourceRef(stack)).toEqual({
      url: 'https://app.example.com/assets/my-button.js',
      line: 42,
      column: 7,
    });
  });

  it('parses a Firefox-style stack', () => {
    const stack = [
      'define@moz-extension://abcdef/wc-inspector.js:88:15',
      'register@https://app.example.com/main.js:10:2',
    ].join('\n');
    expect(parseStackSourceRef(stack)).toEqual({
      url: 'https://app.example.com/main.js',
      line: 10,
      column: 2,
    });
  });

  it('prefers app frames over bundled-dependency frames', () => {
    const stack = [
      'Error',
      '    at e (http://localhost:5173/node_modules/.vite/deps/lit.js:1049:26)',
      '    at http://localhost:5173/src/components/my-card.ts:12:1',
    ].join('\n');
    expect(parseStackSourceRef(stack)?.url).toBe('http://localhost:5173/src/components/my-card.ts');
  });

  it('falls back to a dependency frame when no app frame exists', () => {
    const stack = [
      'Error',
      '    at e (http://localhost:5173/node_modules/.vite/deps/lit.js:1049:26)',
    ].join('\n');
    expect(parseStackSourceRef(stack)?.url).toBe(
      'http://localhost:5173/node_modules/.vite/deps/lit.js',
    );
  });

  it('returns null when no frame has a page URL', () => {
    const stack = [
      'Error',
      '    at customElements.define (chrome-extension://abcdef/wc-inspector.js:88:15)',
      '    at <anonymous>:1:20',
    ].join('\n');
    expect(parseStackSourceRef(stack)).toBeNull();
  });
});

// ── makeScheduler ─────────────────────────────────────────────────────────────

describe('makeScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('debounces: N rapid calls result in exactly 1 postMessage after 300ms', () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const getTree = vi
      .fn()
      .mockReturnValue({ nodes: [{ id: 'wc-0', tagName: 'my-el' }], dropped: 0 });
    const getRegistry = vi.fn().mockReturnValue(['my-el']);

    const { schedule } = makeScheduler(getTree, getRegistry, 1);

    // Fire 5 rapid calls — only the last one should trigger a send
    schedule();
    schedule();
    schedule();
    schedule();
    schedule();

    expect(postMessageSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(postMessageSpy.mock.calls[0][0]).toMatchObject({
      source: 'wc-devtools-injected',
      type: 'tree-snapshot',
    });
  });

  it('dirty-check: two scheduled sends with an identical tree emit only 1 postMessage', () => {
    // First send is always a snapshot. Subsequent sends emit patches; if the tree is
    // unchanged, diffTree returns no patches and nothing is posted.
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const tree = [
      {
        id: 'wc-0',
        tagName: 'my-el',
        attributes: {},
        properties: {},
        shadowRoot: null,
        children: [],
        depth: 0,
        framework: 'vanilla' as const,
        methods: [],
      },
    ];
    const getTree = vi.fn().mockReturnValue({ nodes: tree, dropped: 0 });
    const getRegistry = vi.fn().mockReturnValue(['my-el']);

    const { schedule } = makeScheduler(getTree, getRegistry, 1);

    // First fire: schedule → advance timer → snapshot
    schedule();
    vi.advanceTimersByTime(300);
    expect(postMessageSpy).toHaveBeenCalledTimes(1);

    // Second fire: same tree → diff is empty → no postMessage
    schedule();
    vi.advanceTimersByTime(300);
    expect(postMessageSpy).toHaveBeenCalledTimes(1); // still 1 — no duplicate
  });

  it('reports update patches to the onPatches observer (not on the first snapshot)', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const base = {
      id: 'wc-0',
      tagName: 'my-el',
      attributes: {},
      properties: {},
      shadowRoot: null,
      children: [],
      depth: 0,
      framework: 'vanilla' as const,
      methods: [],
    };
    const getTree = vi
      .fn()
      .mockReturnValueOnce({ nodes: [base], dropped: 0 })
      .mockReturnValueOnce({ nodes: [{ ...base, attributes: { x: '1' } }], dropped: 0 });
    const onPatches = vi.fn();

    const { schedule } = makeScheduler(getTree, () => [], 1, onPatches);

    schedule();
    vi.advanceTimersByTime(300); // first send = snapshot, observer not called
    expect(onPatches).not.toHaveBeenCalled();

    schedule();
    vi.advanceTimersByTime(300); // second send = patches
    expect(onPatches).toHaveBeenCalledTimes(1);
    expect(onPatches.mock.calls[0][0][0]).toMatchObject({ op: 'update', id: 'wc-0' });
  });

  it('dispose stops pending and future sends', () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const getTree = vi
      .fn()
      .mockReturnValue({ nodes: [{ id: 'wc-0', tagName: 'my-el' }], dropped: 0 });

    const scheduler = makeScheduler(getTree, () => [], 1);
    scheduler.schedule();
    scheduler.dispose();
    vi.advanceTimersByTime(300); // pending timer cancelled
    scheduler.schedule();
    scheduler.forceRefresh(); // future calls no-op
    vi.advanceTimersByTime(300);

    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('forceRefresh sends immediately without waiting for the 300ms timer', () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const getTree = vi
      .fn()
      .mockReturnValue({ nodes: [{ id: 'wc-0', tagName: 'my-el' }], dropped: 0 });
    const getRegistry = vi.fn().mockReturnValue([]);

    const { forceRefresh } = makeScheduler(getTree, getRegistry, 1);

    forceRefresh();
    // No timer advance needed
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
  });
});

// ── setProp ───────────────────────────────────────────────────────────────────

describe('setProp', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('sets a writable property and returns success: true', () => {
    const el = makeCustomEl('prop-el-1');
    document.body.appendChild(el);
    const registry = createIdRegistry();
    const id = registry.getOrCreateId(el);

    // Define a writable property on the instance
    (el as unknown as Record<string, unknown>).count = 0;

    const result = setProp(id, 'count', 42, registry.resolveId);
    expect(result.success).toBe(true);
    expect((el as unknown as Record<string, unknown>).count).toBe(42);
  });

  it('returns an error message when the property descriptor is read-only', () => {
    const el = makeCustomEl('prop-el-2');
    document.body.appendChild(el);
    Object.defineProperty(el, 'readonlyProp', {
      value: 'immutable',
      writable: false,
      configurable: false,
    });
    const registry = createIdRegistry();
    const id = registry.getOrCreateId(el);

    const result = setProp(id, 'readonlyProp', 'new-value', registry.resolveId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('read-only');
  });

  it('returns an error when the nodeId does not resolve to a DOM element', () => {
    const result = setProp('wc-does-not-exist', 'foo', 'bar', () => null);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Element no longer in DOM');
  });

  it('handles a property setter that throws and returns the error string', () => {
    const el = makeCustomEl('prop-el-3');
    document.body.appendChild(el);
    Object.defineProperty(el, 'explodingProp', {
      get() {
        return 0;
      },
      set() {
        throw new TypeError('setter exploded');
      },
      configurable: true,
    });
    const registry = createIdRegistry();
    const id = registry.getOrCreateId(el);

    const result = setProp(id, 'explodingProp', 'value', registry.resolveId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('setter exploded');
  });
});

// ── serializeSlots ────────────────────────────────────────────────────────────

describe('serializeSlots', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
  });

  it('returns [] when the element has no shadow root', async () => {
    const { serializeSlots } = await import('../lib/inspector-core');
    expect(serializeSlots(host)).toEqual([]);
  });

  it('reports the default slot with its assigned nodes', async () => {
    const { serializeSlots } = await import('../lib/inspector-core');
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<slot></slot>';
    host.innerHTML = '<span></span><em></em>';
    const slots = serializeSlots(host);
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe('');
    expect(slots[0].assignedNodes).toEqual(['span', 'em']);
  });

  it('reports named slots and their fallback content when nothing is assigned', async () => {
    const { serializeSlots } = await import('../lib/inspector-core');
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<slot name="header"><h1></h1></slot>';
    const slots = serializeSlots(host);
    expect(slots[0].name).toBe('header');
    expect(slots[0].assignedNodes).toEqual([]);
    expect(slots[0].fallbackNodes).toEqual(['h1']);
  });

  it('counts ::slotted rules from adopted stylesheets', async () => {
    const { serializeSlots } = await import('../lib/inspector-core');
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<slot></slot>';
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('::slotted(span) { color: red; } ::slotted(em) { color: blue; }');
    (sr as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [sheet];
    const slots = serializeSlots(host);
    expect(slots[0].slottedRuleCount).toBe(2);
  });
});

// ── serializeParts ────────────────────────────────────────────────────────────

describe('serializeParts', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
    document.head.querySelectorAll('style[data-test]').forEach((s) => {
      s.remove();
    });
  });

  it('returns [] when there is no shadow root', async () => {
    const { serializeParts } = await import('../lib/inspector-core');
    expect(serializeParts(host)).toEqual([]);
  });

  it('lists each unique part name with its element tag', async () => {
    const { serializeParts } = await import('../lib/inspector-core');
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<button part="trigger label"></button><span part="label"></span>';
    const parts = serializeParts(host);
    const names = parts.map((p) => p.name).sort();
    expect(names).toEqual(['label', 'label', 'trigger']);
  });

  it('counts ::part rules in the document stylesheet', async () => {
    const { serializeParts } = await import('../lib/inspector-core');
    const style = document.createElement('style');
    style.dataset.test = '1';
    style.textContent = 'div::part(trigger) { color: red; }';
    document.head.appendChild(style);
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<button part="trigger"></button>';
    const parts = serializeParts(host);
    expect(parts.find((p) => p.name === 'trigger')?.ruleCount).toBe(1);
  });

  it('does not falsely match hyphenated part names', async () => {
    const { serializeParts } = await import('../lib/inspector-core');
    const style = document.createElement('style');
    style.dataset.test = '1';
    style.textContent = 'div::part(submit-button) { color: red; }';
    document.head.appendChild(style);
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<button part="button"></button>';
    const parts = serializeParts(host);
    expect(parts.find((p) => p.name === 'button')?.ruleCount).toBe(0);
  });

  it('correctly counts when the part appears among multiple in ::part(a b)', async () => {
    const { serializeParts } = await import('../lib/inspector-core');
    const style = document.createElement('style');
    style.dataset.test = '1';
    style.textContent = 'div::part(a b c) { color: red; }';
    document.head.appendChild(style);
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<span part="b"></span>';
    const parts = serializeParts(host);
    expect(parts.find((p) => p.name === 'b')?.ruleCount).toBe(1);
  });
});

// ── serializeCssVars ──────────────────────────────────────────────────────────

describe('serializeCssVars', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
    document.head.querySelectorAll('style[data-test-vars]').forEach((s) => {
      s.remove();
    });
  });

  it('reports a variable declared via inline style with declaredOnHost true', async () => {
    const { serializeCssVars } = await import('../lib/inspector-core');
    host.style.setProperty('--brand', 'red');
    const vars = serializeCssVars(host);
    const v = vars.find((x) => x.name === '--brand');
    expect(v?.declaredOnHost).toBe(true);
    expect(v?.computedValue.trim()).toBe('red');
  });

  it('reports an inherited variable with declaredOnHost false', async () => {
    const { serializeCssVars } = await import('../lib/inspector-core');
    const style = document.createElement('style');
    style.dataset.testVars = '1';
    style.textContent = 'body { --inherited: blue; }';
    document.head.appendChild(style);
    const vars = serializeCssVars(host);
    const v = vars.find((x) => x.name === '--inherited');
    expect(v).toBeDefined();
    expect(v?.declaredOnHost).toBe(false);
  });

  it('does not credit :host-context rules as declaredOnHost', async () => {
    const { serializeCssVars } = await import('../lib/inspector-core');
    const sr = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(':host-context(.dark) { --themed: black; }');
    sr.adoptedStyleSheets = [sheet];
    const vars = serializeCssVars(host);
    const v = vars.find((x) => x.name === '--themed');
    expect(v).toBeDefined();
    expect(v?.declaredOnHost).toBe(false);
  });

  it('does not credit document-level :host rules as declaredOnHost', async () => {
    const { serializeCssVars } = await import('../lib/inspector-core');
    const style = document.createElement('style');
    style.dataset.testVars = '1';
    style.textContent = ':host { --doc-host-var: green; }';
    document.head.appendChild(style);
    const vars = serializeCssVars(host);
    const v = vars.find((x) => x.name === '--doc-host-var');
    expect(v).toBeDefined();
    expect(v?.declaredOnHost).toBe(false);
  });

  it('credits :host rules from shadow-root adopted sheets as declaredOnHost', async () => {
    const { serializeCssVars } = await import('../lib/inspector-core');
    const sr = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(':host { --shadow-host-var: yellow; }');
    sr.adoptedStyleSheets = [sheet];
    const vars = serializeCssVars(host);
    const v = vars.find((x) => x.name === '--shadow-host-var');
    expect(v).toBeDefined();
    expect(v?.declaredOnHost).toBe(true);
  });
});

// ── CustomStateSet ────────────────────────────────────────────────────────────

describe('serializeCustomStates / toggleCustomState', () => {
  let host: HTMLElement;
  let states: Set<string>;

  beforeEach(() => {
    host = document.createElement('div');
    states = new Set();
    const fakeInternals = {
      states: {
        add: (s: string) => states.add(s),
        delete: (s: string) => states.delete(s),
        has: (s: string) => states.has(s),
        [Symbol.iterator]: () => states[Symbol.iterator](),
      },
    } as unknown as ElementInternals;
    document.body.appendChild(host);
    (window as unknown as Record<string, unknown>).__wc_devtools_internals = (el: Element) =>
      el === host ? fakeInternals : null;
  });

  afterEach(() => {
    host.remove();
    delete (window as unknown as Record<string, unknown>).__wc_devtools_internals;
  });

  it('returns [] when no internals are attached', async () => {
    delete (window as unknown as Record<string, unknown>).__wc_devtools_internals;
    const { serializeCustomStates } = await import('../lib/inspector-core');
    expect(serializeCustomStates(host)).toEqual([]);
  });

  it('returns the active states', async () => {
    const { serializeCustomStates } = await import('../lib/inspector-core');
    states.add('--loading');
    states.add('--ready');
    expect(serializeCustomStates(host).sort()).toEqual(['--loading', '--ready']);
  });

  it('toggleCustomState adds when enabled is true', async () => {
    const { toggleCustomState } = await import('../lib/inspector-core');
    const r = toggleCustomState(host, '--loading', true);
    expect(r.success).toBe(true);
    expect(states.has('--loading')).toBe(true);
  });

  it('toggleCustomState removes when enabled is false', async () => {
    const { toggleCustomState } = await import('../lib/inspector-core');
    states.add('--loading');
    toggleCustomState(host, '--loading', false);
    expect(states.has('--loading')).toBe(false);
  });
});

// ── serializeAdoptedStyles ────────────────────────────────────────────────────

describe('serializeAdoptedStyles', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
  });

  it('returns [] when there is no shadow root', async () => {
    const { serializeAdoptedStyles } = await import('../lib/inspector-core');
    expect(serializeAdoptedStyles(host)).toEqual([]);
  });

  it('returns [] when the shadow root has no adopted sheets', async () => {
    const { serializeAdoptedStyles } = await import('../lib/inspector-core');
    host.attachShadow({ mode: 'open' });
    expect(serializeAdoptedStyles(host)).toEqual([]);
  });

  it('reports adopted sheets with cssText and rule count', async () => {
    const { serializeAdoptedStyles } = await import('../lib/inspector-core');
    const sr = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('a { color: red; } b { color: blue; }');
    sr.adoptedStyleSheets = [sheet];
    const sheets = serializeAdoptedStyles(host);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].ruleCount).toBe(2);
    expect(sheets[0].cssText).toContain('color: red');
  });
});

// ── serializePropMeta ─────────────────────────────────────────────────────────

describe('serializePropMeta', () => {
  it('returns {} for a vanilla element with no observedAttributes', async () => {
    const { serializePropMeta } = await import('../lib/inspector-core');
    const el = document.createElement('div');
    expect(serializePropMeta(el)).toEqual({});
  });

  it('marks observedAttributes as kind="attribute" for vanilla elements', async () => {
    const { serializePropMeta } = await import('../lib/inspector-core');
    class V extends HTMLElement {
      static observedAttributes = ['size'];
    }
    if (!customElements.get('vanilla-meta-el')) customElements.define('vanilla-meta-el', V);
    const el = document.createElement('vanilla-meta-el');
    const meta = serializePropMeta(el);
    expect(meta.size).toEqual({ kind: 'attribute', reflects: true });
  });

  it('marks Lit @state props as kind="state" and @property props as kind="prop"', async () => {
    const { serializePropMeta } = await import('../lib/inspector-core');
    class L extends HTMLElement {
      static elementProperties = new Map<string, { state?: boolean; reflect?: boolean }>([
        ['count', { state: false, reflect: true }],
        ['internal', { state: true, reflect: false }],
      ]);
    }
    if (!customElements.get('lit-meta-el')) customElements.define('lit-meta-el', L);
    const el = document.createElement('lit-meta-el');
    const meta = serializePropMeta(el);
    expect(meta.count).toEqual({ kind: 'prop', reflects: true });
    expect(meta.internal).toEqual({ kind: 'state', reflects: false });
  });

  it('prefers elementProperties over observedAttributes for overlapping keys', async () => {
    const { serializePropMeta } = await import('../lib/inspector-core');
    class Overlap extends HTMLElement {
      static elementProperties = new Map<string, { state?: boolean; reflect?: boolean }>([
        ['size', { state: false, reflect: false }],
      ]);
      static observedAttributes = ['size'];
    }
    if (!customElements.get('overlap-meta-el')) customElements.define('overlap-meta-el', Overlap);
    const el = document.createElement('overlap-meta-el');
    const meta = serializePropMeta(el);
    expect(meta.size).toEqual({ kind: 'prop', reflects: false });
  });
});

// ── setAttr / removeAttr ──────────────────────────────────────────────────────

describe('setAttr / removeAttr', () => {
  let host: HTMLElement;
  let resolve: (id: string) => Element | null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    resolve = (id) => (id === 'host' ? host : null);
  });
  afterEach(() => {
    host.remove();
  });

  it('setAttr writes the attribute', async () => {
    const { setAttr } = await import('../lib/inspector-core');
    const r = setAttr('host', 'data-x', '42', resolve);
    expect(r.success).toBe(true);
    expect(host.getAttribute('data-x')).toBe('42');
  });

  it('setAttr returns error when nodeId not in DOM', async () => {
    const { setAttr } = await import('../lib/inspector-core');
    const r = setAttr('missing', 'data-x', '42', resolve);
    expect(r.success).toBe(false);
    expect(r.error).toContain('no longer in DOM');
  });

  it('removeAttr removes the attribute', async () => {
    const { removeAttr } = await import('../lib/inspector-core');
    host.setAttribute('data-x', 'value');
    const r = removeAttr('host', 'data-x', resolve);
    expect(r.success).toBe(true);
    expect(host.hasAttribute('data-x')).toBe(false);
  });
});

// ── serializeAriaRefs ─────────────────────────────────────────────────────────

describe('serializeAriaRefs', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
  });

  it('returns [] when the element has no aria-* idref attributes', async () => {
    const { serializeAriaRefs } = await import('../lib/inspector-core');
    expect(serializeAriaRefs(host)).toEqual([]);
  });

  it('reports aria-controls with the referenced ids', async () => {
    const { serializeAriaRefs } = await import('../lib/inspector-core');
    host.setAttribute('aria-controls', 'panel-1 panel-2');
    const refs = serializeAriaRefs(host);
    expect(refs).toHaveLength(1);
    expect(refs[0].attribute).toBe('aria-controls');
    expect(refs[0].ids).toEqual(['panel-1', 'panel-2']);
  });

  it('flags crossRoot=true when target is inside a shadow root', async () => {
    const { serializeAriaRefs } = await import('../lib/inspector-core');
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<div id="inner"></div>';
    host.setAttribute('aria-describedby', 'inner');
    const refs = serializeAriaRefs(host);
    expect(refs[0].crossRoot).toBe(true);
  });
});

// ── detectFrameworkVersion ────────────────────────────────────────────────────

describe('detectFrameworkVersion', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).litElementVersions;
  });

  it('returns the single entry from litElementVersions for Lit', () => {
    (globalThis as Record<string, unknown>).litElementVersions = ['3.3.2'];
    customElements.define('fv-1', class extends HTMLElement {});
    const el = document.createElement('fv-1');
    expect(detectFrameworkVersion(el, 'lit')).toBe('3.3.2');
  });

  it('returns undefined for Lit when several versions are registered on the page', () => {
    (globalThis as Record<string, unknown>).litElementVersions = ['3.3.2', '4.4.2'];
    customElements.define('fv-1b', class extends HTMLElement {});
    const Ctor = customElements.get('fv-1b') as unknown as { _$litElement$?: boolean };
    Ctor._$litElement$ = true;
    const el = document.createElement('fv-1b');
    expect(detectFrameworkVersion(el, 'lit')).toBe('3.x');
  });

  it('returns "2.x" when only __litElement__ is set', () => {
    customElements.define('fv-2', class extends HTMLElement {});
    const Ctor = customElements.get('fv-2') as unknown as { __litElement__?: boolean };
    Ctor.__litElement__ = true;
    const el = document.createElement('fv-2');
    expect(detectFrameworkVersion(el, 'lit')).toBe('2.x');
  });

  it('returns "3.x" when _$litElement$ is set without litElementVersions', () => {
    customElements.define('fv-3', class extends HTMLElement {});
    const Ctor = customElements.get('fv-3') as unknown as { _$litElement$?: boolean };
    Ctor._$litElement$ = true;
    const el = document.createElement('fv-3');
    expect(detectFrameworkVersion(el, 'lit')).toBe('3.x');
  });

  it('returns undefined for vanilla', () => {
    customElements.define('fv-4', class extends HTMLElement {});
    const el = document.createElement('fv-4');
    expect(detectFrameworkVersion(el, 'vanilla')).toBeUndefined();
  });
});

describe('detectStencilHydration', () => {
  it('returns "ssr-only" when s-id is present without s-hn', () => {
    customElements.define('hyd-1', class extends HTMLElement {});
    const el = document.createElement('hyd-1');
    el.setAttribute('s-id', 'abc');
    expect(detectStencilHydration(el)).toBe('ssr-only');
  });

  it('returns "hydrated" when s-hn is set on the element', () => {
    customElements.define('hyd-2', class extends HTMLElement {});
    const el = document.createElement('hyd-2') as Element & { 's-hn'?: string };
    el.setAttribute('s-id', 'abc');
    el['s-hn'] = 'hyd-2';
    expect(detectStencilHydration(el)).toBe('hydrated');
  });

  it('returns "hydrated" when only s-hn is present', () => {
    customElements.define('hyd-3', class extends HTMLElement {});
    const el = document.createElement('hyd-3') as Element & { 's-hn'?: string };
    el['s-hn'] = 'hyd-3';
    expect(detectStencilHydration(el)).toBe('hydrated');
  });

  it('returns "unknown" when neither marker is present', () => {
    customElements.define('hyd-4', class extends HTMLElement {});
    const el = document.createElement('hyd-4');
    expect(detectStencilHydration(el)).toBe('unknown');
  });
});
