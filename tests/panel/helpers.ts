// tests/panel/helpers.ts
//
// Minimal helpers for testing Lit elements under vitest + jsdom.
// We render into light DOM so existing global selectors keep working.

import type { LitElement } from 'lit';

export async function renderLit<T extends LitElement>(
  tagName: string,
  props: Record<string, unknown> = {},
): Promise<T> {
  const el = document.createElement(tagName) as unknown as T;
  for (const [k, v] of Object.entries(props)) {
    (el as unknown as Record<string, unknown>)[k] = v;
  }
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

export function cleanup(): void {
  document.body.innerHTML = '';
}
