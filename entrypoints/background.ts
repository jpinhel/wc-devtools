import { defineBackground } from 'wxt/utils/define-background';
import { applyPatches } from '../lib/tree-diff';
import type { ExtensionMessage, WCNode } from '../types/wc';
import { MESSAGE_VERSION } from '../types/wc';

/**
 * Background service worker — routes messages between content scripts and DevTools panels.
 *
 * ASCII — state machine for a tab's inspection lifecycle:
 *
 *   [NO_PANEL]
 *       │ devtools-init received
 *       ▼
 *   [PANEL_OPEN] ──── tab navigates (onUpdated loading) ──▶ [REINJECT_PENDING]
 *       │                                                          │
 *       │ content-ready received                            content-ready
 *       │ (panel already open, page reloaded)               received
 *       ▼                                                          │
 *   [INJECTING] ◀─────────────────────────────────────────────────┘
 *       │ executeScript succeeds
 *       ▼
 *   [ACTIVE]  ◀──── tree-snapshot | tree-patches, set-prop-result, badge updates
 *       │ port.onDisconnect
 *       ▼
 *   [NO_PANEL]
 *
 * ASCII — message routing:
 *
 *   content.ts ──sendMessage──▶ background ──port.postMessage──▶ panel
 *   panel ──port.postMessage──▶ background ──tabs.sendMessage──▶ content.ts
 */

/** Cached last-known state per tab — used to answer popup-query without needing an open DevTools panel. */
interface TabState {
  count: number;
  registry: string[];
  frameworks: Record<string, number>;
}

