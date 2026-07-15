import { describe, expect, it } from 'vitest';
import { applyPatches, diffTree } from '../lib/tree-diff';
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

describe('diffTree', () => {
  it('returns no patches for two empty trees', () => {
    expect(diffTree([], [])).toEqual([]);
  });
});

describe('diffTree — single root added', () => {
  it('emits one add patch with index 0', () => {
    const patches = diffTree([], [n('a')]);
    expect(patches).toEqual([
      { op: 'add', parentId: null, location: 'root', index: 0, node: n('a') },
    ]);
  });
});

describe('diffTree — root removed', () => {
  it('emits one remove patch', () => {
    expect(diffTree([n('a')], [])).toEqual([{ op: 'remove', id: 'a' }]);
  });
});

describe('diffTree — property update', () => {
  it('emits update with only changed fields', () => {
    const prev = [n('a', { properties: { count: 1 } })];
    const curr = [n('a', { properties: { count: 2 } })];
    expect(diffTree(prev, curr)).toEqual([
      { op: 'update', id: 'a', fields: { properties: { count: 2 } } },
    ]);
  });

  it('omits unchanged fields', () => {
    const prev = [n('a', { tagName: 'x-x', attributes: { a: '1' } })];
    const curr = [n('a', { tagName: 'x-x', attributes: { a: '1' } })];
    expect(diffTree(prev, curr)).toEqual([]);
  });
});

describe('diffTree — child added inside light DOM', () => {
  it('emits add patch with parentId + location children', () => {
    const prev = [n('a')];
    const curr = [n('a', { children: [n('b', { depth: 1 })] })];
    expect(diffTree(prev, curr)).toEqual([
      { op: 'add', parentId: 'a', location: 'children', index: 0, node: n('b', { depth: 1 }) },
    ]);
  });
});

describe('diffTree — set-shadow when shadow type changes', () => {
  it('emits set-shadow when shadow flips from null to closed', () => {
    const prev = [n('a', { shadowRoot: null })];
    const curr = [n('a', { shadowRoot: 'closed' })];
    expect(diffTree(prev, curr)).toEqual([{ op: 'set-shadow', id: 'a', shadowRoot: 'closed' }]);
  });

  it('emits set-shadow when shadow array becomes null', () => {
    const prev = [n('a', { shadowRoot: [n('b', { depth: 1 })] })];
    const curr = [n('a', { shadowRoot: null })];
    expect(diffTree(prev, curr)).toEqual([{ op: 'set-shadow', id: 'a', shadowRoot: null }]);
  });
});

describe('diffTree — move between parents', () => {
  it('emits remove + add when a node moves to a different parent', () => {
    const prev = [n('p1', { children: [n('m', { depth: 1 })] }), n('p2')];
    const curr = [n('p1'), n('p2', { children: [n('m', { depth: 1 })] })];
    const patches = diffTree(prev, curr);
    expect(patches).toContainEqual({ op: 'remove', id: 'm' });
    expect(patches).toContainEqual({
      op: 'add',
      parentId: 'p2',
      location: 'children',
      index: 0,
      node: n('m', { depth: 1 }),
    });
  });
});

describe('applyPatches — round-trip with diffTree', () => {
  it('reconstructs curr from prev + diffTree(prev, curr)', () => {
    const prev = [n('a', { children: [n('b', { depth: 1 })] })];
    const curr = [
      n('a', {
        properties: { v: 1 },
        children: [n('b', { depth: 1, properties: { x: 'y' } }), n('c', { depth: 1 })],
      }),
    ];
    const patches = diffTree(prev, curr);
    expect(applyPatches(prev, patches)).toEqual(curr);
  });

  it('round-trips remove of a deep node', () => {
    const prev = [n('a', { children: [n('b', { depth: 1, children: [n('c', { depth: 2 })] })] })];
    const curr = [n('a', { children: [n('b', { depth: 1 })] })];
    expect(applyPatches(prev, diffTree(prev, curr))).toEqual(curr);
  });
});
