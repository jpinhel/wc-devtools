# WC DevTools — Roadmap

Benchmarked against Vue DevTools / React DevTools. Ordered from most critical to nice-to-have.

---

## 🚀 Phase 6 — Multi-mode distribution (inspired by vuejs/devtools v7)

Vue DevTools v7 is not an extension but four hosts of one core (extension, Vite plugin, in-page overlay, standalone). The Vite plugin shipped by default in Nuxt is what made their adoption explode: zero install. The playground harness (2026-07) proved our panel runs in a plain browser tab with ~50 lines of chrome shim — we are 80% of the way there.

- [ ] **In-page overlay** — A single script that injects wc-inspector + the panel as a floating pane on the dev page (a generalization of the harness: same iframes/shim, inside the page itself). Also sidesteps the slow Chrome Web Store review.
- [ ] **Vite plugin `wc-devtools/vite`** — Auto-injects the overlay in dev. The "zero install" mode, adoption lever #1 (confirmed by both market research and Vue DevTools' own history). Nobody offers this for Web Components.
- [ ] **Open-in-editor** — In the Vite plugin mode: dev-server route `/__open-in-editor` + `launch-editor` (the package Vue/Svelte use) so the `src` button opens VS Code instead of the Sources panel. Completes click-to-source.
- [ ] **Extract the core into a package** (their `devtools-kit` equivalent) — `lib/` + `types/wc.ts` are already pure; formalize them as a publishable package with extension / overlay / Vite plugin / future MCP server as hosts.
- [ ] **Separate-window mode** for the panel — easy once the overlay exists.

Deliberately not copied: pnpm+Turbo monorepo (premature), standalone Electron app (their React Native need, not ours), command palette and generic timeline (gimmicks per the 2026-07 research).

---

## 🔴 Critical (blocking wide adoption)

- [x] **Click-to-source** — Stack captured at `customElements.define` → `src` button in the inspector → `chrome.devtools.panels.openResource` (source maps applied by the Sources panel). Limitations: components defined before injection have no sourceRef; Firefox falls back to `window.open`. Optional follow-up: Vite plugin + `launch-editor` to open VS Code directly.
- [ ] **E2E tests** — No end-to-end integration tests yet. Add Playwright against the playground harness.

---

## 🟡 Phase 2C — Improvements

- [ ] **Better event log** — Add: Lit/Stencil lifecycle events (via `connectedCallback`/`update` patch), log pause, filter by type/component, partial stack trace.
- [ ] **Tree filters** — Toggle to hide components without shadow DOM, hide by framework, hide nodes past a given depth.
- [x] **Visual re-render indicator on the page** — "Trace updates": toolbar toggle, flash overlay on every component that emits an `update` patch (cap 30/batch). Limitation: granularity = the scheduler's 300ms debounce.
- [x] **MAX_CHILDREN + "+N hidden" indicator** — Cap raised 50 → 300, and no more silent truncation: `collectWCChildren` counts what it excludes (capacity-aware recursion), `droppedChildren`/`droppedShadow` on nodes, root `truncated` in messages. UI: "+N hidden" rows in the tree + total in the status bar.
- [x] **Complete registry (scan)** — The initial scan now pierces open shadow roots (pre-injection components nested in shadow trees are captured). Still impossible: enumerating tags that are defined but absent from the DOM (`customElements` has no enumeration API).
- [ ] **Pre-injection ElementInternals** — Components that called `attachInternals()` before injection are not tracked in `internalsByHost`. Walk customs at injection time with catch-and-ignore, or show a "states unavailable" badge.

---

## 🟢 Nice to have

- [ ] **State export/import** — JSON snapshot of the tree + properties.
- [ ] **Firefox support** — Chrome MV3 only today. Firefox has supported MV3 since 109, with differences.
- [x] **SPA navigation detection** — `history.pushState`/`replaceState` patched + `popstate` → reschedule the tree build.
- [x] **CI/CD** — GitHub Actions: lint (biome), typecheck, tests (vitest), both builds on every push/PR.

---

## ✅ Done

