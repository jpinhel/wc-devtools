import { beforeEach, describe, expect, it } from 'vitest';
import '../../entrypoints/panel/components/wc-registry';
import type { WcRegistry } from '../../entrypoints/panel/components/wc-registry';
import { cleanup, renderLit } from './helpers';

describe('<wc-registry>', () => {
  beforeEach(cleanup);

  it('renders the empty-state copy when tags is empty', async () => {
    const el = await renderLit<WcRegistry>('wc-registry', { tags: [], filter: '' });
    const empty = el.querySelector('.empty-state');
    expect(empty).not.toBeNull();
    expect(empty?.textContent?.trim()).toBe('No custom elements registered yet.');
  });

  it('renders one .registry-item per tag when no filter is given', async () => {
    const el = await renderLit<WcRegistry>('wc-registry', {
      tags: ['my-button', 'my-card', 'app-root'],
      filter: '',
    });
    expect(el.querySelectorAll('.registry-item')).toHaveLength(3);
  });

  it('filters case-insensitively', async () => {
    const el = await renderLit<WcRegistry>('wc-registry', {
      tags: ['my-button', 'my-card', 'app-root'],
      filter: 'CARD',
    });
    const rows = el.querySelectorAll('.registry-item');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('my-card');
  });

  it('shows the no-matches message when nothing matches the filter', async () => {
    const el = await renderLit<WcRegistry>('wc-registry', {
      tags: ['my-button'],
      filter: 'nope',
    });
    const empty = el.querySelector('.empty-state');
    expect(empty?.textContent?.trim()).toBe('No matches for "nope".');
  });
});
