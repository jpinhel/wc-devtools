# Contributing

Thanks for your interest! Issues and pull requests are welcome.

## Setup

Requirements: [Bun](https://bun.sh) ≥ 1.2

```bash
git clone https://github.com/jpinhel/wc-devtools.git
cd wc-devtools
bun install
bun run dev          # opens a browser with the extension loaded, auto-reloads
```

Open DevTools (`F12`) on any page with Web Components → **Web Components** tab.

Good pages to test against: [shoelace.style](https://shoelace.style) (Lit + CEM auto-fetch), [lit.dev playground](https://lit.dev/playground/) (iframes), any Storybook of a Web Components design system.

## Before opening a PR

A pre-commit hook (installed automatically by `bun install`) runs Biome on your staged files — `git commit --no-verify` bypasses it for WIP commits. CI runs the full gate on every PR; locally, all three must pass:

```bash
bun run lint       # Biome
bun run compile    # TypeScript
bun run test       # Vitest (jsdom)
```

Both targets must build:

```bash
bun run build            # Chrome MV3
bun run build:firefox    # Firefox MV2
```

## Code layout

| Path | What it is |
|------|------------|
| `lib/` | Pure, testable logic — no browser-extension APIs. New logic goes here first. |
| `entrypoints/wc-inspector.ts` | Injected into the page (`world: MAIN`). No chrome APIs available. |
| `entrypoints/content.ts` | Message relay between page and extension bus. Whitelists in, whitelists out. |
| `entrypoints/background.ts` | MV3 service worker — routing, injection, badge. |
| `entrypoints/panel/` | The DevTools panel, built with Lit (light DOM, global stylesheet). |
| `types/wc.ts` | Shared types and the message protocol. |

Adding a panel → page command means touching, in order: `types/wc.ts` (both message unions), `content.ts` (whitelist), `background.ts` (route list), `wc-inspector.ts` (handler + `hasId` guard if node-targeted), and the panel.

## Guidelines

- Match the existing style — Biome enforces most of it.
- Pure logic gets unit tests; UI flows that carry user input get regression tests (the edit-commit flows have bitten us before).
- The injected script must **never disrupt the page**: wrap risky calls, fail silent.
- For significant changes, open an issue first to discuss the approach.
