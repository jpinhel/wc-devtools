import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../entrypoints/panel/components/tabs/wc-tab-styles';
import type { WcTabStyles } from '../../entrypoints/panel/components/tabs/wc-tab-styles';
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

describe('<wc-tab-styles>', () => {
  beforeEach(cleanup);

  it('shows three section headings', async () => {
    const el = await renderLit<WcTabStyles>('wc-tab-styles', { node: node({}) });
    const headings = el.querySelectorAll('.styles-heading');
    expect(headings).toHaveLength(3);
  });

  it('renders one .part-row per part', async () => {
    const el = await renderLit<WcTabStyles>('wc-tab-styles', {
      node: node({
        parts: [
          { name: 'icon', elementTag: 'span', ruleCount: 2 },
          { name: 'label', elementTag: 'span', ruleCount: 0 },
        ],
      }),
    });
    expect(el.querySelectorAll('.part-row')).toHaveLength(2);
    expect(el.querySelector('.part-rules--zero')).not.toBeNull();
  });

  it('renders cssVars as a table when present', async () => {
    const el = await renderLit<WcTabStyles>('wc-tab-styles', {
      node: node({
        cssVars: [
          { name: '--color', computedValue: 'red', declaredOnHost: true },
          { name: '--size', computedValue: '12px', declaredOnHost: false },
        ],
      }),
    });
    expect(el.querySelectorAll('.prop-row')).toHaveLength(2);
    expect(el.querySelector('.prop-row--origin-host')).not.toBeNull();
    expect(el.querySelector('.prop-row--origin-inherited')).not.toBeNull();
    expect(el.querySelector('.prop-row--origin-host')?.getAttribute('title')).toContain('host');
    expect(el.querySelector('.prop-row--origin-inherited')?.getAttribute('title')).toContain(
      'inherited',
    );
  });

  it('commits a css-var edit on Enter with a single set-css-var event', async () => {
    const el = await renderLit<WcTabStyles>('wc-tab-styles', {
      node: node({
        cssVars: [{ name: '--color', computedValue: 'red', declaredOnHost: true }],
      }),
    });
    const handler = vi.fn();
    el.addEventListener('set-css-var', handler as EventListener);

    el.querySelector<HTMLElement>('.prop-val--editable')?.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>('.cssvar-edit-input');
    if (!input) throw new Error('edit input missing');
    expect(input.value).toBe('red');

    input.value = 'blue';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new Event('blur')); // re-render blur must not double-commit
    await el.updateComplete;

    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{
      nodeId: string;
      name: string;
      value: string | null;
    }>;
    expect(evt.detail).toEqual({ nodeId: '1', name: '--color', value: 'blue' });
  });

  it('sends null to clear the override when the input is emptied', async () => {
    const el = await renderLit<WcTabStyles>('wc-tab-styles', {
      node: node({
        cssVars: [{ name: '--color', computedValue: 'red', declaredOnHost: true }],
      }),
    });
    const handler = vi.fn();
    el.addEventListener('set-css-var', handler as EventListener);

    el.querySelector<HTMLElement>('.prop-val--editable')?.click();
    await el.updateComplete;
    const input = el.querySelector<HTMLInputElement>('.cssvar-edit-input');
    if (!input) throw new Error('edit input missing');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{ value: string | null }>;
    expect(evt.detail.value).toBeNull();
  });

  it('renders a swatch only for pure color values', async () => {
    const el = await renderLit<WcTabStyles>('wc-tab-styles', {
      node: node({
        cssVars: [
          { name: '--ok', computedValue: 'rgb(0, 0, 0)', declaredOnHost: true },
          {
            name: '--evil',
            computedValue: 'rgb(0,0,0) url(https://evil.example/ping)',
            declaredOnHost: true,
          },
        ],
      }),
    });
    expect(el.querySelectorAll('.css-swatch')).toHaveLength(1);
  });
});
