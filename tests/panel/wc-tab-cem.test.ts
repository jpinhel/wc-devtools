import { beforeEach, describe, expect, it } from 'vitest';
import '../../entrypoints/panel/components/tabs/wc-tab-cem';
import type { WcTabCem } from '../../entrypoints/panel/components/tabs/wc-tab-cem';
import type { CemElement } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

describe('<wc-tab-cem>', () => {
  beforeEach(cleanup);

  it('renders the description and attribute doc rows', async () => {
    const cem: CemElement = {
      tagName: 'my-btn',
      description: 'A button',
      attributes: [{ name: 'size', type: 'string', default: 'md', description: 'btn size' }],
      events: [],
      slots: [],
      cssParts: [],
      cssProperties: [],
    } as unknown as CemElement;
    const el = await renderLit<WcTabCem>('wc-tab-cem', { cem });
    expect(el.querySelector('.cem-description')?.textContent).toBe('A button');
    const row = el.querySelector('.cem-doc-row');
    expect(row?.querySelector('.cem-name')?.textContent).toBe('size');
    expect(row?.querySelector('.cem-type')?.textContent).toBe('string');
    expect(row?.querySelector('.cem-default')?.textContent).toContain('md');
    expect(row?.querySelector('.cem-doc-desc')?.textContent).toBe('btn size');
  });

  it('renders empty content gracefully when only tagName is set', async () => {
    const cem = { tagName: 'x' } as unknown as CemElement;
    const el = await renderLit<WcTabCem>('wc-tab-cem', { cem });
    expect(el.querySelector('.cem-content')).not.toBeNull();
  });
});
