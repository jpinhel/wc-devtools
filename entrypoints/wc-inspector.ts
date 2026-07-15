/**
 * wc-inspector.ts — injected into the page via chrome.scripting.executeScript
 * with world: 'MAIN', giving direct access to JS properties of custom elements.
 *
 * This file runs in the PAGE context, not the extension context.
 * It CANNOT use any chrome extension APIs.
 * All communication back to the content script is via window.postMessage.
 *
 * ASCII — data flow inside this module:
 *
 *   DOM mutations
 *        │
 *        ▼ (MutationObserver, debounced 300ms)
 *   buildWCTree()
 *        │
 *        ▼ dirty check (hash)
 *   window.postMessage({ type: 'tree-snapshot' | 'tree-patches', ... })
 *        │
 *        ▼
 *   content.ts  ──▶  background.ts  ──▶  devtools panel
 *
 *   Commands from devtools panel travel the reverse path:
 *   devtools panel  ──▶  background.ts  ──▶  content.ts
 *        │
 *        ▼ window.postMessage({ type: 'highlight-node' | 'set-prop' | 'refresh' })
 *   wc-inspector.ts  (this file)
 *
 * Pure/testable logic lives in lib/inspector-core.ts.
 * This file wires up the global instances and registers DOM listeners.
 */

import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import {
  callMethod,
  collectWCChildren,
  createIdRegistry,
  isCustomElement,
  makeScheduler,
  parseStackSourceRef,
  removeAttr,
  serializeValue,
  setAttr,
  setProp,
  toggleCustomState,
} from '../lib/inspector-core';
import type { MESSAGE_VERSION, SerializableValue, SourceRef } from '../types/wc';

// ── Constants ────────────────────────────────────────────────────────────────

/** Guards against double-injection when the tab navigates within an SPA. */
const INIT_FLAG = '__WC_DEVTOOLS_INITIALIZED__';
const MSG_VERSION: typeof MESSAGE_VERSION = 2;

// ── Module-level globals ──────────────────────────────────────────────────────

// Commands from the panel are broadcast to every frame in the tab, so node ids
// must not collide across frames: iframes get a random prefix, top frame none.
const framePrefix = window === window.top ? '' : Math.random().toString(36).slice(2, 8);
const idRegistry = createIdRegistry(framePrefix);

/** Registration site per tag name, captured from the stack at customElements.define. */
const sourceRefs = new Map<string, SourceRef>();

// ── Instance lifecycle ────────────────────────────────────────────────────────
//
// The panel re-injects this script on every (re)connect. Prototype patches
// cannot be unpatched, so each wrapper checks `instanceAlive` and degrades to
// a passthrough once a newer instance has taken over. Everything else
// (observers, listeners, timers) is registered in `disposers` and torn down.

let instanceAlive = true;
const disposers: Array<() => void> = [];

// ── Tree builder ──────────────────────────────────────────────────────────────

function buildWCTree() {
  return collectWCChildren(document.documentElement, 0, idRegistry);
}

// ── Registry ──────────────────────────────────────────────────────────────────

function getRegistry(): string[] {
  const names = new Set<string>();
  // Pierce open shadow roots — components defined before injection only show
  // up here, and most of them live inside another component's shadow tree.
  function walk(root: ParentNode): void {
    root.querySelectorAll('*').forEach((el) => {
      if (isCustomElement(el)) names.add(el.tagName.toLowerCase());
      if (el.shadowRoot) walk(el.shadowRoot);
    });
  }
  walk(document);
  const extra = (window as unknown as Record<string, unknown>).__WC_DEVTOOLS_REGISTRY__;
  if (Array.isArray(extra)) {
    for (const name of extra as string[]) names.add(name);
  }
  return [...names].sort();
}

function patchCustomElementsDefine(scheduleSend: () => void): void {
  (window as unknown as Record<string, unknown>).__WC_DEVTOOLS_REGISTRY__ = [];
  const original = customElements.define.bind(customElements);
  customElements.define = (
    name: string,
    ctor: CustomElementConstructor,
    options?: ElementDefinitionOptions,
  ) => {
    original(name, ctor, options);
    if (!instanceAlive) return;
    ((window as unknown as Record<string, unknown>).__WC_DEVTOOLS_REGISTRY__ as string[]).push(
      name,
    );
    try {
      // Click-to-source: the caller's frame is where the component class lives.
      const ref = parseStackSourceRef(new Error().stack ?? '');
      if (ref) sourceRefs.set(name, ref);
    } catch {
      /* never disrupt the page */
    }
    scheduleSend();
  };
}

