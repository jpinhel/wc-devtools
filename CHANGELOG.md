# Changelog

All notable changes to WC DevTools will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.0] — 2026-07-15

From inspector to tool. Iframe support, click-to-source, method invocation, event dispatch, trace updates, live CSS variable editing, CEM auto-fetch — plus a hard round of real-world bug fixing on shoelace.style and lit.dev.

### Added

- **Iframe support.** Content script and inspector now run in every frame (`allFrames`) — Storybook and other iframe-based playgrounds are no longer invisible. Node ids are frame-unique (random prefix per iframe registry), commands are broadcast and ignored by non-owner frames, the background stamps `frameId`/`frameUrl` on tree messages, and the panel merges per-frame trees (top frame first). `inspectedWindow.eval` targets the owning frame so console helpers work on iframe nodes.
- **Click-to-source.** The registration site is captured from the stack at `customElements.define` (extension frames excluded, bundled-dependency frames deprioritized) and surfaced as a `src` button in the inspector header — opens the Sources panel at the right line, source maps applied. Firefox falls back to opening the raw URL.
- **Method invocation.** The Methods tab is a tool now: hover ▶ runs a method directly, clicking the name opens a one-at-a-time JSON args editor (Enter runs, Escape closes). Results are serialized inline; Promises are awaited; errors show in red.
- **Event dispatch.** Fire a `CustomEvent` (type + optional detail JSON, bubbles + composed) on the selected component from the Events tab — the captured log entry doubles as the acknowledgement.
- **Trace updates.** Toolbar toggle that flashes components on the page as they emit update patches (cap 30/batch) — the React DevTools "highlight updates" for Web Components.
- **Live CSS custom property editing.** Click a variable's computed value in the Styles tab to set an inline override on the host (empty value clears it) — the design-system theming workflow.
- **CEM auto-fetch.** When a known design-system prefix appears in the registry (`sl-`, `wa-`, `vaadin-`, `ui5-`, `lion-`), the panel fetches the manifest from jsdelivr — instant documented CEM tab on pages that don't ship their own manifest (which still wins when present).
- **"+N hidden" everywhere something is capped.** `collectWCChildren` counts what the capacity cap excludes instead of dropping it silently; the tree shows "+N hidden" rows in place and the status bar shows the page-level total. `MAX_CHILDREN` raised 50 → 300.
- **`$wc` console alias** alongside the existing `$wc0`…`$wc4` history.
- **Removed-from-page notice.** When the selected component leaves the DOM (e.g. `sl-alert.toast()` destroys the element after hiding), the inspector says so instead of silently going blank.
- **Cmd/Ctrl+K** focuses the search field (the hint badge existed but was dead).

### Fixed

- **Zombie inspector instances.** Every panel (re)connect re-injected the inspector without destroying the previous instance — competing id registries corrupted the tree stream, dropped selections after every refresh and swallowed commands. Injection now tears down the previous instance (`__WC_DEVTOOLS_TEARDOWN__`: observers, listeners, scheduler; prototype patches degrade to passthroughs).
- **Property edits overwritten with `''`.** Enter committed the edit, then the re-render removed the input, Chrome fired `blur` on it, and the blur handler committed again with the cleared value. Only the active editor may commit now (props, css-vars; attrs already had the guard).
- **Every panel command fired twice.** Tab events bubble composed through the light-DOM inspector straight to the app — the extra re-forwarding layer made every handler run twice (methods were invoked twice on the page). Removed.
- **Stale Properties tab after set-prop.** Prop changes don't necessarily produce childList mutations; set-prop now forces a refresh like set-attr always did.
- **Bogus Signals tab on every Lit component.** The `{ get, set }` shape fallback in signal detection matched every `Map`, so Lit internals (`_$AL`, `_$changedProperties`) showed up as signals. Detection is brand-only now (TC39 `Symbol("SIGNAL")` + preact brand) — the tab only appears for real signals.
- **CSS injection via the color swatch.** Inspected-page values are interpolated into the panel's `style` attribute; the color regex is now a full anchored match so `rgb(0,0,0) url(https://…)` no longer passes.
- **SPA navigation staleness.** `history.pushState`/`replaceState`/`popstate` reschedule the tree build.
- **Registry scan** pierces open shadow roots — components defined before injection but nested in shadow trees are captured.
- Breadcrumb no longer marks the last segment active without a selection; long property/attribute names get full-name tooltips; dead `delete-prop` protocol chain removed end-to-end.

