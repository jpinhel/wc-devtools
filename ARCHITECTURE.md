# Architecture & Implementation — WC DevTools

Deep-dive companion doc: how the pieces fit and why the non-obvious choices were made.

---

## Overview

A Chrome MV3 extension is split into **isolated execution contexts** that share no memory. Everything goes through messages. That single constraint explains the whole architecture.

```
PAGE (world: MAIN)          CONTENT SCRIPT           BACKGROUND SW        DEVTOOLS PANEL
┌─────────────────┐         ┌─────────────┐          ┌────────────┐       ┌──────────────────┐
│  wc-inspector   │──post───▶  content.ts ├─sendMsg──▶ background │─port──▶ wc-devtools-app  │
│  (injected)     │◀──post──┤             │◀─sendMsg──┤           │◀─port─┤ (Lit)            │
└─────────────────┘         └─────────────┘          └────────────┘       └──────────────────┘
```

The four contexts have different capabilities:

| Context | DOM access | Chrome APIs | Shared memory |
|----------|-----------|-------------|-----------------|
| Page (MAIN) | ✅ full (shadow DOM, JS props) | ❌ | ❌ |
| Content script | ✅ DOM only (no JS props) | ✅ partial | ❌ |
| Background SW | ❌ | ✅ full | ❌ |
| DevTools panel | ❌ | ✅ devtools | ❌ |

**Why inject wc-inspector into MAIN?**
The content script runs in an "isolated world" — it sees the DOM but not the JS properties of elements. `myButton.value` from a content script returns `undefined`. Reading real Lit/FAST/Stencil props requires living in the same JS context as the page. Hence the `world: 'MAIN'` injection.

---

## The files, one by one

### `entrypoints/wc-inspector.ts` — The inspection core

Injected into the page; runs in the same JS context as the page itself. It CANNOT use chrome APIs.

What it does:

1. **Instance teardown protocol** — the panel re-injects this script on every (re)connect. Each injection first calls the previous instance's `__WC_DEVTOOLS_TEARDOWN__` (disconnect observers, remove listeners, dispose the scheduler); prototype patches can't be unpatched, so they degrade to passthroughs via an `instanceAlive` flag. Without this, zombie instances with competing id registries corrupt the tree stream.

2. **Frame-unique ids** — commands are broadcast to every frame in the tab, so iframe registries prefix their ids with a random token; every node-targeted command is ignored by frames that don't own the id (`hasId`).

3. **`patchCustomElementsDefine`** — monkey-patches `customElements.define` to capture component names as they register (feeds the Registry tab) and the registration site from the stack trace (feeds click-to-source).

4. **`patchDispatchEvent`** — monkey-patches `EventTarget.prototype.dispatchEvent` to capture `CustomEvent`s emitted by custom elements, plus `@lit/context` `context-request` events.

5. **`setupShadowObservation`** — the least obvious fix in the project:
   - A `MutationObserver` with `subtree: true` does NOT traverse shadow roots. When Lit renders into its `#shadow-root`, the mutations are invisible.
   - Solution: monkey-patch `Element.prototype.attachShadow` to observe every shadow root at creation + mark `closed` shadow roots, and walk pre-existing shadow roots at injection time.

6. **`listenForCommands`** — receives panel commands via `window.postMessage` (highlight, set-prop, set-attr, set-css-var, toggle-state, invoke-method, dispatch-event, trace-updates, pick mode, refresh).

7. **Overlays** — a fixed-position highlight overlay for hover/pick, and short-lived flash overlays for trace updates.

8. **SPA navigation** — `history.pushState`/`replaceState` are patched and `popstate` is observed so client-side route changes reschedule a tree build.

**The scheduler (in `inspector-core.ts`):**
DOM mutations arrive in bursts. The scheduler debounces 300ms, then diffs against the last sent tree: first send (and `forceRefresh`) is a full `tree-snapshot`, subsequent sends are `tree-patches`, with an automatic snapshot fallback past 200 patches (e.g. SPA route swaps).

---

### `lib/inspector-core.ts` — Pure, testable logic

Everything testable without a browser lives here. No WXT imports, no `window.postMessage`.