// ── Highlight overlay ─────────────────────────────────────────────────────────

const OVERLAY_ID = '__wc-devtools-overlay__';

function showHighlight(nodeId: string | null): void {
  removeHighlight();
  if (!nodeId) return;

  const element = idRegistry.resolveId(nodeId);
  if (!element) return;

  const rect = element.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;

  overlay.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:2147483647',
    'border:2px solid #7aa2f7',
    'background:rgba(122,162,247,0.10)',
    'box-sizing:border-box',
    'border-radius:3px',
    `top:${rect.top}px`,
    `left:${rect.left}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
  ].join(';');

  const tooltip = document.createElement('div');
  tooltip.style.cssText = [
    'position:absolute',
    'top:-22px',
    'left:0',
    'background:#1f2335',
    'color:#7aa2f7',
    'font:11px/20px monospace',
    'padding:0 6px',
    'border-radius:3px',
    'white-space:nowrap',
    'pointer-events:none',
  ].join(';');
  tooltip.textContent = `<${element.tagName.toLowerCase()}>`;
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);
}

function removeHighlight(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

// ── Trace updates (flash re-rendered components) ──────────────────────────────

let traceUpdates = false;
const MAX_FLASHES_PER_BATCH = 30;

function flashUpdatedNodes(ids: string[]): void {
  for (const id of ids.slice(0, MAX_FLASHES_PER_BATCH)) {
    const el = idRegistry.resolveId(id);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const flash = document.createElement('div');
    flash.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:2147483646',
      'border:1.5px solid #f7768e',
      'background:rgba(247,118,142,0.08)',
      'box-sizing:border-box',
      'border-radius:3px',
      'transition:opacity 0.4s ease-out',
      `top:${rect.top}px`,
      `left:${rect.left}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
    ].join(';');
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = '0';
    });
    setTimeout(() => flash.remove(), 450);
  }
}

// ── CustomEvent capture ───────────────────────────────────────────────────────

// Phase 3 — Lit `@lit/context` ContextRequestEvent captures keyed by source element.
const contextRequestsByElement = new WeakMap<Element, { key: string }[]>();

function patchDispatchEvent(): void {
  const orig = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (this: EventTarget, event: Event): boolean {
    const result = orig.call(this, event);
    if (instanceAlive && this instanceof Element && isCustomElement(this)) {
      // @lit/context — capture context-request events.
      if (event.type === 'context-request') {
        try {
          const ev = event as Event & { context?: unknown };
          const key = ev.context !== undefined ? String(ev.context) : '[unknown]';
          const list = contextRequestsByElement.get(this) ?? [];
          if (!list.find((c) => c.key === key)) {
            list.push({ key });
            contextRequestsByElement.set(this, list);
          }
        } catch {
          /* never disrupt the page */
        }
      } else if (event instanceof CustomEvent) {
        try {
          window.postMessage(
            {
              source: 'wc-devtools-injected',
              version: MSG_VERSION,
              type: 'event-log',
              nodeId: idRegistry.getOrCreateId(this),
              eventType: event.type,
              detail: serializeValue(event.detail, 0, new WeakSet()),
              bubbles: event.bubbles,
              timestamp: Date.now(),
            },
            '*',
          );
        } catch {
          /* never disrupt the page */
        }
      }
    }
    return result;
  };
}

// ── Component picker ──────────────────────────────────────────────────────────

let pickCleanup: (() => void) | null = null;

function findNearestWC(e: MouseEvent): Element | null {
  for (const target of e.composedPath()) {
    if (target instanceof Element && isCustomElement(target)) return target;
  }
  return null;
}

function enterPickMode(): void {
  if (pickCleanup) return;
  document.documentElement.style.setProperty('cursor', 'crosshair', 'important');

  const onMouseover = (e: MouseEvent) => {
    const wc = findNearestWC(e);
    showHighlight(wc ? idRegistry.getOrCreateId(wc) : null);
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const wc = findNearestWC(e);
    exitPickMode();
    if (!wc) return;
    const nodeId = idRegistry.getOrCreateId(wc);
    window.postMessage(
      { source: 'wc-devtools-injected', version: MSG_VERSION, type: 'pick-result', nodeId },
      '*',
    );
  };

  document.addEventListener('mouseover', onMouseover, { capture: true });
  document.addEventListener('click', onClick, { capture: true });

  pickCleanup = () => {
    document.removeEventListener('mouseover', onMouseover, { capture: true });
    document.removeEventListener('click', onClick, { capture: true });
    document.documentElement.style.removeProperty('cursor');
    removeHighlight();
  };
}

