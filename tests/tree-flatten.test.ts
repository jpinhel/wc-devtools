import { describe, expect, it } from 'vitest';
import { flattenTree } from '../lib/tree-flatten';
import type { WCNode } from '../types/wc';

function n(id: string, overrides: Partial<WCNode> = {}): WCNode {
  return {
    id,
    tagName: 'x-x',
    attributes: {},
    properties: {},
    shadowRoot: null,
    children: [],
    depth: 0,
    framework: 'vanilla',
    methods: [],
    ...overrides,
  };
}

describe('flattenTree', () => {
  it('returns one row per root when no children', () => {
    const out = flattenTree([n('a'), n('b')], new Set(['a', 'b']));
    expect(out.map((r) => r.node.id)).toEqual(['a', 'b']);
    expect(out.map((r) => r.depth)).toEqual([0, 0]);
  });

  it('recurses light DOM children when expanded', () => {
    const tree = [n('a', { children: [n('b'), n('c')] })];
    const out = flattenTree(tree, new Set(['a']));
    expect(out.map((r) => r.node.id)).toEqual(['a', 'b', 'c']);
    expect(out.map((r) => r.depth)).toEqual([0, 1, 1]);
  });

  it('skips children when parent is collapsed', () => {
    const tree = [n('a', { children: [n('b')] })];
    expect(flattenTree(tree, new Set()).map((r) => r.node.id)).toEqual(['a']);
  });

  it('emits a synthetic shadow-root header before shadow children', () => {
    const tree = [n('a', { shadowRoot: [n('s')] })];
    const out = flattenTree(tree, new Set(['a']));
    expect(out.map((r) => r.kind)).toEqual(['node', 'shadow-header', 'node']);
    expect(out[1].depth).toBe(1);
    expect(out[2].node.id).toBe('s');
  });

  it('marks rows with hasChildren so the chevron knows when to render', () => {
    const tree = [n('a', { children: [n('b')] }), n('c')];
    const out = flattenTree(tree, new Set(['a']));
    expect(out[0].hasChildren).toBe(true);
    expect(out[2].hasChildren).toBe(false);
  });

  it('emits "+N hidden" rows for capped children and shadow lists', () => {
    const tree = [
      n('a', {
        children: [n('b')],
        droppedChildren: 3,
        shadowRoot: [n('s')],
        droppedShadow: 2,
      }),
    ];
    const out = flattenTree(tree, new Set(['a']));
    expect(out.map((r) => r.kind)).toEqual([
      'node', // a
      'shadow-header',
      'node', // s
      'hidden', // +2 (shadow)
      'node', // b
      'hidden', // +3 (children)
    ]);
    expect(out[3].hiddenCount).toBe(2);
    expect(out[5].hiddenCount).toBe(3);
    expect(out[5].key).toBe('a#hidden');
  });

  it('emits no hidden rows when nothing was dropped', () => {
    const out = flattenTree([n('a', { children: [n('b')] })], new Set(['a']));
    expect(out.every((r) => r.kind !== 'hidden')).toBe(true);
  });
});
