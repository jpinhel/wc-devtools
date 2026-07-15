/**
 * Popup script — shows WC summary for the active tab.
 *
 * Flow:
 *   1. Get active tab ID
 *   2. Send popup-query to background → receive popup-state (count, registry, frameworks)
 *   3. Render the summary
 *
 * If the DevTools panel was never opened for this tab, count will be 0.
 * The popup explains how to open the panel in that case.
 */

import './style.css';
import type { ExtensionMessage } from '../../types/wc';
import { MESSAGE_VERSION } from '../../types/wc';

const FRAMEWORK_LABELS: Record<string, string> = {
  lit: 'Lit',
  fast: 'FAST',
  stencil: 'Stencil',
  vanilla: 'WC',
};

async function init(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    app.innerHTML = renderError('No active tab found.');
    return;
  }

  // Privileged pages (chrome://, about:, etc.)
  const url = tab.url ?? '';
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:')
  ) {
    app.innerHTML = renderPrivileged(url);
    return;
  }

  // Query background for latest cached state
  let state: { count: number; registry: string[]; frameworks: Record<string, number> };
  try {
    const response = (await chrome.runtime.sendMessage({
      version: MESSAGE_VERSION,
      type: 'popup-query',
      tabId: tab.id,
    } satisfies ExtensionMessage)) as ExtensionMessage;

    if (response && response.type === 'popup-state') {
      state = {
        count: response.count,
        registry: response.registry,
        frameworks: response.frameworks,
      };
    } else {
      state = { count: 0, registry: [], frameworks: {} };
    }
  } catch {
    state = { count: 0, registry: [], frameworks: {} };
  }

  app.innerHTML = renderMain(state.count, state.registry, state.frameworks, url);
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderMain(
  count: number,
  registry: string[],
  frameworks: Record<string, number>,
  url: string,
): string {
  const domain = extractDomain(url);
  const fwEntries = Object.entries(frameworks).filter(([, n]) => n > 0);
  const MAX_TAGS = 8;

  return `
    <div class="popup-header">
      <span class="popup-logo">⬡ WC DevTools</span>
      ${domain ? `<span class="popup-url" title="${esc(url)}">${esc(domain)}</span>` : ''}
    </div>

    <div class="count-section">
      <div class="count-row">
        <span class="count-number${count === 0 ? ' is-zero' : ''}">${count}</span>
        <span class="count-label">Web Component${count !== 1 ? 's' : ''}</span>
      </div>
      <div class="count-sublabel">
        ${
          count === 0
            ? 'Open DevTools panel to start inspection'
            : `${registry.length} element type${registry.length !== 1 ? 's' : ''} defined`
        }
      </div>
    </div>

    ${
      fwEntries.length > 0
        ? `
    <div class="frameworks">
      ${fwEntries
        .map(
          ([fw, n]) => `
        <span class="fw-chip fw-${esc(fw)}">
          ${esc(FRAMEWORK_LABELS[fw] ?? fw)}
          <span class="fw-chip-count">${n}</span>
        </span>
      `,
        )
        .join('')}
    </div>
    `
        : ''
    }

    ${
      registry.length > 0
        ? `
    <div class="defined-section">
      <div class="section-label">Defined elements</div>
      <div class="defined-tags">
        ${registry
          .slice(0, MAX_TAGS)
          .map((t) => `<span class="defined-tag">&lt;${esc(t)}&gt;</span>`)
          .join('')}
        ${registry.length > MAX_TAGS ? `<span class="defined-more">+${registry.length - MAX_TAGS} more</span>` : ''}
      </div>
    </div>
    `
        : ''
    }

    <div class="hint-section">
      <p class="hint-text">
        ${
          count > 0
            ? `<strong>Inspecting:</strong> open <kbd>F12</kbd> → <strong>Web Components</strong> tab to select, highlight, and edit props live.`
            : `<strong>To inspect:</strong> open <kbd>F12</kbd> → <strong>Web Components</strong> tab. The inspector will activate automatically.`
        }
      </p>
    </div>
  `;
}

function renderPrivileged(url: string): string {
  return `
    <div class="popup-header">
      <span class="popup-logo">⬡ WC DevTools</span>
    </div>
    <div class="error-section">
      <p class="error-text">Cannot inspect this page.<br/>Browser pages (${esc(extractDomain(url) || url)}) are not accessible.</p>
    </div>
  `;
}

function renderError(msg: string): string {
  return `
    <div class="popup-header">
      <span class="popup-logo">⬡ WC DevTools</span>
    </div>
    <div class="error-section">
      <p class="error-text">${esc(msg)}</p>
    </div>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

init().catch(console.error);
