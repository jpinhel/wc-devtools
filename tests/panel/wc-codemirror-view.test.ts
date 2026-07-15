import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../entrypoints/panel/components/wc-codemirror-view';
import type { WcCodemirrorView } from '../../entrypoints/panel/components/wc-codemirror-view';
import { cleanup, renderLit } from './helpers';

describe('<wc-codemirror-view>', () => {
  beforeEach(cleanup);

  it('renders the host div', async () => {
    const el = await renderLit<WcCodemirrorView>('wc-codemirror-view', {
      value: '{}',
      language: 'json',
    });
    expect(el.querySelector('.cm-host')).not.toBeNull();
  });

  it('mounts a CodeMirror EditorView with the initial doc', async () => {
    const el = await renderLit<WcCodemirrorView>('wc-codemirror-view', {
      value: 'body { color: red; }',
      language: 'css',
      readonly: true,
    });
    // Wait for the async dynamic-import editor mount to complete.
    await new Promise((r) => setTimeout(r, 100));
    expect(el.querySelector('.cm-editor')).not.toBeNull();
    expect(el.textContent).toContain('color');
  });

  it('does not emit `update` when the doc is replaced via prop change (programmatic update)', async () => {
    const el = await renderLit<WcCodemirrorView>('wc-codemirror-view', {
      value: '{}',
      language: 'json',
    });
    await new Promise((r) => setTimeout(r, 100));
    const handler = vi.fn();
    el.addEventListener('update', handler as EventListener);
    el.value = '{"a":1}';
    // Wait one tick — Lit will run willUpdate, the component should propagate to CM via dispatch.
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 50));
    // The CM updateListener WILL fire on programmatic dispatch — but the implementer should
    // distinguish user edits from programmatic ones. If it does, handler stays at 0.
    // If your implementation can't easily filter, it is acceptable to fire — note as a concern
    // and skip this test (mark it `it.skip(...)`).
    expect(handler).toHaveBeenCalledTimes(0);
  });
});
