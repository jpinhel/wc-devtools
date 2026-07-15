import { describe, expect, it } from 'vitest';
import { createProfilingState, framesInWindow, recordPatches } from '../lib/profiling';
import type { TreePatch } from '../types/wc';

const updateA: TreePatch = { op: 'update', id: 'a', fields: { properties: { x: 1 } } };
const updateB: TreePatch = { op: 'update', id: 'b', fields: { properties: { y: 2 } } };

describe('recordPatches', () => {
  it('aggregates updates per frame', () => {
    let s = createProfilingState();
    s = recordPatches(s, [updateA, updateA, updateB], 1000);
    expect(s.frames[0].counts.get('a')).toBe(2);
    expect(s.frames[0].counts.get('b')).toBe(1);
  });

  it('records frames with timestamps', () => {
    let s = createProfilingState();
    s = recordPatches(s, [updateA], 1000);
    s = recordPatches(s, [updateA, updateB], 1500);
    expect(s.frames).toHaveLength(2);
    expect(s.frames[0]).toEqual({ at: 1000, counts: new Map([['a', 1]]) });
  });

  it('keeps frames bounded to MAX_FRAMES', () => {
    let s = createProfilingState();
    for (let i = 0; i < 600; i++) {
      s = recordPatches(s, [updateA], i);
    }
    expect(s.frames.length).toBeLessThanOrEqual(500);
  });

  it('returns the same state reference when no update patches', () => {
    const s = createProfilingState();
    expect(recordPatches(s, [], 1000)).toBe(s);
  });
});

describe('framesInWindow', () => {
  it('returns frames whose timestamps fall inside [now - windowMs, now]', () => {
    let s = createProfilingState();
    s = recordPatches(s, [updateA], 1000);
    s = recordPatches(s, [updateA], 4000);
    s = recordPatches(s, [updateA], 9000);
    expect(framesInWindow(s, 10_000, 5000)).toHaveLength(2);
  });
});
