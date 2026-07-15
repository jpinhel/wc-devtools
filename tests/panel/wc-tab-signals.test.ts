import { beforeEach, describe, expect, it } from 'vitest';
import '../../entrypoints/panel/components/tabs/wc-tab-signals';
import type { WcTabSignals } from '../../entrypoints/panel/components/tabs/wc-tab-signals';
import type { WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

const node = (overrides: Partial<WCNode>): WCNode =>
  ({
    id: '1',
    tagName: 't',
    framework: 'lit',
    attributes: {},
    properties: {},
    methods: [],
    children: [],
    ...overrides,
  }) as unknown as WCNode;

describe('<wc-tab-signals>', () => {
  beforeEach(cleanup);

  it('renders empty-state when no signals/context/tasks', async () => {
    const el = await renderLit<WcTabSignals>('wc-tab-signals', { node: node({}) });
    expect(el.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders signals section when signals present', async () => {
    const el = await renderLit<WcTabSignals>('wc-tab-signals', {
      node: node({ signals: [{ label: 'count', value: 1 }] }),
    });
    expect(el.querySelector('.signals-heading')?.textContent).toBe('Signals');
    expect(el.querySelector('.signal-label')?.textContent).toBe('count');
  });

  it('renders task error message when status is error', async () => {
    const el = await renderLit<WcTabSignals>('wc-tab-signals', {
      node: node({
        tasks: [{ label: 'fetch', status: 'error', error: 'oops' }],
      }),
    });
    expect(el.querySelector('.task-error')?.textContent?.trim()).toBe('oops');
  });
});