function exitPickMode(): void {
  if (!pickCleanup) return;
  pickCleanup();
  pickCleanup = null;
}

// ── Command listener ──────────────────────────────────────────────────────────

function listenForCommands(forceRefresh: () => void): void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as Record<string, unknown> | null;
    if (data?.source !== 'wc-devtools-command') return;

    const type = data.type;

    // Node-targeted commands are broadcast to all frames — only the frame that
    // owns the id may act (and reply), otherwise every other frame would post
    // a bogus "Element no longer in DOM" result.
    if (
      (type === 'set-prop' ||
        type === 'scroll-into-view' ||
        type === 'toggle-state' ||
        type === 'set-attr' ||
        type === 'remove-attr' ||
        type === 'invoke-method' ||
        type === 'dispatch-event' ||
        type === 'set-css-var') &&
      !idRegistry.hasId(data.nodeId as string)
    ) {
      return;
    }

    if (type === 'highlight-node') {
      showHighlight((data.nodeId as string) ?? null);
    } else if (type === 'set-prop') {
      const result = setProp(
        data.nodeId as string,
        data.propName as string,
        data.value as SerializableValue,
        idRegistry.resolveId,
      );
      window.postMessage(
        {
          source: 'wc-devtools-injected',
          version: MSG_VERSION,
          type: 'set-prop-result',
          nodeId: data.nodeId,
          propName: data.propName,
          ...result,
        },
        '*',
      );
      // Prop changes don't necessarily produce childList mutations, so the
      // observers alone won't refresh the panel — resend like set-attr does.
      forceRefresh();
    } else if (type === 'refresh') {
      forceRefresh();
    } else if (type === 'scroll-into-view') {
      const el = idRegistry.resolveId(data.nodeId as string);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (type === 'enter-pick-mode') {
      enterPickMode();
    } else if (type === 'exit-pick-mode') {
      exitPickMode();
    } else if (type === 'toggle-state') {
      const el = idRegistry.resolveId(data.nodeId as string);
      const result = el
        ? toggleCustomState(el, data.state as string, data.enabled as boolean)
        : { success: false, error: 'Element no longer in DOM' };
      window.postMessage(
        {
          source: 'wc-devtools-injected',
          version: MSG_VERSION,
          type: 'set-state-result',
          nodeId: data.nodeId,
          state: data.state,
          enabled: data.enabled,
          ...result,
        },
        '*',
      );
      forceRefresh(); // re-snapshot since the state set changed
    } else if (type === 'set-attr') {
      const result = setAttr(
        data.nodeId as string,
        data.attrName as string,
        data.value as string,
        idRegistry.resolveId,
      );
      window.postMessage(
        {
          source: 'wc-devtools-injected',
          version: MSG_VERSION,
          type: 'set-attr-result',
          nodeId: data.nodeId,
          attrName: data.attrName,
          ...result,
        },
        '*',
      );
      forceRefresh();
    } else if (type === 'set-css-var') {
      const el = idRegistry.resolveId(data.nodeId as string);
      if (el instanceof HTMLElement) {
        try {
          const name = data.name as string;
          const value = data.value as string | null;
          if (value === null || value.trim() === '') el.style.removeProperty(name);
          else el.style.setProperty(name, value);
        } catch {
          /* invalid value — never disrupt the page */
        }
        forceRefresh();
      }
    } else if (type === 'trace-updates') {
      traceUpdates = data.enabled === true;
    } else if (type === 'invoke-method') {
      const methodName = data.methodName as string;
      const nodeId = data.nodeId as string;
      const postResult = (payload: {
        success: boolean;
        result?: SerializableValue;
        error?: string;
      }) => {
        window.postMessage(
          {
            source: 'wc-devtools-injected',
            version: MSG_VERSION,
            type: 'invoke-method-result',
            nodeId,
            methodName,
            ...payload,
          },
          '*',
        );
        forceRefresh(); // the call may have mutated component state
      };
      const outcome = callMethod(
        nodeId,
        methodName,
        (data.args as SerializableValue[]) ?? [],
        idRegistry.resolveId,
      );
      if (!outcome.success) {
        postResult({ success: false, error: outcome.error });
      } else if (outcome.value instanceof Promise) {
        outcome.value
          .then((v) => postResult({ success: true, result: serializeValue(v, 0, new WeakSet()) }))
          .catch((e) => postResult({ success: false, error: String(e) }));
      } else {
        postResult({ success: true, result: serializeValue(outcome.value, 0, new WeakSet()) });
      }
    } else if (type === 'dispatch-event') {
      const el = idRegistry.resolveId(data.nodeId as string);
      if (el) {
        try {
          // The patched EventTarget.dispatchEvent captures it — the panel's
          // event log entry doubles as the acknowledgement.
          el.dispatchEvent(
            new CustomEvent(data.eventType as string, {
              detail: data.detail,
              bubbles: true,
              composed: true,
            }),
          );
        } catch {
          /* invalid event type — never disrupt the page */
        }
      }
    } else if (type === 'remove-attr') {
      const result = removeAttr(
        data.nodeId as string,
        data.attrName as string,
        idRegistry.resolveId,
      );
      window.postMessage(
        {
          source: 'wc-devtools-injected',
          version: MSG_VERSION,
          type: 'set-attr-result',
          nodeId: data.nodeId,
          attrName: data.attrName,
          ...result,
        },
        '*',
      );
      forceRefresh();
    }
  };
  window.addEventListener('message', onMessage);
  disposers.push(() => window.removeEventListener('message', onMessage));
}

