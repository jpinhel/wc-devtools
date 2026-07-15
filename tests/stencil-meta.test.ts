import { describe, expect, it } from 'vitest';
import { extractStencilPropMeta } from '../lib/stencil-meta';

describe('extractStencilPropMeta', () => {
  it('marks @State as kind: state', () => {
    const meta = extractStencilPropMeta({
      cmpMeta$: { $members$: { count: [1 << 6, undefined] } },
    });
    expect(meta.count.kind).toBe('state');
    expect(meta.count.reflects).toBe(false);
  });

  it('marks @Prop without reflect as kind: prop, reflects: false', () => {
    const meta = extractStencilPropMeta({
      cmpMeta$: { $members$: { name: [1 << 0, 'name'] } },
    });
    expect(meta.name.kind).toBe('prop');
    expect(meta.name.reflects).toBe(false);
  });

  it('marks @Prop with reflect as kind: prop, reflects: true', () => {
    const meta = extractStencilPropMeta({
      cmpMeta$: { $members$: { name: [(1 << 0) | (1 << 15), 'name'] } },
    });
    expect(meta.name.kind).toBe('prop');
    expect(meta.name.reflects).toBe(true);
  });

  it('skips methods + events + element refs', () => {
    const meta = extractStencilPropMeta({
      cmpMeta$: {
        $members$: {
          doStuff: [1 << 7, undefined],
          myEvent: [1 << 9, undefined],
          el: [1 << 8, undefined],
        },
      },
    });
    expect(Object.keys(meta)).toHaveLength(0);
  });

  it('returns empty when cmpMeta$ missing', () => {
    expect(Object.keys(extractStencilPropMeta({}))).toHaveLength(0);
    expect(Object.keys(extractStencilPropMeta(null))).toHaveLength(0);
    expect(Object.keys(extractStencilPropMeta('string'))).toHaveLength(0);
  });

  it('handles a mix of all kinds in one component', () => {
    const meta = extractStencilPropMeta({
      cmpMeta$: {
        $members$: {
          publicProp: [1 << 0, 'public-prop'],
          internalState: [1 << 6, undefined],
          method: [1 << 7, undefined],
          reflectingProp: [(1 << 0) | (1 << 15), 'reflecting-prop'],
        },
      },
    });
    expect(Object.keys(meta).sort()).toEqual(['internalState', 'publicProp', 'reflectingProp']);
    expect(meta.publicProp.kind).toBe('prop');
    expect(meta.publicProp.reflects).toBe(false);
    expect(meta.internalState.kind).toBe('state');
    expect(meta.reflectingProp.reflects).toBe(true);
  });
});