export default defineBackground(() => {
  /** DevTools panel port per tab. */
  const devToolsPorts = new Map<number, chrome.runtime.Port>();
  /** Last-known WC state per tab — kept in memory, survives DevTools close/open. */
  const tabStateCache = new Map<number, TabState>();
  /** Per-tab, per-frame last-known tree + registry, used to apply incremental patches. */
  interface FrameState {
    tree: WCNode[];
    registry: string[];
  }
  const tabTrees = new Map<number, Map<number, FrameState>>();

  /** Recomputes badge + popup cache from every frame's tree in the tab. */
  function updateTabState(tabId: number, frames: Map<number, FrameState>): void {
    let count = 0;
    const frameworks: Record<string, number> = {};
    const registry = new Set<string>();
    for (const { tree, registry: names } of frames.values()) {
      count += countNodes(tree);
      for (const [fw, n] of Object.entries(countFrameworks(tree))) {
        frameworks[fw] = (frameworks[fw] ?? 0) + n;
      }
      for (const name of names) registry.add(name);
    }
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#027cb1', tabId }).catch(() => {});
    tabStateCache.set(tabId, { count, registry: [...registry].sort(), frameworks });
  }

  // ── Inspector injection ────────────────────────────────────────────────────

  /**
   * Injects wc-inspector.js into the tab's page context (world: MAIN).
   * The script tears down any previous instance itself (__WC_DEVTOOLS_TEARDOWN__),
   * so re-injection is always safe.
   * No frameId → all frames (panel opening); a frameId → just that frame
   * (a single frame finished loading and announced content-ready).
   */
  async function injectInspector(tabId: number, frameId?: number): Promise<void> {
    const target: chrome.scripting.InjectionTarget =
      frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
    try {
      await chrome.scripting.executeScript({
        target,
        world: 'MAIN',
        files: ['wc-inspector.js'],
      });
    } catch (err) {
      // Common: CSP-restricted page, privileged page (chrome://), tab not loaded
      const port = devToolsPorts.get(tabId);
      if (!port) return;
      try {
        port.postMessage({
          version: MESSAGE_VERSION,
          type: 'injection-failed',
          error: err instanceof Error ? err.message : String(err),
        } satisfies ExtensionMessage);
      } catch {
        // Port closed between check and send
        devToolsPorts.delete(tabId);
      }
    }
  }

  // ── DevTools panel connections ─────────────────────────────────────────────

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'devtools') return;

    let tabId: number | null = null;

    port.onMessage.addListener((message: unknown) => {
      const msg = message as ExtensionMessage;
      if (msg.version !== MESSAGE_VERSION) return;

      // First message must be the init handshake carrying the inspected tab's ID
      if (tabId === null) {
        if (msg.type === 'devtools-init') {
          tabId = msg.tabId;
          devToolsPorts.set(tabId, port);
          injectInspector(tabId);
        }
        return;
      }

      // Route panel commands → content script
      if (
        msg.type === 'highlight-node' ||
        msg.type === 'set-prop' ||
        msg.type === 'refresh-request' ||
        msg.type === 'enter-pick-mode' ||
        msg.type === 'exit-pick-mode' ||
        msg.type === 'scroll-into-view' ||
        msg.type === 'toggle-state' ||
        msg.type === 'set-attr' ||
        msg.type === 'remove-attr' ||
        msg.type === 'trace-updates' ||
        msg.type === 'invoke-method' ||
        msg.type === 'dispatch-event' ||
        msg.type === 'set-css-var'
      ) {
        chrome.tabs.sendMessage(tabId, msg).catch(() => {
          // Tab may have navigated or content script may have unloaded
        });
      }
    });

    port.onDisconnect.addListener(() => {
      if (tabId === null) return;
      devToolsPorts.delete(tabId);
      chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    });
  });

  // ── Messages from content scripts and popup ────────────────────────────────

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as ExtensionMessage;
    if (msg.version !== MESSAGE_VERSION) return;

    // Popup query — sender has no tab (comes from popup context)
    if (msg.type === 'popup-query') {
      const state = tabStateCache.get(msg.tabId) ?? { count: 0, registry: [], frameworks: {} };
      sendResponse({
        version: MESSAGE_VERSION,
        type: 'popup-state',
        ...state,
      } satisfies ExtensionMessage);
      return true; // keep channel open for async sendResponse
    }

    const tabId = sender.tab?.id;
    if (tabId === undefined) return;

    switch (msg.type) {
      case 'content-ready': {
        // Content script just loaded. If a panel is already open for this tab,
        // inject the inspector now (handles: panel open → page navigates → reload).
        // Only the announcing frame is (re)injected — other frames are untouched.
        if (devToolsPorts.has(tabId)) {
          injectInspector(tabId, sender.frameId);
        }
        break;
      }

      case 'tree-snapshot': {
        const frameId = sender.frameId ?? 0;
        const port = devToolsPorts.get(tabId);
        if (port) {
          try {
            // Stamp the originating frame so the panel can keep per-frame trees
            // and target inspectedWindow.eval at the right frame.
            port.postMessage({ ...msg, frameId, frameUrl: sender.url });
          } catch {
            devToolsPorts.delete(tabId);
          }
        }
        const frames = tabTrees.get(tabId) ?? new Map<number, FrameState>();
        frames.set(frameId, { tree: msg.tree, registry: msg.registry });
        tabTrees.set(tabId, frames);
        updateTabState(tabId, frames);
        break;
      }
      case 'tree-patches': {
        const frameId = sender.frameId ?? 0;
        const port = devToolsPorts.get(tabId);
        if (port) {
          try {
            port.postMessage({ ...msg, frameId, frameUrl: sender.url });
          } catch {
            devToolsPorts.delete(tabId);
          }
        }
        const frames = tabTrees.get(tabId);
        const prev = frames?.get(frameId);
        if (frames && prev) {
          frames.set(frameId, {
            tree: applyPatches(prev.tree, msg.patches),
            registry: msg.registry,
          });
          updateTabState(tabId, frames);
        }
        break;
      }

      case 'pick-result':
      case 'set-prop-result':
      case 'set-state-result':
      case 'set-attr-result':
      case 'invoke-method-result':
      case 'event-log':
      case 'cem-loaded': {
        const port = devToolsPorts.get(tabId);
        if (port) {
          try {
            port.postMessage(msg);
          } catch {
            devToolsPorts.delete(tabId);
          }
        }
        break;
      }
    }
  });

  // ── Tab navigation ─────────────────────────────────────────────────────────
  //
  // On 'loading': notify the panel immediately so it can show a loading state.
  // Re-injection is handled by content.ts sending 'content-ready' once it loads.
  //
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const port = devToolsPorts.get(tabId);
    if (!port) return;

    if (changeInfo.status === 'loading') {
      // Reset badge
      chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
      tabTrees.delete(tabId);
      try {
        port.postMessage({
          version: MESSAGE_VERSION,
          type: 'tab-navigated',
        } satisfies ExtensionMessage);
      } catch {
        devToolsPorts.delete(tabId);
      }
    }
  });

  // ── Cleanup on tab close ───────────────────────────────────────────────────

  chrome.tabs.onRemoved.addListener((tabId) => {
    devToolsPorts.delete(tabId);
    tabStateCache.delete(tabId);
    tabTrees.delete(tabId);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Counts all WC nodes in the tree (light DOM + shadow DOM combined). */
function countNodes(tree: WCNode[]): number {
  let count = 0;
  const stack = [...tree];
  while (stack.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length guard ensures pop() is defined
    const node = stack.pop()!;
    count++;
    if (Array.isArray(node.children)) stack.push(...node.children);
    if (Array.isArray(node.shadowRoot)) stack.push(...node.shadowRoot);
  }
  return count;
}

/** Counts WC nodes grouped by framework. */
function countFrameworks(tree: WCNode[]): Record<string, number> {
  const result: Record<string, number> = {};
  const stack = [...tree];
  while (stack.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length guard ensures pop() is defined
    const node = stack.pop()!;
    result[node.framework] = (result[node.framework] ?? 0) + 1;
    if (Array.isArray(node.children)) stack.push(...node.children);
    if (Array.isArray(node.shadowRoot)) stack.push(...node.shadowRoot);
  }
  return result;
}