### Changed

- **CEM tab redesigned.** The 4-column table (unreadable descriptions squeezed into a narrow column) became doc rows: name + type chip + default on one line, full-width description below. Unified across Attributes/Events/Slots/CSS Parts/CSS Custom Properties.
- **Methods tab redesigned.** Compact `name()` rows with hover actions instead of a permanent args input per row.
- **content.ts relays** are whitelist + spread instead of field-by-field switches (−150 lines, same failure mode as a forgotten case).
- Machine-specific browser binary path moved out of `wxt.config.ts` into gitignored `web-ext.config.ts`.

### Internal

- 224 vitest tests across 26 files (was 190). New coverage: stack parsing, `callMethod`, capacity-aware collection, scheduler dispose/onPatches, frame-prefixed registries, double-commit guards, dispatch/invoke UI flows.
- `collectWCChildren` returns `{ nodes, dropped }` (capacity-aware recursion, no more approximate slicing); `WCNode` gains `sourceRef`, `droppedChildren`, `droppedShadow`.
- New protocol messages: `invoke-method(-result)`, `dispatch-event`, `trace-updates`, `set-css-var`; tree messages carry `frameId`/`frameUrl`/`truncated`.

## [0.4.0] — 2026-04-26

Phase 4 — Dogfood. The DevTools panel itself is now built with Lit instead of Vue. Same UX, ~190 unit tests, smaller dep graph.

### Changed

- **Panel rewritten Vue 3 → Lit 3.** Every Vue SFC under `entrypoints/panel/` (`App.vue`, `WcInspector.vue`, `WcTreeVirtual.vue`, `WcRegistry.vue`, `ProfilingPanel.vue`, `Breadcrumb.vue`, `PropValue.vue`, `CodeMirrorView.vue`, plus 9 tab files) is now a Lit custom element. The panel now self-hosts a non-trivial Lit application — the tool eats its own dog food.
- **Tree virtualization** moved from `vue-virtual-scroller` to `@lit-labs/virtualizer`. Same ~30-row visible window, tree-row event delegation now via CustomEvents (`node-select`, `node-hover`, `node-scroll-to`, `node-inspect`).
- **Composables → Reactive Controllers.** `useBaselineSnapshot` and `useEditHistory` are now `BaselineController` and `EditHistoryController` Lit `ReactiveController`s wired into `<wc-devtools-app>`.
- **Light DOM by design.** Every Lit element overrides `createRenderRoot()` to render into the document tree. The existing global stylesheet (`style.css` + `vars.css`) carries over without rewrite.
- **Vue's provide/inject is gone.** Tree → App callbacks now flow as bubbling+composed CustomEvents the App listens for at the tree element.
- **Lucide icons** are now an inline SVG registry (`panel/icons.ts`). No more `lucide-vue-next` runtime.

### Removed

- `vue`, `lucide-vue-next`, `vue-virtual-scroller`, `@vitejs/plugin-vue` deps.
- `entrypoints/panel/composables/` (replaced by `entrypoints/panel/controllers/`).
- `entrypoints/panel/shims-vue.d.ts`.

### Internal

- 27 test files, 190 vitest tests passing (was 132). New `tests/panel/*.test.ts` smoke-tests every Lit element.
- `@types/chrome` added as an explicit devDep (was implicit in `node_modules` only).
- `tests/setup.ts` stubs `ResizeObserver`, `IntersectionObserver`, `matchMedia` so Lit Labs virtualizer + theme-detection code paths don't blow up in jsdom.
- Production build size: 581.9 kB total (panel chunk includes CodeMirror, dynamically imported on demand).

