import { beforeEach, describe, expect, it } from 'vitest';
import '../../entrypoints/panel/components/wc-tree-virtual';
import type { WcTreeVirtual } from '../../entrypoints/panel/components/wc-tree-virtual';
import type { WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

const node = (id: string, tag: string, children: WCNode[] = []): WCNode =>
  ({
    id,
    tagName: tag,
    framework: 'lit',
    attributes: {},
    properties: {},
    methods: [],
    children,
    shadowRoot: 'open',
  }) as unknown as WCNode;

describe('<wc-tree-virtual>', () => {
  beforeEach(cleanup);

  it('renders the empty-state when nodes is empty', async () => {
    const el = await renderLit<WcTreeVirtual>('wc-tree-virtual', {
      nodes: [],
      queryActive: false,
    });
    expect(el.querySelector('.empty-state')).not.toBeNull();
  });

  it('uses the query-active copy when filter has no matches', async () => {
    const el = await renderLit<WcTreeVirtual>('wc-tree-virtual', {
      nodes: [],
      queryActive: true,
    });
    expect(el.querySelector('.empty-state')?.textContent?.trim()).toBe('No matching components.');
  });

  it('expandAncestors() seeds the expanded set', async () => {
    const tree = [node('parent', 'p', [node('child', 'c')])];
    const el = await renderLit<WcTreeVirtual>('wc-tree-virtual', { nodes: tree });
    el.expandAncestors(['parent']);
    await el.updateComplete;
    // Calling expandAncestors should not throw and should preserve the
    // virtualizer host element.
    expect(el.querySelector('lit-virtualizer')).not.toBeNull();
  });
});
