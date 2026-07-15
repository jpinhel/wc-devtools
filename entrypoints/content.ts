import { defineContentScript } from 'wxt/utils/define-content-script';
import type { ExtensionMessage, PageOutboundMessage } from '../types/wc';
import { MESSAGE_VERSION } from '../types/wc';

/**
 * Content script — bridge between the page context (wc-inspector) and the extension bus.
 *
 * ASCII — message flow:
 *
 *   wc-inspector.ts (world: MAIN)
 *        │ window.postMessage (same-window + source check)
 *        ▼
 *   content.ts (isolated world)  ◀──── chrome.runtime.onMessage ─── background.ts
 *        │ chrome.runtime.sendMessage
 *        ▼
 *   background.ts ──▶ devtools panel
 *
 * Both directions are pure whitelisted relays: the payload shape is enforced by
 * the typed emit sites (panel / wc-inspector) and re-validated by version+type
 * at each receiver, so fields are forwarded wholesale instead of copied one by
 * one. A type missing from a whitelist is simply not relayed — the same
 * failure mode as a forgotten switch case, with a tenth of the code.
 *
 * Security note:
 *   Messages from the page are validated by (a) `event.source === window`
 *   to reject cross-frame senders and (b) the discriminator `data.source ===
 *   'wc-devtools-injected'` plus a `version` check. There is no nonce; an
 *   adversarial page script can post forged commands but the only impact is
 *   running the same actions a developer with DevTools open could already
 *   trigger (toggle-state, set-prop, refresh).
 */

/** Panel commands relayed verbatim into the page (minus `version`). */
const PANEL_COMMANDS = new Set<ExtensionMessage['type']>([
  'highlight-node',
  'set-prop',
  'enter-pick-mode',
  'exit-pick-mode',
  'scroll-into-view',
  'toggle-state',
  'set-attr',
  'remove-attr',
  'set-css-var',
  'trace-updates',
  'invoke-method',
  'dispatch-event',
]);

/** Inspector messages relayed verbatim to the background (minus `source`). */
const PAGE_MESSAGES = new Set<PageOutboundMessage['type']>([
  'tree-snapshot',
  'tree-patches',
  'set-prop-result',
  'set-attr-result',
  'set-state-result',
  'invoke-method-result',
  'event-log',
  'pick-result',
  'cem-loaded',
]);

export default defineContentScript({
  matches: ['<all_urls>'],
  // Iframes too (e.g. Storybook renders everything inside one) — each frame
  // gets its own bridge; background routes by sender.frameId.
  allFrames: true,
  main() {
    // ── Announce to background that this content script is alive ─────────────
    //
    // If a DevTools panel is already open for this tab, background will
    // respond by injecting the inspector. This handles the case where the
    // user navigates to a new page while the panel is open.
    //
    chrome.runtime
      .sendMessage({
        version: MESSAGE_VERSION,
        type: 'content-ready',
      } satisfies ExtensionMessage)
      .catch(() => {
        // Background not ready yet (e.g. service worker starting up) — harmless,
        // panel will trigger injection via devtools-init when it opens.
      });

    // ── Relay panel commands (background → page) ──────────────────────────────

    chrome.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as ExtensionMessage;
      if (msg.version !== MESSAGE_VERSION) return;

      if (msg.type === 'refresh-request') {
        window.postMessage({ source: 'wc-devtools-command', type: 'refresh' }, '*');
        return;
      }
      if (PANEL_COMMANDS.has(msg.type)) {
        const { version: _version, ...command } = msg;
        window.postMessage({ source: 'wc-devtools-command', ...command }, '*');
      }
    });

    // ── Relay inspector messages (page → background) ──────────────────────────

    window.addEventListener('message', (event) => {
      // Security: only accept messages from this window (not iframes, not other origins)
      if (event.source !== window) return;

      const data = event.data as PageOutboundMessage | null;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'wc-devtools-injected') return;
      if (data.version !== MESSAGE_VERSION) return;
      if (!PAGE_MESSAGES.has(data.type)) return;

      const { source: _source, ...payload } = data;
      chrome.runtime.sendMessage(payload as unknown as ExtensionMessage).catch(() => {});
    });
  },
});