## [0.3.0] — 2026-04-26

Phase 3 — framework depth. 12 commits (3 wave-1 parallel via worktrees + 4 sequential), 132 unit tests. Adds Lit Labs (signals / context / task), Stencil hydration markers, Stencil `@State`/`@Prop` distinction, Custom Elements Manifest companion, and framework version detection.

### Added

- **Framework version in badges.** `Lit 3.3.2`, `Lit 2.x`, `Stencil 4.x` instead of plain `Lit`. Reads `globalThis.litElementVersions` for Lit 3, `_$litElement$` / `__litElement__` constructor markers as fallback, and `<meta name="generator">` for Stencil.
- **Custom Elements Manifest companion.** Inspector fetches `/custom-elements.json` (and a few common variants) at injection time. When found, surfaces a "CEM" tab with the standardised description, attributes, events, slots, css parts, and css custom properties for the selected component. Framework-agnostic: works for Lit, Stencil, FAST, vanilla, or anything that ships a CEM.
- **Stencil `@State` vs `@Prop` distinction.** Phase 2A surfaced this for Lit only. Now `serializePropMeta` reads Stencil's `cmpMeta$.$members$` MEMBER_FLAGS bit field so the Properties tab badges Stencil components correctly (state vs prop, plus the reflects indicator).
- **Lit Labs `@lit-labs/signals` tab.** Detects branded signals (Symbol-keyed) and shape-based signals (objects with `.get()` plus `.set()`/`.peek()` on the prototype) attached as own properties of the element. Renders each signal's label and current value in a new "Signals" tab.
- **Lit Labs `@lit/context` tracking.** Patched `dispatchEvent` captures `context-request` events per element. The Signals tab now also lists which contexts each component requests, with the context key.
- **Lit Labs `@lit/task` state surfacing.** Detects Task instances (numeric `.status` enum + `.run()` on prototype) attached as own properties. The Signals tab shows each task's status badge (initial / pending / complete / error), the resolved value when complete, and the error message when failed.
- **Stencil hydration badges.** Components that came from SSR (`s-id` attribute) but haven't yet hydrated show an `SSR` badge in the inspector header. After hydration (`s-hn` runtime field), the badge flips to `HYD`. Helps diagnose SSR/CSR mismatch.

### Changed

- `WCNode` gains optional fields: `frameworkVersion`, `signals`, `contextRequests`, `tasks`, `stencilHydration`. All graceful — sites without Lit Labs / Stencil / a CEM see no new UI clutter.
- The "Signals" tab only appears when at least one of `signals`, `contextRequests`, or `tasks` is non-empty for the selected component.
- The "CEM" tab only appears when a manifest was loaded for the page origin AND the selected component's `tagName` exists in the manifest.

### Internal

- New pure modules: `lib/cem-loader.ts`, `lib/lit-labs.ts`, `lib/stencil-meta.ts`. Each unit-tested with hand-rolled fixtures so they don't depend on actually loading Lit Labs or Stencil at test time.
- Test count: 101 → 132 (+31).
- Bundle: panel boot 37 KB gzipped (unchanged); `wc-inspector.js` adds ~2 KB for the CEM fetch + context-request capture; `lib/lit-labs.ts` is tree-shaken into the inspector chunk.
- Phase 3 Wave 1 (T1 + T2 + T6) shipped in parallel git worktrees with sequential merges to `main`. Waves 2 and 3 ran sequentially after a Claude usage limit blocked the parallel agents — moved to in-session implementation.

## [0.2.0] — 2026-04-26

Phase 2B — perf foundation + Phase 2A cleanup. 14 commits, 101 unit tests, end-to-end protocol bump (MESSAGE_VERSION 1 → 2).

### Added