// ── ElementInternals tracking ─────────────────────────────────────────────────
//
// CustomStateSet (element.internals_.states) lives behind ElementInternals,
// which is only accessible via element.attachInternals() — and that method
// can only be called once. We patch it so we capture every ElementInternals
// at creation, store it in a WeakMap, and expose a lookup function on window.

const internalsByHost = new WeakMap<Element, ElementInternals>();

function patchAttachInternals(): void {
  const orig = HTMLElement.prototype.attachInternals;
  if (!orig) return;
  HTMLElement.prototype.attachInternals = function (this: HTMLElement): ElementInternals {
    const i = orig.call(this);
    if (instanceAlive) internalsByHost.set(this, i);
    return i;
  };
}

// ── Shadow DOM observation ─────────────────────────────────────────────────────
//
// MutationObserver with subtree:true only covers the light DOM.
// Shadow DOM mutations (e.g. Lit rendering its template into shadowRoot) are invisible
// unless we attach a separate observer to each shadow root.
//
// Strategy:
//   1. Walk the existing DOM and observe every open shadow root already present.
//   2. Patch Element.prototype.attachShadow so future shadow roots are observed
//      as soon as they are created.
//
// ASCII — observation coverage after setup:
//
//   document (light DOM observer, subtree) ──▶ catches non-shadow mutations
//   └─ my-app #shadow-root (shadow observer) ──▶ catches Lit template renders
//       └─ my-nav #shadow-root (shadow observer) ──▶ recursive
//
function setupShadowObservation(scheduleSend: () => void): void {
  const observed = new Set<ShadowRoot>();
  const observers: MutationObserver[] = [];
  disposers.push(() => {
    for (const o of observers) o.disconnect();
  });

  function observe(sr: ShadowRoot): void {
    if (observed.has(sr)) return;
    observed.add(sr);
    const observer = new MutationObserver(scheduleSend);
    observer.observe(sr, { childList: true, subtree: true });
    observers.push(observer);
  }

  // Recursively walk into nested shadow roots — querySelectorAll does not pierce them
  function walkExisting(root: Element | ShadowRoot | Document): void {
    Array.from(root.querySelectorAll('*')).forEach((el) => {
      if (el.shadowRoot) {
        observe(el.shadowRoot);
        walkExisting(el.shadowRoot);
      }
    });
  }

  // Patch attachShadow to catch shadow roots created after injection
  const origAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
    const sr = origAttachShadow.call(this, init);
    if (!instanceAlive) return sr;
    if (init.mode === 'open') {
      observe(sr);
    } else {
      // closed shadow root — we can't observe it, but we mark the host element
      // so buildWCNode can set shadowRoot = 'closed' instead of null
      idRegistry.markClosedShadow(this);
    }
    scheduleSend(); // new shadow root = potential new WC children
    return sr;
  };

  // Observe all shadow roots that already exist at injection time
  walkExisting(document);
}

// ── Custom Elements Manifest ─────────────────────────────────────────────────
//
// Best-effort fetch of `custom-elements.json` from the page origin. Tries a
// handful of well-known paths; silent on every failure (most origins won't
// ship a manifest at all). Forwarded to the panel via the same postMessage
// bus content.ts already listens on.