**`serializeValue(value, depth, visited)`**
Converts any JS value into a `SerializableValue` (safe for `postMessage`/JSON):
- recursion capped at depth 3
- circular references detected via a `WeakSet` (removed after visiting so shared siblings aren't flagged)
- `Element` → descriptive string (no DOM refs), `Function` → `'[Function]'`

**`serializeProperties(element)`**
For Lit elements, uses `constructor.elementProperties` (Lit's internal Map) rather than walking the whole prototype chain — avoids picking up `render`, `update`, `connectedCallback`, etc. For other WCs, walks the prototype chain filtering native keys (`getNativeProtoKeys()`).

**`createIdRegistry(prefix)`**
Maps stable ids (`wc-0`, `wc-1`… — `wc-<prefix>-N` in iframes) to DOM elements via a `WeakMap` + `Map` pair. `WeakRef` was tried and removed: DevTools keeps the page alive, the GC never collects, and `.deref()` added complexity for nothing.

**`resolveId`: `el.isConnected`, not `document.contains(el)`**
`document.contains()` returns `false` for elements inside a shadow root. `el.isConnected` is `true` even for `host.shadowRoot` children. Critical for highlight to work on shadow children.

**`hasClosedShadow`**
A `closed` shadow root makes `element.shadowRoot === null`, indistinguishable from "no shadow root". The only detection window is the `attachShadow({ mode: 'closed' })` call itself — the host is marked in the registry at that moment.

**`collectWCChildren(container, depth, registry, capacity)`**
Collects the WC nodes of one flattened region: custom elements become nodes, non-custom containers are traversed and their WC descendants land in the same list. Capacity-aware recursion — anything beyond the cap is *counted*, never silently dropped, and surfaces as "+N hidden" in the UI.

**`parseStackSourceRef(stack)`**
Click-to-source: extracts the page frame from the stack captured at `customElements.define`. Extension frames never match (protocol whitelist); bundled-dependency frames (`node_modules/`, `.vite/deps/`) are deprioritized so the component file wins over Lit's decorator helper.

---

### `entrypoints/content.ts` — The bridge

Runs in the isolated world. Its only job: relay messages both ways, as pure whitelisted relays (payload shapes are enforced by the typed emit sites and re-validated by version+type at each receiver).

It sends `content-ready` at startup; if a panel is already open for the tab, the background re-injects the inspector into that frame (handles navigation). Runs in all frames (`allFrames: true`) so iframes — Storybook — are covered.

---

### `entrypoints/background.ts` — The router

MV3 service worker. Two responsibilities:

**1. DevTools connections (ports)**
The panel opens a `chrome.runtime.Port` named `'devtools'`. The first message must be `devtools-init` with the `tabId` — this associates the port with the inspected tab and triggers injection into all frames.

**2. Message routing**
- Content → Background → Panel: tree messages get stamped with `sender.frameId`/`sender.url` so the panel can keep per-frame trees and target `inspectedWindow.eval` at the right frame.
- Panel → Background → Content: whitelisted commands go through `chrome.tabs.sendMessage` (all frames).

The background also keeps a per-tab, per-frame tree cache to serve the badge count and the popup without an open panel.

---

### `entrypoints/panel/` — The UI (Lit)

The panel dogfoods Web Components: every piece is a Lit custom element rendering into light DOM (`createRenderRoot() → this`) so one global stylesheet (`style.css` + `vars.css`) covers everything.

**`<wc-devtools-app>` — root**
- Owns the Port connection (auto-reconnect: MV3 kills the SW after ~30s idle; a 20s keepalive holds it while the panel is open, `onDisconnect` → reconnect → re-init)
- Holds all state: per-frame trees (merged for display), registry, selection, event log, profiling, CEM index
- Child → app communication is bubbling+composed CustomEvents — the app listens once at the top; nothing re-forwards events (that caused every handler to fire twice once)

**`<wc-tree-virtual>` + `lib/tree-flatten.ts`**
`flattenTree` turns the recursive tree into flat rows (depth, shadow-root headers, "+N hidden" rows); `@lit-labs/virtualizer` keeps ~30 rows in the DOM regardless of tree size.

**`<wc-inspector>` — right pane**
Tab dispatcher; each tab lives in `entrypoints/panel/components/tabs/`. Tabs: Properties (live edit, `@state`/`@property` badges, reset-to-baseline, "why did this render" markers), Attributes (live edit), Methods (invoke with JSON args), Events (log + dispatch), Slots, Styles (::parts, adopted stylesheets, live-editable CSS custom properties), A11y (cross-root ARIA), CEM (docs, auto-fetched from jsdelivr for known design systems), Signals (`@lit-labs/signals`, `@lit/context`, `@lit/task` — conditional).

Edit inputs share one non-obvious guard: Enter commits, the re-render removes the input, Chrome fires `blur` on the removed input, and an unguarded blur handler would commit again with the cleared value. Only the active editor may commit.

---

## The message protocol

Everything is typed in `types/wc.ts`. Two unions:

**`PageOutboundMessage`** — wc-inspector → content (via `postMessage`): `tree-snapshot`, `tree-patches` (add/remove/update/set-shadow ops keyed by stable id, see `lib/tree-diff.ts`), edit results, `invoke-method-result`, `pick-result`, `event-log`, `cem-loaded`.

**`ExtensionMessage`** — the chrome bus (content ↔ background ↔ panel). Discriminated union on `type`; `version` guards against stale content scripts after extension reloads.

---

## Non-obvious things

### Why Lit is detected via strict markers only
`_$litElement$` / `__litElement__` on the constructor. An `elementProperties instanceof Map` fallback existed and produced false positives (notably Stencil components on pages that also bundle Lit) — removed. Same story for signal detection: a `{ get, set }` shape fallback matched every `Map`, so Lit internals showed up as bogus signals; detection is brand-only now.

### Why shadow DOM was a problem

```
<my-app>                    ← light DOM (visible to MutationObserver)
  #shadow-root (open)       ← INVISIBLE to subtree MutationObserver
    <my-nav>                ← never detected without setupShadowObservation
      #shadow-root (open)
        <my-link>           ← deeper still
```

### Why there is no nonce system
There used to be a nonce authenticating messages between wc-inspector and content. In practice DevTools only runs for the developer on their own pages — a forged command can only do what a developer with DevTools open could already do. Four files of complexity for a theoretical vector: removed.

---

## The playground

`playground/` runs the REAL built panel next to a demo page in a plain browser tab: a ~50-line `chrome.*` shim + a harness that plays background/content over the same message protocol. Used as a reproducible manual-testing target, to record the README GIF (`playground/record-demo.ts`), and as the future e2e target. It is also the proof of concept for the Phase 6 in-page overlay mode (see TODO.md).

---

## Going further

Unit tests live in `tests/` and cover serialization, framework detection, tree building, diffing, and every panel element via jsdom. `tests/inspector-core.test.ts` is the best entry point for the edge cases.