- **Diff patches over the wire.** `tree-update` is replaced by `tree-snapshot` (full tree on first send + after navigation) and `tree-patches` (incremental `add` / `remove` / `update` / `set-shadow` ops keyed by stable WCNode id). The panel ↔ inspector payload drops by 90%+ on active SPAs. The background service worker also applies patches so the toolbar badge + popup stay in sync without DevTools open.
- **Re-render frequency view.** New "Perf" tab in the left pane shows the top-30 components by update count over a 5-second rolling window. 500 ms ticker keeps the window sliding even when the page is idle. Fed at zero serialization cost by the new patch stream.
- **Virtualised component tree.** `vue-virtual-scroller`-backed flat-row renderer replaces the previous recursive Vue tree. Only ~30 rows live in the DOM regardless of tree depth; comfortable on apps with 5000+ custom elements. Auto-expands roots on first non-empty tree and ancestor-expands when picking from the page so the selection always materialises.
- **Add / delete JS properties.** Properties tab gains an "add row" (input + value + Add button) and a per-row trash button. New `delete-prop` command end-to-end via `Reflect.deleteProperty` — non-configurable failures are surfaced as errors instead of silent successes.
- **Reset to initial value.** New baseline snapshot composable records the first-seen properties + attributes per node id. Per-row 🔄 button restores the captured value when current differs.
- **Undo / redo.** Ctrl+Z reverts the last `set-prop` / `set-attr` / `remove-attr` / `delete-prop`; Ctrl+Shift+Z and Ctrl+Y re-apply. Toolbar buttons reflect enabled state. Stack of 100.
- **Prop filter autocomplete.** Native `<datalist>` populated from prop names of currently-visible components.
- **CodeMirror follows panel theme.** Switches to a light theme automatically when the panel is in light mode; respects `prefers-color-scheme` in system mode.

### Changed

- `WcInspector.vue` was 503 lines housing all 7 tabs inline. Now a 148-line tab strip + dispatcher that delegates to per-tab subcomponents under `entrypoints/panel/components/tabs/` (`PropsTab`, `AttrsTab`, `MethodsTab`, `EventsTab`, `SlotsTab`, `StylesTab`, `A11yTab`). Easier to extend without merge thrash.
- The deeper levels of the component tree now start collapsed (only roots auto-expand). Previously every level rendered by default. This is a deliberate trade-off for virtualisation; click chevrons to expand or pick from the page to ancestor-expand.
- Edit-cancel watch is now gated on `node.id` change so an in-progress edit is preserved across `tree-patches` updates targeting the same component.

### Fixed

- Background service worker badge and popup cache now update on every `tree-patches` message (not just snapshots).

### Internal

- New pure modules: `lib/tree-diff.ts`, `lib/profiling.ts`, `lib/tree-flatten.ts`.
- New panel composables: `entrypoints/panel/composables/{useBaselineSnapshot,useEditHistory}.ts`.
- Test count: 73 → 101 (+28).
- Bundle: panel boot stays at ~37 KB gzipped; new `vue-virtual-scroller@3` dependency adds ~12 KB to the tree pane chunk.

## [0.1.0] — 2026-03-30

Initial public version. Phase 1 + Phase 2A landed on `main`.

### Phase 1 — Web Components-only killer features

- Component tree with shadow DOM traversal, framework detection (Lit / FAST / Stencil / vanilla).
- Slots inspector — assigned vs fallback nodes, count of `::slotted` rules.
- `::part` exposures with rule count per part.
- `adoptedStyleSheets` viewer with CodeMirror CSS syntax highlighting.
- CSS custom properties — declared on host vs inherited, computed values.
- `CustomStateSet` chips with click-to-remove.
- Cross-root ARIA visualisation (`aria-controls`, `aria-describedby`, etc.).
- `$wc0` in the console + `$wc1..$wc4` history.
- Demo fixture page.

### Phase 2A — DX features

- Breadcrumb path from root to selected node.
- `@state` vs `@property` badges + reflects-to-attribute indicator (`↔`).
- Advanced search — regex toggle, framework filter, by-prop filter.
- Single-click edit, boolean toggle, hover pencil for primitives, click-to-edit for attributes.
- CodeMirror JSON editor for object props.
- "Why did this render?" — `●` marker + previous-value tooltip on properties that changed since the last snapshot.
