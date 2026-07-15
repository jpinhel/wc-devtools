import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../entrypoints/panel/components/tabs/wc-tab-attrs';
import type { WcTabAttrs } from '../../entrypoints/panel/components/tabs/wc-tab-attrs';
import type { WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

const node = (attrs: Record<string, string>): WCNode =>
  ({
    id: '1',
    tagName: 't',
    framework: 'lit',
    attributes: attrs,
    properties: {},
    methods: [],
    children: [],
  }) as unknown as WCNode;

describe('<wc-tab-attrs>', () => {
  beforeEach(cleanup);

  it('renders one row per attribute', async () => {
    const el = await renderLit<WcTabAttrs>('wc-tab-attrs', {
      node: node({ class: 'foo', id: 'bar' }),
    });
    expect(el.querySelectorAll('.prop-row')).toHaveLength(2);
  });

  it('emits set-attr when the add button is clicked', async () => {
    const el = await renderLit<WcTabAttrs>('wc-tab-attrs', {
      node: node({}),
    });
    const handler = vi.fn();
    el.addEventListener('set-attr', handler as EventListener);
    const inputs = el.querySelectorAll<HTMLInputElement>('.attr-add-row .prop-edit-input');
    inputs[0].value = 'data-foo';
    inputs[0].dispatchEvent(new Event('input'));
    inputs[1].value = 'bar';
    inputs[1].dispatchEvent(new Event('input'));
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.attr-add-btn')?.click();
    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{
      nodeId: string;
      attrName: string;
      value: string;
    }>;
    expect(evt.detail).toEqual({ nodeId: '1', attrName: 'data-foo', value: 'bar' });
  });

  it('emits remove-attr when the remove button is clicked', async () => {
    const el = await renderLit<WcTabAttrs>('wc-tab-attrs', {
      node: node({ class: 'foo' }),
    });
    const handler = vi.fn();
    el.addEventListener('remove-attr', handler as EventListener);
    el.querySelector<HTMLButtonElement>('.attr-remove')?.click();
    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{ nodeId: string; attrName: string }>;
    expect(evt.detail).toEqual({ nodeId: '1', attrName: 'class' });
  });
});