**Phase 1 — Solid base**
- [x] Clean multi-context architecture (page / content / background / panel)
- [x] Robust serialization (circulars, throwing getters, BigInt, DOM elements…)
- [x] Lit / FAST / Stencil / vanilla detection
- [x] Live property editing (set-prop)
- [x] Event log (CustomEvents)
- [x] Element picker with highlight overlay
- [x] Registry of defined custom elements
- [x] System / dark / light theme with localStorage persistence
- [x] Automatic reconnection when the MV3 service worker is killed
- [x] Filtering by tag name
- [x] Popup with per-framework breakdown
- [x] CSS tokens (`vars.css`) separated from component rules
- [x] **Slots** — dedicated tab, assigned/fallback, `::slotted` count
- [x] **CSS custom properties** — host vs inherited, computed values
- [x] **`::part`** — rule count per part
- [x] **`adoptedStyleSheets`** — CodeMirror viewer
- [x] **`CustomStateSet`** — active chips + click-to-remove
- [x] **Cross-root ARIA** — `aria-controls` etc. with cross-root marker
- [x] **`$wc0` console binding** + `$wc1..$wc4` history

**Phase 2A — DX features**
- [x] **Breadcrumb** — full path to the selected node
- [x] **`@state` vs `@property` distinction** — badges + `↔` reflects indicator
- [x] **Advanced search** — regex, framework filter, by-prop filter
- [x] **Edit UX** — single-click, boolean toggle, hover pencil
- [x] **CodeMirror JSON editor** for object props, **CSS viewer** for adopted stylesheets
- [x] **"Why did this render?"** — `●` marker + diff tooltip

**Phase 2B — Perf foundation + cleanup**
- [x] **Diff patches** — `tree-snapshot` + `tree-patches` keyed by id, 200-patch cap with snapshot fallback
- [x] **Profiling timeline** — top-30 components by re-render frequency (5s rolling window)
- [x] **Tree virtualization** — flat rows, ~30 DOM rows regardless of tree size
- [x] **WcInspector extraction** — 7 sub-tabs `Props/Attrs/Methods/Events/Slots/Styles/A11y`
- [x] **CodeMirror light theme** — follows `data-theme` + `prefers-color-scheme`
- [x] **Add/delete JS prop** — add row + trash + `Reflect.deleteProperty` (flags non-configurables)
- [x] **Reset to initial value** — 🔄 per row, first-seen baseline
- [x] **Undo/redo** — Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, stack of 100, discriminated EditOp
- [x] **Prop filter autocomplete** — datalist from the visible tree

**Phase 3 — Framework depth**
- [x] **Framework version detection** — `Lit 3.3.2`, `Lit 2.x`, `Stencil 4.x` in the badge
- [x] **CEM-aware companion** — fetches `/custom-elements.json` + CEM tab (descriptions, attrs, events, slots, parts, css custom props)
- [x] **Stencil `@State` vs `@Prop`** — `serializePropMeta` extension via `cmpMeta$.$members$` MEMBER_FLAGS
- [x] **Lit Labs `@lit-labs/signals`** — brand detection, Signals tab
- [x] **Lit Labs `@lit/context`** — `context-request` event capture, Context section in the Signals tab
- [x] **Lit Labs `@lit/task`** — Task status enum (initial/pending/complete/error), Tasks section in the Signals tab
- [x] **Stencil hydration markers** — SSR / HYD badges in the inspector header

**Phase 4 — Dogfood**
- [x] **Panel Vue → Lit** — every SFC under `entrypoints/panel/` rewritten as a Lit custom element (light DOM). `<wc-devtools-app>` root, `<wc-inspector>`, `<wc-tree-virtual>` (with `@lit-labs/virtualizer`), `<wc-tab-*>`, etc.
- [x] **Composables → ReactiveControllers** — `BaselineController`, `EditHistoryController`.
- [x] **Vue deps dropped** — vue, lucide-vue-next, vue-virtual-scroller, @vitejs/plugin-vue removed. Icons inlined in `panel/icons.ts`.

**Phase 5 — Release readiness (2026-07)**
- [x] **Iframe support**, **click-to-source**, **method invocation**, **event dispatch**, **trace updates**, **live CSS var editing**, **CEM auto-fetch** — see CHANGELOG 0.5.0
- [x] **CI GitHub Actions** + pre-commit hook (Biome on staged files) + Renovate config
- [x] **Playground harness** — the real built panel in a plain tab, scripted README GIF
- [x] **Governance** — CONTRIBUTING, SECURITY, issue templates, store listing draft
