import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../entrypoints/panel/components/wc-profiling-panel';
import type { WcProfilingPanel } from '../../entrypoints/panel/components/wc-profiling-panel';
import { createProfilingState, recordPatches } from '../../lib/profiling';
import type { TreePatch, WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

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

describe('<wc-profiling-panel>', () => {
  beforeEach(cleanup);

  it('renders the empty-state when no re-renders are captured', async () => {
    const el = await renderLit<WcProfilingPanel>('wc-profiling-panel', {
      state: createProfilingState(),
      tree: [],
    });
    expect(el.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders one row per node with re-renders, sorted by count desc', async () => {
    const now = Date.now();
    const patches: TreePatch[] = [
      { op: 'update', id: 'a', fields: {} },
      { op: 'update', id: 'a', fields: {} },
      { op: 'update', id: 'b', fields: {} },
    ];
    const state = recordPatches(createProfilingState(), patches, now);
    const el = await renderLit<WcProfilingPanel>('wc-profiling-panel', {
      state,
      tree: [mkNode('a', 'comp-a'), mkNode('b', 'comp-b')],
    });
    const rows = el.querySelectorAll('.profiling-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('comp-a');
    expect(rows[1].textContent).toContain('comp-b');
  });

  it('emits a `select` CustomEvent with the clicked row id', async () => {
    const now = Date.now();
    const patches: TreePatch[] = [{ op: 'update', id: 'a', fields: {} }];
    const state = recordPatches(createProfilingState(), patches, now);
    const el = await renderLit<WcProfilingPanel>('wc-profiling-panel', {
      state,
      tree: [mkNode('a', 'comp-a')],
    });
    const handler = vi.fn();
    el.addEventListener('select', handler as EventListener);
    el.querySelector<HTMLButtonElement>('.profiling-row')?.click();
    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{ id: string }>;
    expect(evt.detail.id).toBe('a');
  });
});
