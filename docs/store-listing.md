# Store listing — ready-to-paste content

Working document for the Chrome Web Store and Firefox AMO submissions. Not shipped in the extension.

## Name

```
Web Components DevTools
```

## Short description (Chrome: 132 chars max)

```
Inspect and debug Web Components — shadow DOM tree, live editing, events, methods, re-render profiling. Lit, Stencil, FAST.
```

## Detailed description

```
The component-level view that Vue DevTools and React DevTools give their frameworks — for Web Components. Works with Lit, Stencil, FAST, vanilla custom elements, and design systems like Shoelace.

WHAT THE BROWSER'S ELEMENTS PANEL CAN'T SHOW YOU

• Component tree: only your custom elements, shadow DOM pierced, iframes included (Storybook works)
• JS properties (not just attributes) — live-editable, with @state vs @property badges
• adoptedStyleSheets — invisible in the Elements panel, shown here with a CSS viewer
• Exposed ::part()s and how many rules target them
• ElementInternals custom states (:state()) — visible and toggleable
• CSS custom properties resolving on each component — editable live (design-system theming)

A TOOL, NOT JUST AN INSPECTOR

• Invoke component methods with arguments, results inline
• Dispatch CustomEvents to test handlers without touching your app
• Real-time event log per component
• Trace updates: flash components on the page as they re-render
• Re-render profiling: top components by update frequency
• Click-to-source: jump to the file that registered the component (source maps applied)
• Console bridge: the selected component is $wc in your console
• Custom Elements Manifest: loads your custom-elements.json, and auto-fetches docs for known design systems (Shoelace, Vaadin, UI5…)

Open source (MIT): https://github.com/jpinhel/wc-devtools
```

## Category

Developer Tools

## Permission justifications (asked during Chrome review)

| Permission | Justification |
|---|---|
| `scripting` | Injects the inspector script into the inspected page's main world — required to read component JS properties, which content scripts (isolated world) cannot access. |
| `tabs` | Routes messages between the DevTools panel and the inspected tab, and detects navigation to re-inject the inspector. |
| `host_permissions: <all_urls>` | A DevTools extension must work on whatever page the developer is debugging — localhost, staging, production, any origin. The inspector is only injected into a tab when its DevTools panel is open; the extension does nothing on tabs the developer is not actively inspecting. No data leaves the browser. |

## Privacy disclosure

- No data collected, no analytics, no remote code.
- One outbound request type: fetching public `custom-elements.json` manifests from cdn.jsdelivr.net (documentation for known design systems), initiated from the panel, containing no page data.

## Assets checklist

- [ ] Icon 128×128 (already in `public/icon/128.png` — verify store rendering on light background)
- [ ] Screenshots 1280×800 (5 max): tree + inspector on shoelace.style, Methods invocation, Styles/CSS vars editing, trace updates mid-flash, CEM tab
- [ ] Optional promo tile 440×280
- [ ] Demo GIF for the README (not a store asset): picker → prop edit → trace updates, ~15 s

## Submission steps

1. Chrome: https://chrome.google.com/webstore/devconsole ($5 one-time) → New item → upload `.output/wc-devtools-0.5.0-chrome.zip` → fill listing + privacy tab → submit. Expect a slow review (`<all_urls>` triggers manual review — the justification above answers it).
2. Firefox: https://addons.mozilla.org/developers/ (free) → Submit new add-on → upload the firefox zip → source code not required (no minified custom code beyond the standard build). Faster review.
