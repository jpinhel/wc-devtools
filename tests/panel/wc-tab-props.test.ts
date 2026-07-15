import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../entrypoints/panel/components/tabs/wc-tab-props';
import type { WcTabProps } from '../../entrypoints/panel/components/tabs/wc-tab-props';
import type { SerializableValue, WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

const node = (props: Record<string, SerializableValue>): WCNode =>
  ({
    id: '1',
    tagName: 't',
    framework: 'lit',
    attributes: {},
    properties: props,
    methods: [],
    children: [],
  }) as unknown as WCNode;

describe('<wc-tab-props>', () => {
  beforeEach(cleanup);

  it('shows empty-state when no properties', async () => {
    const el = await renderLit<WcTabProps>('wc-tab-props', { node: node({}) });
    expect(el.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders one row per property', async () => {
    const el = await renderLit<WcTabProps>('wc-tab-props', {
      node: node({ count: 1, label: 'foo' }),
    });
    expect(el.querySelectorAll('.prop-row')).toHaveLength(2);
  });

  it('commits a string prop edit on Enter with exactly one set-prop event', async () => {
    const el = await renderLit<WcTabProps>('wc-tab-props', {
      node: node({ variant: 'neutral' }),
    });
    const handler = vi.fn();
    el.addEventListener('set-prop', handler as EventListener);

    // Open the editor via the pencil button (same as the user flow)
    el.querySelector<HTMLButtonElement>('.pv-edit-btn')?.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>('.prop-edit-input');
    expect(input).not.toBeNull();
    if (!input) return;
    expect(input.value).toBe('neutral');

    input.value = 'danger';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{
      nodeId: string;
      propName: string;
      value: SerializableValue;
    }>;
    expect(evt.detail).toEqual({ nodeId: '1', propName: 'variant', value: 'danger' });
  });

  it('ignores the blur fired by the re-render after an Enter commit (no "" overwrite)', async () => {
    const el = await renderLit<WcTabProps>('wc-tab-props', {
      node: node({ variant: 'neutral' }),
    });
    const handler = vi.fn();
    el.addEventListener('set-prop', handler as EventListener);

    el.querySelector<HTMLButtonElement>('.pv-edit-btn')?.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>('.prop-edit-input');
    if (!input) throw new Error('edit input missing');
    input.value = 'danger';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Chrome fires blur when the focused input is removed by the re-render —
    // jsdom doesn't, so simulate it. Without the commitEdit guard this would
    // emit a second set-prop with the cleared editValue ('').
    input.dispatchEvent(new Event('blur'));
    await el.updateComplete;

    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{ value: SerializableValue }>;
    expect(evt.detail.value).toBe('danger');
  });

  it('toggles a boolean prop on click without entering edit mode', async () => {
    const el = await renderLit<WcTabProps>('wc-tab-props', {
      node: node({ flag: true }),
    });
    const handler = vi.fn();
    el.addEventListener('set-prop', handler as EventListener);
    el.querySelector<HTMLButtonElement>('.pv-edit-btn')?.click();
    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{
      nodeId: string;
      propName: string;
      value: SerializableValue;
    }>;
    expect(evt.detail).toEqual({ nodeId: '1', propName: 'flag', value: false });
  });
});
