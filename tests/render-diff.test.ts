import { describe, expect, it } from 'vitest';
import { diffNodeProps } from '../lib/render-diff';
import type { WCNode } from '../types/wc';

function node(id: string, props: Record<string, unknown>): WCNode {
  return {
    id,
    tagName: 'x',
    attributes: {},
    properties: props as WCNode['properties'],
    shadowRoot: null,
    children: [],
    depth: 0,
    framework: 'vanilla',
    methods: [],
  };
}

describe('diffNodeProps', () => {
  it('returns {} when prev is null', () => {
    expect(diffNodeProps(null, node('a', { count: 1 }))).toEqual({});
  });

  it('returns {} when ids differ', () => {
    expect(diffNodeProps(node('a', { count: 1 }), node('b', { count: 2 }))).toEqual({});
  });

  it('reports added properties', () => {
    const prev = node('a', {});
    const curr = node('a', { count: 1 });
    expect(diffNodeProps(prev, curr)).toEqual({ count: { from: undefined, to: 1 } });
  });

  it('reports removed properties', () => {
    expect(diffNodeProps(node('a', { count: 1 }), node('a', {}))).toEqual({
      count: { from: 1, to: undefined },
    });
  });

  it('reports value changes', () => {
    expect(diffNodeProps(node('a', { count: 1 }), node('a', { count: 2 }))).toEqual({
      count: { from: 1, to: 2 },
    });
  });

  it('returns {} when nothing changed', () => {
    expect(diffNodeProps(node('a', { count: 1 }), node('a', { count: 1 }))).toEqual({});
  });

  it('handles structural object equality', () => {
    expect(diffNodeProps(node('a', { obj: { x: 1 } }), node('a', { obj: { x: 1 } }))).toEqual({});
  });
});