async function tryFetchCem(): Promise<unknown | null> {
  const candidates = [
    new URL('/custom-elements.json', location.origin).href,
    new URL('/dist/custom-elements.json', location.origin).href,
    new URL('/.well-known/custom-elements.json', location.origin).href,
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (r.ok) return await r.json();
    } catch {
      // origin doesn't ship one, or network failed
    }
  }
  return null;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default defineUnlistedScript(() => {
  const w = window as unknown as Record<string, unknown>;

  // The panel re-injects this script on every (re)connect. Tear down the
  // previous instance first: its observers/listeners hold a COMPETING id
  // registry — left alive, the two instances interleave snapshots with
  // different id spaces (selection lost after every refresh, commands
  // silently dropped by the hasId guard, flaky hover).
  try {
    (w.__WC_DEVTOOLS_TEARDOWN__ as (() => void) | undefined)?.();
  } catch {
    /* previous instance already broken — take over anyway */
  }
  w[INIT_FLAG] = true;

  const scheduler = makeScheduler(buildWCTree, getRegistry, MSG_VERSION, (patches) => {
    if (!traceUpdates) return;
    flashUpdatedNodes(patches.filter((p) => p.op === 'update').map((p) => p.id));
  });
  const { schedule, forceRefresh } = scheduler;

  patchCustomElementsDefine(schedule);
  patchAttachInternals();
  patchDispatchEvent();
  setupShadowObservation(schedule);
  listenForCommands(forceRefresh);

  // Light DOM observer — covers document body and slot content
  const lightObserver = new MutationObserver(() => schedule());
  lightObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  disposers.push(() => lightObserver.disconnect());

  // SPA navigation — client-side route changes don't reload the page, so
  // nothing else guarantees a rebuild right after the route swap.
  const origPushState = history.pushState.bind(history);
  history.pushState = (...args: Parameters<History['pushState']>) => {
    origPushState(...args);
    if (instanceAlive) schedule();
  };
  const origReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args: Parameters<History['replaceState']>) => {
    origReplaceState(...args);
    if (instanceAlive) schedule();
  };
  const onPopstate = () => schedule();
  window.addEventListener('popstate', onPopstate);
  disposers.push(() => window.removeEventListener('popstate', onPopstate));

  disposers.push(() => {
    exitPickMode();
    removeHighlight();
    scheduler.dispose();
  });

  w.__WC_DEVTOOLS_TEARDOWN__ = () => {
    instanceAlive = false;
    for (const d of disposers) {
      try {
        d();
      } catch {
        /* teardown must never throw into the page */
      }
    }
  };

  forceRefresh();

  // Expose element resolver for chrome.devtools.inspectedWindow.eval('inspect(window.__wc_devtools_inspect("nodeId"))')
  (w as Record<string, unknown>).__wc_devtools_inspect = (nodeId: string) =>
    idRegistry.resolveId(nodeId);

  // Debug helper — run `__wc_devtools_debug()` in the page console to inspect
  // what the extension is seeing. Surfaces the live custom-element tags in
  // DOM, the registry it has captured, and the current tree snapshot.
  (w as Record<string, unknown>).__wc_devtools_debug = () => {
    const liveTags = [...document.querySelectorAll('*')]
      .filter((el) => el.tagName.includes('-'))
      .map((el) => el.tagName.toLowerCase());
    const tags = new Map<string, number>();
    for (const t of liveTags) tags.set(t, (tags.get(t) ?? 0) + 1);
    return {
      liveTags: Object.fromEntries(tags),
      liveTagCount: liveTags.length,
      registry: getRegistry(),
      ...buildWCTree(),
      initFlag: w[INIT_FLAG],
    };
  };

  // Expose the define-site lookup so buildWCNode can stamp sourceRef per node
  (w as Record<string, unknown>).__wc_devtools_source = (tag: string): SourceRef | null =>
    sourceRefs.get(tag) ?? null;

  // Expose ElementInternals lookup so inspector-core can read CustomStateSet
  (window as unknown as Record<string, unknown>).__wc_devtools_internals = (
    el: Element,
  ): ElementInternals | null => internalsByHost.get(el) ?? null;

  // Expose Lit @lit/context request lookup so inspector-core can serialize per-node
  (window as unknown as Record<string, unknown>).__wc_devtools_context_requests = (
    el: Element,
  ): { key: string }[] | undefined => contextRequestsByElement.get(el);

  // Best-effort CEM fetch — silent on origins that don't ship a manifest
  void (async () => {
    const cem = await tryFetchCem();
    if (cem) {
      window.postMessage(
        {
          source: 'wc-devtools-injected',
          version: MSG_VERSION,
          type: 'cem-loaded',
          cem,
        },
        '*',
      );
    }
  })();
});
