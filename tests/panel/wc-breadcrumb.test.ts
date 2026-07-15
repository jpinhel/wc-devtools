import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';
import '../../entrypoints/panel/components/wc-breadcrumb';
import type { WcBreadcrumb } from '../../entrypoints/panel/components/wc-breadcrumb';

const mkNode = (id: string, tag: string): WCNode =>
  ({
    id,
    tagName: tag,
    framework: 'lit',
    attributes: {},
    properties: {},
    methods: [],
    children: [],
  }) as unknown as WCNode;

describe('<wc-breadcrumb>', () => {
  beforeEach(cleanup);

  it('renders nothing when path is empty', async () => {
    const el = await renderLit<WcBreadcrumb>('wc-breadcrumb', { path: [] });
    expect(el.querySelector('.breadcrumb')).toBeNull();
  });

  it('renders one segment per node and a separator between segments', async () => {
    const el = await renderLit<WcBreadcrumb>('wc-breadcrumb', {
      path: [mkNode('1', 'app-root'), mkNode('2', 'my-button')],
    });
    const segs = el.querySelectorAll('.breadcrumb-segment');
    expect(segs).toHaveLength(2);
    expect(segs[0].textContent).toContain('app-root');
    expect(segs[1].textContent).toContain('my-button');
    expect(segs[1].classList.contains('breadcrumb-segment--last')).toBe(true);
    expect(el.querySelectorAll('.breadcrumb-sep')).toHaveLength(1);
  });

  it('marks only the selected segment active, none when selection is empty', async () => {
    const path = [mkNode('1', 'app-root'), mkNode('2', 'my-button')];
    const withSelection = await renderLit<WcBreadcrumb>('wc-breadcrumb', {
      path,
      selectedId: '1',
    });
    const segs = withSelection.querySelectorAll('.breadcrumb-segment');
    expect(segs[0].classList.contains('breadcrumb-segment--active')).toBe(true);
    expect(segs[1].classList.contains('breadcrumb-segment--active')).toBe(false);

    cleanup();
    const noSelection = await renderLit<WcBreadcrumb>('wc-breadcrumb', {
      path,
      selectedId: null,
    });
    expect(noSelection.querySelector('.breadcrumb-segment--active')).toBeNull();
  });

  it('emits a `breadcrumb-select` CustomEvent with the clicked node id', async () => {
    const el = await renderLit<WcBreadcrumb>('wc-breadcrumb', {
      path: [mkNode('abc', 'app-root')],
    });
    const handler = vi.fn();
    el.addEventListener('breadcrumb-select', handler as EventListener);
    el.querySelector<HTMLButtonElement>('.breadcrumb-segment')?.click();
    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{ nodeId: string }>;
    expect(evt.detail.nodeId).toBe('abc');
  });
});
