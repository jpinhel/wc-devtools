import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../entrypoints/panel/components/wc-inspector';
import type { WcInspector } from '../../entrypoints/panel/components/wc-inspector';
import type { WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

const mkNode = (overrides: Partial<WCNode> = {}): WCNode =>
  ({
    id: '1',
    tagName: 'my-comp',
    framework: 'lit',
    attributes: {},
    properties: {},
    methods: [],
    children: [],
    ...overrides,
  }) as unknown as WCNode;

describe('<wc-inspector>', () => {
  beforeEach(cleanup);

  it('renders the empty-state when node is null', async () => {
    const el = await renderLit<WcInspector>('wc-inspector', { node: null });
    expect(el.querySelector('.empty-state')?.textContent).toContain('Select a component');
  });

  it('explains when the selected component was removed from the page', async () => {
    const el = await renderLit<WcInspector>('wc-inspector', {
      node: null,
      removedTag: 'sl-alert',
    });
    const empty = el.querySelector('.empty-state');
    expect(empty?.textContent).toContain('sl-alert');
    expect(empty?.textContent).toContain('removed from the page');
  });

  it('renders the framework badge and tag name in the header for Lit', async () => {
    const el = await renderLit<WcInspector>('wc-inspector', { node: mkNode() });
    expect(el.querySelector('.tag--large')?.textContent).toContain('my-comp');
    expect(el.querySelector('.fw-badge')?.textContent).toContain('Lit');
  });

  it('hides the framework badge for non-Lit components (detection unreliable)', async () => {
    const el = await renderLit<WcInspector>('wc-inspector', {
      node: mkNode({ framework: 'stencil' } as Partial<WCNode>),
    });
    expect(el.querySelector('.fw-badge')).toBeNull();
  });

  it('shows the #shadow badge when shadowRoot is open', async () => {
    const el = await renderLit<WcInspector>('wc-inspector', {
      node: mkNode({ shadowRoot: [] } as Partial<WCNode>),
    });
    expect(el.querySelector('.shadow-badge')?.textContent).toContain('#shadow');
  });

  it('shows the #closed badge when shadowRoot is closed', async () => {
    const el = await renderLit<WcInspector>('wc-inspector', {
      node: mkNode({ shadowRoot: 'closed' } as Partial<WCNode>),
    });
    expect(el.querySelector('.shadow-badge.closed')?.textContent).toContain('#closed');
  });

  it('shows the source button only when sourceRef is present, and emits open-source', async () => {
    const noRef = await renderLit<WcInspector>('wc-inspector', { node: mkNode() });
    expect(noRef.querySelector('[title^="Open source"]')).toBeNull();

    cleanup();
    const sourceRef = { url: 'https://app.example.com/my-comp.js', line: 12, column: 3 };
    const el = await renderLit<WcInspector>('wc-inspector', {
      node: mkNode({ sourceRef } as Partial<WCNode>),
    });
    const btn = el.querySelector<HTMLButtonElement>('[title^="Open source"]');
    expect(btn).not.toBeNull();
    const handler = vi.fn();
    el.addEventListener('open-source', handler as EventListener);
    btn?.click();
    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{ sourceRef: unknown }>;
    expect(evt.detail.sourceRef).toEqual(sourceRef);
  });

  it('shows SSR badge when stencilHydration is ssr-only', async () => {
    const el = await renderLit<WcInspector>('wc-inspector', {
      node: mkNode({ stencilHydration: 'ssr-only' } as Partial<WCNode>),
    });
    expect(el.querySelector('.hydration-badge--ssr')).not.toBeNull();
  });

  it('hides the CEM tab when no cem is set', async () => {
    const el = await renderLit<WcInspector>('wc-inspector', { node: mkNode() });
    const tabTexts = Array.from(el.querySelectorAll('.tab')).map((t) => t.textContent);
    expect(tabTexts.some((t) => t?.includes('CEM'))).toBe(false);
  });

  it('forwards `set-prop` from the props tab when a boolean is toggled', async () => {
    const el = await renderLit<WcInspector>('wc-inspector', {
      node: mkNode({ properties: { flag: true } }),
    });
    const handler = vi.fn();
    el.addEventListener('set-prop', handler as EventListener);
    el.querySelector<HTMLButtonElement>('wc-tab-props .pv-edit-btn')?.click();
    expect(handler).toHaveBeenCalled();
  });
});
