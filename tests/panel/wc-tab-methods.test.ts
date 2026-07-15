import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../entrypoints/panel/components/tabs/wc-tab-methods';
import type { WcTabMethods } from '../../entrypoints/panel/components/tabs/wc-tab-methods';
import type { WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

const node = (methods: string[]): WCNode =>
  ({
    id: '1',
    tagName: 't',
    framework: 'lit',
    attributes: {},
    properties: {},
    methods,
    children: [],
  }) as unknown as WCNode;

describe('<wc-tab-methods>', () => {
  beforeEach(cleanup);

  it('renders empty-state with no methods', async () => {
    const el = await renderLit<WcTabMethods>('wc-tab-methods', { node: node([]) });
    expect(el.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders one row per method', async () => {
    const el = await renderLit<WcTabMethods>('wc-tab-methods', {
      node: node(['foo', 'bar']),
    });
    expect(el.querySelectorAll('.method-row')).toHaveLength(2);
  });

  it('runs directly with no args via the play button (no editor open)', async () => {
    const el = await renderLit<WcTabMethods>('wc-tab-methods', { node: node(['foo']) });
    const handler = vi.fn();
    el.addEventListener('invoke-method', handler as EventListener);

    expect(el.querySelector('.method-args-input')).toBeNull(); // compact by default
    el.querySelector<HTMLButtonElement>('.method-run-btn')?.click();

    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{ args: unknown[] }>;
    expect(evt.detail.args).toEqual([]);
  });

  it('opens the args editor on name click and emits parsed JSON args on Enter', async () => {
    const el = await renderLit<WcTabMethods>('wc-tab-methods', { node: node(['foo']) });
    const handler = vi.fn();
    el.addEventListener('invoke-method', handler as EventListener);

    el.querySelector<HTMLElement>('.method-name--clickable')?.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>('.method-args-input');
    if (!input) throw new Error('args input missing after opening the editor');
    input.value = '1, "two"';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{
      nodeId: string;
      methodName: string;
      args: unknown[];
    }>;
    expect(evt.detail).toEqual({ nodeId: '1', methodName: 'foo', args: [1, 'two'] });
    expect(el.querySelector('.method-args-input')).toBeNull(); // editor closed after run
  });

  it('shows a parse error instead of emitting when args are invalid JSON', async () => {
    const el = await renderLit<WcTabMethods>('wc-tab-methods', { node: node(['foo']) });
    const handler = vi.fn();
    el.addEventListener('invoke-method', handler as EventListener);

    el.querySelector<HTMLElement>('.method-name--clickable')?.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>('.method-args-input');
    if (!input) throw new Error('args input missing after opening the editor');
    input.value = '{broken';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('.method-run-btn')?.click();
    await el.updateComplete;

    expect(handler).not.toHaveBeenCalled();
    expect(el.querySelector('.method-result--error')).not.toBeNull();
  });

  it('renders the invoke result for the matching method', async () => {
    const el = await renderLit<WcTabMethods>('wc-tab-methods', {
      node: node(['foo', 'bar']),
      lastResult: { methodName: 'foo', success: true, result: 42 },
    });
    const results = el.querySelectorAll('.method-result');
    expect(results).toHaveLength(1);
    expect(results[0].textContent).toContain('42');
  });
});
