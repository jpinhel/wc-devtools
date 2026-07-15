import { beforeEach, describe, expect, it } from 'vitest';
import '../../entrypoints/panel/components/tabs/wc-tab-slots';
import type { WcTabSlots } from '../../entrypoints/panel/components/tabs/wc-tab-slots';
import type { WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

const node = (slots: WCNode['slots']): WCNode =>
  ({
    id: '1',
    tagName: 't',
    framework: 'lit',
    attributes: {},
    properties: {},
    methods: [],
    children: [],
    slots,
  }) as unknown as WCNode;

describe('<wc-tab-slots>', () => {
  beforeEach(cleanup);

  it('renders empty-state when no slots', async () => {
    const el = await renderLit<WcTabSlots>('wc-tab-slots', { node: node(undefined) });
    expect(el.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders default-slot label and assigned tags', async () => {
    const el = await renderLit<WcTabSlots>('wc-tab-slots', {
      node: node([
        {
          name: '',
          assignedNodes: ['span', 'div'],
          fallbackNodes: [],
          slottedRuleCount: 2,
        },
      ]),
    });
    expect(el.querySelector('.slot-name')?.textContent).toBe('(default)');
    expect(el.querySelectorAll('.slot-tag')).toHaveLength(2);
    expect(el.querySelector('.slot-rules')?.textContent).toContain('2 ::slotted');
  });

  it('renders fallback tags when assigned is empty', async () => {
    const el = await renderLit<WcTabSlots>('wc-tab-slots', {
      node: node([
        {
          name: 'header',
          assignedNodes: [],
          fallbackNodes: ['p'],
          slottedRuleCount: 0,
        },
      ]),
    });
    expect(el.querySelector('.slot-section--fallback')).not.toBeNull();
  });
});
